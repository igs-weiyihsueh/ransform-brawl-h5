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
import { TransformItem } from '@/entities/TransformItem';
import { playerColor } from '@/config/playerConfig';
import { PPU } from '@/config/gameConfig';
import {
  GUIDE_ARROW,
  TETHER,
  guideArrowAngle,
  shouldHideArrow,
  nextGuideTarget,
  tetherEndPoint,
  resolveItemOwner,
  type ItemSource,
} from '@/systems/itemGuideMath';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

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
    // 用戶 #7：牽引線(貼地、角色之下)+指引箭頭(角色上層)graphics。
    // 防禦：測試用最小 ctx 無 scene → 不建 graphics（純狀態機測試不需視覺，drawTethers/Arrows 會 no-op）。
    const scene = ctx.scene as Phaser.Scene | undefined;
    if (scene && typeof scene.add?.graphics === 'function') {
      this.tetherGfx = scene.add.graphics().setDepth(-3); // 貼地不擋(角色 PLAY_DEPTH=10 之上)
      this.guideGfx = scene.add.graphics().setDepth(25); // 箭頭在道具(20)之上
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
      if (!item.isPicked() && item.isInPickupRange(playerPos)) {
        this.onPickup(item, player);
      }
    }
    this.items = this.items.filter((it) => !it.isPicked());

    // 用戶 #7：牽引線 + 指引箭頭（純視覺輔助，不改數值）。
    this.pulsePhase += dt;
    this.drawTethers();
    this.drawGuideArrows();
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
      const center =
        typeof p.getVacuumCenter === 'function' ? p.getVacuumCenter() : p.getPosition();
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
      if (shouldHideArrow(distUnits)) continue; // 已靠近→不指
      // 顯示計時（3s 後淡出）。
      const t = (this.arrowElapsed.get(targetId) ?? 0) + this.ctx.scene.game.loop.delta / 1000;
      this.arrowElapsed.set(targetId, t);
      let alpha = 1;
      const fadeStart = GUIDE_ARROW.showDurationSec;
      if (t > fadeStart) {
        alpha = Math.max(0, 1 - (t - fadeStart) / GUIDE_ARROW.fadeDurationSec);
        if (alpha <= 0) continue; // 淡出完不畫
      }
      const angle = guideArrowAngle(ownerPos, itemPos);
      const pulse = 1 + GUIDE_ARROW.pulseScale * Math.sin(this.pulsePhase * GUIDE_ARROW.pulseSpeed);
      const size = 44 * GUIDE_ARROW.baseScale * 2 * pulse; // 箭頭長度(px，放大更醒目)
      // 箭頭中心：從腳邊往「指向道具方向」外推一段(避開腳下搜索圈、更醒目)。
      // 三輪#4 同修: getVacuumRadius 已是像素、不 ×PPU(原 bug 讓箭頭外推 5000+px 到畫面外, 這也是 #7 箭頭難見主因)。
      const outPx = (typeof p.getVacuumRadius === 'function' ? p.getVacuumRadius() : 40) + 24;
      const fx = ownerPos.x + Math.cos(angle) * outPx;
      const fy = ownerPos.y + GUIDE_ARROW.footOffsetYUnits * PPU + Math.sin(angle) * outPx;
      this.drawArrow(g, fx, fy, angle, size, playerColor(p.playerId), alpha);
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
   */
  spawnItem(source: ItemSource = 'random', ownerPlayerId?: number): void {
    if (this.items.length >= MAX_ITEMS_ON_FIELD) return;
    const margin = 120;
    const x = Phaser.Math.Between(margin, GAME_WIDTH - margin);
    const y = Phaser.Math.Between(margin, GAME_HEIGHT - margin);
    const item = new TransformItem(this.ctx.scene, x, y, ++this.itemSeq);
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
      this.transform(player);
    }
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

  getSoul(playerId: number): number {
    return this.stateOf(playerId).soul;
  }

  /** 魂力顯示比例 0..1（退變時 0）。 */
  getSoulRatio(playerId: number): number {
    const s = this.stateOf(playerId);
    return s.transformed ? s.soul / MAX_SOUL_POWER : 0;
  }
}
