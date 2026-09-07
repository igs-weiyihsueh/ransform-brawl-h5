import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import {
  HUMAN_KEY,
  ITEM_SPAWN_INTERVAL,
  MAX_ITEMS_ON_FIELD,
  MAX_SOUL_POWER,
  RECOVER_SOUL,
  SUNWUKONG_KEY,
  TRANSFORM_IFRAME,
} from '@/config/transformConfig';
import { TransformItem, INITIAL_ITEM_PICKUP_IMMUNITY_SEC } from '@/entities/TransformItem';
import { playerColor } from '@/config/playerConfig';
import { PPU } from '@/config/gameConfig';
import {
  GUIDE_ARROW,
  TETHER,
  guideArrowAngle,
  guideArrowAnchor,
  shouldHideArrow,
  nextGuideTarget,
  tetherEndPoint,
  resolveItemOwner,
  type ItemSource,
} from '@/systems/itemGuideMath';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import {
  MASH_PER_HIT,
  autoFillDelta,
  isMashComplete,
  shouldAutoFill,
} from '@/systems/mashTransformMath';

/**
 * TransformSystem — 變身系統（凡人 ↔ 悟空，決策 15fec2a4）。
 *
 * 道具：週期生成 TransformItem（場上最多 MAX_ITEMS_ON_FIELD）+ debug 鍵手動生。
 *   每幀距離判定撿取：未變身撿到 → 變身；已變身撿到 → 回復魂力 +RECOVER_SOUL。
 * 變身：換悟空 visual（Player.switchCharacter）→ EnergySystem 自動吃 Full 模式 + 倍率 1.0
 *   （EnergySystem 依 player.getCharacterKey() 決定模式/倍率，換角即換）；金光閃 + 1s iframe。
 * 持續＝魂力（非計時器）：變身時滿 100；變身中受敵人攻擊改扣魂力（掛 Player 的 soulDamageSink）；
 *   魂力歸 0 → Detransform（換回凡人 visual、EnergySystem 回 HumanSimple、藏魂力環）。
 *
 * UI：提供 isTransformed()/getSoulRatio() 給魂力環（fill=soul/max，變身顯示、退變藏）。
 */
export class TransformSystem implements GameSystem {
  readonly name = 'TransformSystem';
  private ctx!: GameContext;

  /** 每玩家變身狀態（Map<playerId>）。S3 只有 P1，一筆退化成舊單一 state。 */
  private states = new Map<number, { transformed: boolean; soul: number }>();
  /**
   * 十五輪 連打變身狀態機（per-player）：撿道具（未變身）→ active，靠連打填 ratio，滿→完成變身。
   * ratio 0..1；sinceLastMashSec 距上次連打秒數（判連打 vs 自動填）；comboStash 進狀態時暫存的 COMBO 值。
   */
  private mashStates = new Map<
    number,
    { active: boolean; ratio: number; sinceLastMashSec: number; comboStash: number }
  >();
  private items: TransformItem[] = [];
  private spawnTimer = 0;
  /** 用戶 #7 牽引線（per-player 玩家色半透明線，貼地不擋）。 */
  private tetherGfx: Phaser.GameObjects.Graphics | null = null;
  /** 用戶 #7 指引箭頭（owner 腳邊玩家色箭頭指向專屬道具，脈動+黑描邊）。 */
  private guideGfx: Phaser.GameObjects.Graphics | null = null;
  /** 道具 id 序號。 */
  private itemSeq = 0;
  /** 每 owner 的專屬道具 id 佇列（掉落先後，排隊制一次顯一個箭頭）。 */
  private ownerQueues = new Map<number, number[]>();
  /** 每道具箭頭已顯示時間（秒，用於 showDuration 淡出）。 */
  private arrowElapsed = new Map<number, number>();
  /** 脈動相位累計。 */
  private pulsePhase = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.spawnTimer = ITEM_SPAWN_INTERVAL;
    this.states.clear();
    this.mashStates.clear();
    // 用戶 #7：牽引線(貼地、角色之下)+指引箭頭(角色上層)graphics。
    // 防禦：測試用最小 ctx 無 scene → 不建 graphics（純狀態機測試不需視覺，drawTethers/Arrows 會 no-op）。
    const scene = ctx.scene as Phaser.Scene | undefined;
    if (scene && typeof scene.add?.graphics === 'function') {
      this.tetherGfx = scene.add.graphics().setDepth(-3); // 貼地不擋(角色 PLAY_DEPTH=10 之上)
      // 七輪#9(用戶指明 depth)：指引箭頭提到道具(20)+怪+角色之上、明確高於道具 sprite，
      //   低於 HUD/面板(OVERHEAD_DEPTH=900/PANEL_DEPTH=1000)→道具指引在遊戲層最上、不被道具圖蓋、不蓋 UI。
      this.guideGfx = scene.add.graphics().setDepth(100);
    }
  }

  private stateOf(playerId: number): { transformed: boolean; soul: number } {
    let s = this.states.get(playerId);
    if (!s) {
      s = { transformed: false, soul: 0 };
      this.states.set(playerId, s);
    }
    return s;
  }

  update(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnItem();
      this.spawnTimer = ITEM_SPAWN_INTERVAL;
    }

    // 撿取判定（距離）。S3：只 P1 撿。
    const player = this.ctx.player;
    const playerPos = player.getPosition();
    for (const item of this.items) {
      item.tickImmunity(dt); // 七輪#9 乙：扣減初始道具撿取免疫
      if (!item.isPicked() && item.isInPickupRange(playerPos)) {
        this.onPickup(item, player);
      }
    }
    this.items = this.items.filter((it) => !it.isPicked());

    // 十五輪：連打變身填充推進（每 player）。
    this.tickMashTransform(dt);

    // 用戶 #7：牽引線 + 指引箭頭（純視覺輔助，不改數值）。
    this.pulsePhase += dt;
    this.drawTethers();
    this.drawGuideArrows();
  }

  /**
   * 十五輪：連打變身填充推進。
   * - scripted（守護波 introMove 玩家被控不能連打，用戶確認 2）→ 自動快速填滿。
   * - 否則純沒打（idle > MASH_IDLE_TO_AUTO_SEC，用戶確認 1）→ 自動填（10s 填滿）；有連打（sinceLastMashSec 被 registerMashHit 歸零）→ 不自動填。
   */
  private tickMashTransform(dt: number): void {
    for (const [pid, m] of this.mashStates) {
      if (!m.active) continue;
      m.sinceLastMashSec += dt;
      const scripted = this.ctx.scriptedControl === true;
      if (scripted) {
        m.ratio = Math.min(1, m.ratio + autoFillDelta(dt, true));
      } else if (shouldAutoFill(m.sinceLastMashSec)) {
        m.ratio = Math.min(1, m.ratio + autoFillDelta(dt, false));
      }
      if (isMashComplete(m.ratio)) this.completeMashTransform(pid);
    }
  }

  /** 用戶 #7 ①牽引線：每個在場玩家從下方面板欄頂(TetherAnchor)畫玩家色半透明線到真空圈邊緣(靠面板側)。 */
  private drawTethers(): void {
    const g = this.tetherGfx;
    if (!g) return;
    g.clear();
    for (const p of this.ctx.players) {
      if (typeof p.isWaiting === 'function' && p.isWaiting()) continue; // 待機中不畫(還沒進場)
      const anchor = this.ctx.getWaitingAnchor(p.playerId); // TetherAnchor=下方面板欄待機點
      if (!anchor) continue;
      // 用戶第九輪#5 治本：牽引線要牽到「玩家看到的貼地搜索圈」邊緣。
      // 搜索圈視覺中心＝footGlowCenter（腳部，sprite 中心往下 ~75.6px）；而 getVacuumCenter 已於 #7#8
      //   改成 body 中心（surround/推怪對稱用）→ 比視覺圈高 ~75.6px。舊版傳 getVacuumCenter → 終點落
      //   body 中心圈邊緣（線停在身體附近、短了 ~75.6px），視覺上沒牽到腳下搜索圈。改傳 getFootGlowCenter
      //   → 終點落實際搜索圈邊緣（所見即所得）。半徑 getVacuumRadius()＝foot.radiusPx（與視覺圈同半徑）。
      const center =
        typeof p.getFootGlowCenter === 'function'
          ? p.getFootGlowCenter()
          : typeof p.getVacuumCenter === 'function'
            ? p.getVacuumCenter()
            : p.getPosition();
      // 三輪#4 根治：getVacuumRadius() 已回像素(FOOT_GLOW.radiusPx=50, 搜索圈=真空圈同一圈)，
      // 不可再 ×PPU(原 bug: 50×100=5000px → tetherEndPoint 因 anchor 距離<5000 退回角色中心 → 線穿過整個搜索圈)。
      // 用當前搜索圈半徑(px) → 停在搜索圈外緣靠 anchor 那側(不進圈)；#5 開放調整後半徑變化會自動跟。
      const radius = typeof p.getVacuumRadius === 'function' ? p.getVacuumRadius() : 40;
      const end = tetherEndPoint(anchor, center, radius); // 停搜索圈(真空圈)邊緣靠 anchor 那側
      g.lineStyle(TETHER.widthPx, playerColor(p.playerId), TETHER.alpha);
      g.beginPath();
      g.moveTo(anchor.x, anchor.y);
      g.lineTo(end.x, end.y);
      g.strokePath();
    }
  }

  /** 用戶 #7 ③指引箭頭：每 owner 佇列選當前該指的專屬道具，腳邊玩家色箭頭指向它(脈動+黑描邊、3s淡出、近距隱藏)。 */
  private drawGuideArrows(): void {
    const g = this.guideGfx;
    if (!g) return;
    g.clear();
    const byId = new Map<number, TransformItem>();
    for (const it of this.items) byId.set(it.id, it);
    // 清掉已撿/離場道具的計時。
    for (const id of [...this.arrowElapsed.keys()]) if (!byId.has(id)) this.arrowElapsed.delete(id);

    for (const p of this.ctx.players) {
      if (typeof p.isWaiting === 'function' && p.isWaiting()) continue;
      const queue = this.ownerQueues.get(p.playerId) ?? [];
      const targetId = nextGuideTarget(queue, (id) => !byId.has(id)); // 未撿(仍在場)的第一個
      if (targetId === null) continue;
      const item = byId.get(targetId);
      if (!item) continue;
      const ownerPos = p.getPosition();
      const itemPos = item.getPosition();
      const distUnits = Math.hypot(itemPos.x - ownerPos.x, itemPos.y - ownerPos.y) / PPU;
      // 七輪#9 乙：初始道具（引導去撿）箭頭跳過距離 gate（近距離也顯示，別因 <hideDistance 提早吃）；
      //   3s showDuration 時間淡出保留（對齊 Unity arrowShowDuration，非永久顯示）。一般道具 gate 照舊。
      if (item.source !== 'initial' && shouldHideArrow(distUnits)) continue; // 已靠近→不指（一般道具）
      // 顯示計時（3s 後淡出）。
      const t = (this.arrowElapsed.get(targetId) ?? 0) + this.ctx.scene.game.loop.delta / 1000;
      this.arrowElapsed.set(targetId, t);
      let alpha = 1;
      const fadeStart = GUIDE_ARROW.showDurationSec;
      if (t > fadeStart) {
        alpha = Math.max(0, 1 - (t - fadeStart) / GUIDE_ARROW.fadeDurationSec);
        if (alpha <= 0) continue; // 淡出完不畫
      }
      const vacCenter = typeof p.getVacuumCenter === 'function' ? p.getVacuumCenter() : ownerPos;
      const vacRadius = typeof p.getVacuumRadius === 'function' ? p.getVacuumRadius() : 40;
      const angle = guideArrowAngle(vacCenter, itemPos); // 六輪#9：角度從搜索圈中心→道具(與錨點同基準)
      const pulse = 1 + GUIDE_ARROW.pulseScale * Math.sin(this.pulsePhase * GUIDE_ARROW.pulseSpeed);
      const size = 44 * GUIDE_ARROW.baseScale * 2 * pulse; // 箭頭長度(px，放大更醒目)
      // 六輪#9：箭頭錨在「搜索圈中心 + 貼圈邊(vacuumRadius+edgeMargin)、指向道具那側」，
      //   取代舊版「錨身體中心(getPosition)+footOffset + outPx=vacuumRadius+24」(浮身體上方離圈遠、跟角色糊)。
      //   → 箭頭落在搜索圈邊緣附近、清楚指向道具。純視覺。
      const anchor = guideArrowAnchor(vacCenter, vacRadius, angle);
      // 六輪#9：整個三角往指向再推半個箭長，讓箭頭「底邊」落在圈邊(而非中心跨在圈邊)→ 尾巴不觸角色身體。
      let cx = anchor.x + Math.cos(angle) * size * 0.5;
      let cy = anchor.y + Math.sin(angle) * size * 0.5;
      // 七輪#9：箭頭尖端不戳進道具——道具近(剛過 hide 門檻)時尖端會頂到道具 sprite(被道具擋)。
      //   尖端 = (cx,cy) + dir×size；若尖端離道具 < ARROW_ITEM_GAP，把整個三角沿反方向退，讓尖端保持間距。
      const tipX = cx + Math.cos(angle) * size;
      const tipY = cy + Math.sin(angle) * size;
      const gap = GUIDE_ARROW.itemClearancePx;
      const tipToItem = Math.hypot(itemPos.x - tipX, itemPos.y - tipY);
      if (tipToItem < gap) {
        const pull = gap - tipToItem; // 需往回退的量
        cx -= Math.cos(angle) * pull;
        cy -= Math.sin(angle) * pull;
      }
      this.drawArrow(g, cx, cy, angle, size, playerColor(p.playerId), alpha);
    }
  }

  /** 畫一個朝 angle 的三角箭頭（玩家色 fill + 黑描邊），中心 (cx,cy)。 */
  private drawArrow(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    angle: number,
    size: number,
    color: number,
    alpha: number,
  ): void {
    const tip = { x: cx + Math.cos(angle) * size, y: cy + Math.sin(angle) * size };
    const back = size * 0.55;
    const spread = Math.PI * 0.75;
    const l = { x: cx + Math.cos(angle + spread) * back, y: cy + Math.sin(angle + spread) * back };
    const r = { x: cx + Math.cos(angle - spread) * back, y: cy + Math.sin(angle - spread) * back };
    // 黑描邊(放大 outlineScale)。
    g.fillStyle(0x000000, alpha);
    const o = GUIDE_ARROW.outlineScale;
    const ot = { x: cx + Math.cos(angle) * size * o, y: cy + Math.sin(angle) * size * o };
    const ol = { x: cx + Math.cos(angle + spread) * back * o, y: cy + Math.sin(angle + spread) * back * o };
    const or = { x: cx + Math.cos(angle - spread) * back * o, y: cy + Math.sin(angle - spread) * back * o };
    g.fillTriangle(ot.x, ot.y, ol.x, ol.y, or.x, or.y);
    // 玩家色箭頭。
    g.fillStyle(color, alpha);
    g.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  /**
   * 生成一個變身道具（場上未達上限才生）。可被 debug 呼叫。
   * @param source 三輪#6 來源：'random'(隨機刷,無主)/'initial'(登場,有主)/'kill'(擊落,歸打的玩家)。預設 'random'。
   * @param ownerPlayerId 初始/擊落來源的擁有者 playerId（隨機來源忽略）。
   * @param pos 五輪#1：指定生成位置（初始道具放玩家落點旁）；省略=隨機位置（隨機刷）。
   */
  spawnItem(source: ItemSource = 'random', ownerPlayerId?: number, pos?: { x: number; y: number }): void {
    if (this.items.length >= MAX_ITEMS_ON_FIELD) return;
    const margin = 120;
    const x = pos ? pos.x : Phaser.Math.Between(margin, GAME_WIDTH - margin);
    const y = pos ? pos.y : Phaser.Math.Between(margin, GAME_HEIGHT - margin);
    const item = new TransformItem(this.ctx.scene, x, y, ++this.itemSeq, source);
    // 七輪#9 乙：初始道具進場後短暫免撿取（給玩家看箭頭走過去的時間，箭頭 3s showDuration 內不被秒撿）。
    if (source === 'initial') item.setPickupImmunity(INITIAL_ITEM_PICKUP_IMMUNITY_SEC);
    // 三輪#6：owner 依來源分配。隨機刷=無主(不標色框/不畫箭頭/不連牽引)；初始/擊落=有主(標玩家色+入佇列)。
    const owner = resolveItemOwner(source, ownerPlayerId);
    if (owner !== null) {
      item.setOwner(owner, playerColor(owner));
      const q = this.ownerQueues.get(owner) ?? [];
      q.push(item.id);
      this.ownerQueues.set(owner, q);
    }
    this.items.push(item);
  }

  private onPickup(item: TransformItem, player: GameContext['player']): void {
    item.pickUp();
    const s = this.stateOf(player.playerId);
    if (s.transformed) {
      s.soul = Math.min(MAX_SOUL_POWER, s.soul + RECOVER_SOUL);
    } else {
      // 十五輪：初次變身不直接變 → 進「連打變身」鎖定狀態機（填滿才 transform）。
      this.enterMashTransform(player);
    }
  }

  /**
   * 十五輪：進入連打變身狀態（撿道具、未變身）。
   * 身體浮起+鎖定（Player.setMashLocked→敵人 targeting/環繞/抓免疫、move/dash/attack gate）；
   * 暫存當前 COMBO 值 + 暫停 COMBO 倒數（不中斷，完成後恢復）。
   */
  private enterMashTransform(player: GameContext['player']): void {
    const pid = player.playerId;
    const m = this.mashStateOf(pid);
    if (m.active) return; // 已在連打變身中不重入
    m.active = true;
    m.ratio = 0;
    m.sinceLastMashSec = 0;
    m.comboStash = this.ctx.combo?.getCombo?.(pid) ?? 0; // 暫存 COMBO（值本就存 ComboSystem；暫停倒數即保留）
    this.ctx.combo?.setMashPaused?.(pid, true); // 暫停 COMBO 倒數（不中斷）
    player.setMashLocked?.(true); // 鎖定+免疫（複用 outOfCredit 類比免疫路徑）
    player.setFloating?.(true); // 身體浮起（純視覺，Player 提供）
  }

  /**
   * 十五輪：連打攻擊鈕（連打模式攔截、不打傷害）→ 填充 +1/15。由 PlayerControlSystem 在連打變身中攔截攻擊鍵呼叫。
   * 連打優先：重置 idle 計時（停自動填）。
   */
  registerMashHit(playerId: number): void {
    const m = this.mashStateOf(playerId);
    if (!m.active) return;
    m.ratio = Math.min(1, m.ratio + MASH_PER_HIT);
    m.sinceLastMashSec = 0; // 有連打 → 回連打模式（停自動填）
    // 十五輪：每次連打從角色位置噴粒子（連打回饋，配合浮起+閃光=蓄力演出）。純視覺。
    const player = this.playerOf(playerId);
    if (player) {
      const pos = player.getHitCenter?.() ?? player.getPosition?.();
      if (pos) this.ctx.effects?.mashHitParticle?.(pos.x, pos.y);
    }
    if (isMashComplete(m.ratio)) this.completeMashTransform(playerId);
  }

  /** 十五輪：連打變身完成 → 換悟空+魂力 100+EnergySystem Full(自動)+解鎖+COMBO 恢復倒數。 */
  private completeMashTransform(playerId: number): void {
    const m = this.mashStateOf(playerId);
    if (!m.active) return;
    m.active = false;
    m.ratio = 1;
    const player = this.playerOf(playerId);
    if (player) {
      player.setMashLocked?.(false); // 解鎖（恢復移動/攻擊/可被攻擊）
      player.setFloating?.(false);
      this.transform(player); // 換悟空 visual + 魂力 100 + 掛扣魂鉤子（EnergySystem 自動 Full）
    }
    this.ctx.combo?.setMashPaused?.(playerId, false); // COMBO 恢復倒數繼續（暫存值接回）
  }

  private mashStateOf(playerId: number) {
    let m = this.mashStates.get(playerId);
    if (!m) {
      m = { active: false, ratio: 0, sinceLastMashSec: 0, comboStash: 0 };
      this.mashStates.set(playerId, m);
    }
    return m;
  }

  /** 接口（界騎 UI）：某玩家是否在連打變身中。 */
  isMashingTransform(playerId: number): boolean {
    return this.mashStateOf(playerId).active;
  }

  /** 接口（界騎 UI）：連打變身填充比例 0..1（魂力環填充/玩家牌放大提示）。 */
  getMashRatio(playerId: number): number {
    const m = this.mashStateOf(playerId);
    return m.active ? m.ratio : 0;
  }

  /** 變身：凡人 → 悟空。 */
  private transform(player: GameContext['player']): void {
    const s = this.stateOf(player.playerId);
    s.transformed = true;
    s.soul = MAX_SOUL_POWER;
    player.switchCharacter(SUNWUKONG_KEY);
    player.playTransformFlash(TRANSFORM_IFRAME);
    player.setSoulDamageSink((dmg) => this.takeSoulDamage(player, dmg));
  }

  /** 退變：悟空 → 凡人（魂力歸 0 觸發）。 */
  private detransform(player: GameContext['player']): void {
    const s = this.stateOf(player.playerId);
    s.transformed = false;
    s.soul = 0;
    player.setSoulDamageSink(null);
    player.switchCharacter(HUMAN_KEY);
    player.playTransformFlash(TRANSFORM_IFRAME);
  }

  /** 變身中受敵人攻擊：扣魂力；歸 0 → 退變。 */
  private takeSoulDamage(player: GameContext['player'], damage: number): void {
    const s = this.stateOf(player.playerId);
    if (!s.transformed) return;
    s.soul = Math.max(0, s.soul - damage);
    if (s.soul <= 0) {
      this.detransform(player);
    }
  }

  destroy(): void {
    for (const it of this.items) it.destroy();
    this.items = [];
    this.ctx?.player.setSoulDamageSink(null);
  }

  // --- UI / 狀態查詢 ---
  isTransformed(playerId: number): boolean {
    return this.stateOf(playerId).transformed;
  }

  /**
   * 十五輪：強制退回凡人（沒 credit 回待機時呼叫，對齊 Unity 回待機 revert transform）。
   * 冪等：未變身則不動作。走與魂力歸 0 相同的 detransform（換凡人 visual、EnergySystem 回 HumanSimple、藏魂力環）。
   */
  revertToHuman(playerId: number): void {
    if (!this.stateOf(playerId).transformed) return;
    const player = this.playerOf(playerId);
    if (player) this.detransform(player);
  }

  private playerOf(playerId: number): GameContext['player'] | null {
    const players = this.ctx?.players ?? (this.ctx?.player ? [this.ctx.player] : []);
    return players.find((p) => p.playerId === playerId) ?? this.ctx?.player ?? null;
  }

  getSoul(playerId: number): number {
    return this.stateOf(playerId).soul;
  }

  /** 魂力顯示比例 0..1（退變時 0）。 */
  getSoulRatio(playerId: number): number {
    const s = this.stateOf(playerId);
    return s.transformed ? s.soul / MAX_SOUL_POWER : 0;
  }
}
