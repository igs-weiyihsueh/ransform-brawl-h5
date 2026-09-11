import Phaser from 'phaser';
import { CHARACTERS } from '@/config/animationConfig';
import { chestChargeForResolved, getResolvedChest } from '@/config/chestSchema';
import { BACKGROUND_COLOR, GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { resolveTowerPositions } from '@/systems/towerRingSkill';
import { TOWER_DEFAULT_COLLISION_RADIUS_PX } from '@/entities/Enemy';
import { resolveTowerIntro, resolveTowerUi, resolveTowerMessages } from '@/config/towerConfig';
import { TowerIntroSequence } from '@/systems/TowerIntroSequence';
import { HERO_ROSTER, pickHero } from '@/config/heroRoster';
import { shouldDropHeroItem } from '@/config/heroDropMath';
import { WEAPON_ITEM_TEXTURES } from '@/config/weaponItemConfig';
import type { LevelData } from '@/config/levelSchema';
import { Player, PLAYER_CHARACTERS } from '@/entities/Player';
import { BuffSystem } from '@/systems/BuffSystem';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import { splitChestByDamage } from '@/systems/chestAttribution';
import { landingX } from '@/systems/entranceMath';
import { WAITING_PLATFORM_LIFT, PLATFORM_FEET_OFFSET, playerColor } from '@/config/playerConfig';
import { PANEL_DEPTH, UI_ICONS } from '@/config/uiConfig';
import { ChestSystem } from '@/systems/ChestSystem';
import { ComboSystem } from '@/systems/ComboSystem';
import { CreditSystem } from '@/systems/CreditSystem';
import { DebugSystem } from '@/systems/DebugSystem';
import { EffectSystem } from '@/systems/EffectSystem';
import { EnemySpawner } from '@/systems/EnemySpawner';
import { EnemySystem } from '@/systems/EnemySystem';
import { EnergySystem } from '@/systems/EnergySystem';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { HelmetSystem } from '@/systems/HelmetSystem';
import { InputSystem } from '@/systems/InputSystem';
import { JpSystem } from '@/systems/JpSystem';
import { JpLampHud } from '@/systems/ui/JpLampHud';
import { pickLightGroup, JP_TICKET_FACE } from '@/config/jpConfig';
import { PlayerControlSystem } from '@/systems/PlayerControlSystem';
import { TransformSystem } from '@/systems/TransformSystem';
import { TicketSystem } from '@/systems/TicketSystem';
import { UISystem } from '@/systems/UISystem';
import { ProgressBarSystem } from '@/systems/ProgressBarSystem';
import { FireRainSystem } from '@/systems/FireRainSystem';
import { GrabSystem } from '@/systems/GrabSystem';
import { WaveSystem } from '@/systems/WaveSystem';
import { MineTrapSystem } from '@/systems/MineTrapSystem';
import { LevelProgressSystem } from '@/systems/LevelProgressSystem';

/**
 * GameScene — 主場景（系統註冊表版）。
 *
 * 職責僅剩「組裝」：載入資源、建立共用服務與 GameContext、
 * 把各 GameSystem 加進 registry 並依序 init/update。玩法邏輯全在各 system。
 *
 * 擴充方式（見 docs/h5_collab_spec.md §4）：新系統 implement GameSystem，
 * 在 create() 的 registerSystems() 加一行 this.register(new XxxSystem())，
 * 不用改本檔的主迴圈。registry 陣列順序即每幀執行順序。
 */
export class GameScene extends Phaser.Scene {
  private systems: GameSystem[] = [];
  private ctx!: GameContext;
  /** UISystem 實例（create 提前建立供擊殺回呼取寶盒錨點；registerSystems 再註冊）。 */
  private uiSystem!: UISystem;
  /** 2 新事件：地雷陷阱系統（附加類讀取式；create 建、registerSystems 註冊供每幀 update 讀 getActiveMinePreset）。 */
  private mineTrapSystem?: MineTrapSystem;
  /** 用戶 #3：JP 燈 HUD（3組×5顆，飛光終點+反映 JpSystem litCount）。 */
  private jpLampHud?: JpLampHud;
  /** 魔尖塔波開場演出序列（塔波照搬守護波 GuardEvent intro：玩家聚集中央→聚焦壓黑定格→生塔）；active 時每幀 tick。 */
  private towerIntro: TowerIntroSequence | null = null;
  /** 塔波過關獎勵券數（onTowerWave 時由 preset resolveTowerUi.rewardTickets 設，onTowerWaveResult(true) 發獎用）。 */
  private towerRewardTickets = 10;

  /** 試玩模式注入的關卡（由 main.ts 經 scene data 傳入）；一般玩家為 undefined。 */
  private previewLevels?: LevelData[];

  constructor() {
    super({ key: 'GameScene' });
  }

  /** 接收 scene.start 傳入的資料（試玩模式帶 previewLevels）。 */
  init(data?: { previewLevels?: LevelData[] }): void {
    this.previewLevels = data?.previewLevels;
  }

  /** 載入全部角色逐幀圖 + 攻擊特效 + UI icon。 */
  preload(): void {
    for (const charKey of Object.keys(CHARACTERS)) {
      CharacterAnimator.preload(this, charKey);
    }
    EffectSystem.preload(this);
    Player.preload(this); // 七輪：腳下識別圓盤 fx_player_disc
    UISystem.preload(this); // 載入 UI icon（coin/ticket/ring/chest/lamp）
    // ★用戶：武器指定變身道具圖（撿武器→變對應英雄；道具外觀=武器 PNG，key 對齊 HERO_ROSTER）。
    //   場上生成先關著（WEAPON_ITEM_SPAWN_ENABLED=false），但圖先載好備著。
    for (const w of WEAPON_ITEM_TEXTURES) {
      if (!this.textures.exists(w.key)) this.load.image(w.key, w.path);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    // 動畫/特效註冊（全域一次）。
    for (const charKey of Object.keys(CHARACTERS)) {
      CharacterAnimator.register(this, charKey);
    }
    EffectSystem.register(this);

    // 共用服務。
    const worldBounds = new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const input = new InputSystem(this);
    const effects = new EffectSystem(this);
    const player = new Player(
      this,
      GAME_WIDTH * 0.4,
      GAME_HEIGHT * 0.5,
      PLAYER_CHARACTERS[0],
    );
    const spawner = new EnemySpawner(this, player, worldBounds);
    // S2：P1 的操控意圖來源 = 現有 InputSystem（同一實例，行為完全同舊）。
    player.inputSource = input;

    // 項目3（投幣進場循環）：所有玩家（含 P1）開場都在下方面板待機、按 C 投幣才進場。
    // 待機初始化在 systems.init 之後做（需 UISystem/BottomPanel 待機點就緒），見下方。
    const energy = new EnergySystem();
    const transform = new TransformSystem();
    const credit = new CreditSystem();
    const combo = new ComboSystem();
    const ticket = new TicketSystem();
    const chest = new ChestSystem();
    const wave = new WaveSystem(this.previewLevels);
    const jp = new JpSystem();
    const buff = new BuffSystem();
    const helmet = new HelmetSystem();

    // 多人遷移 S4：players 用可變後備陣列，增減只透過 addPlayer 受控入口。
    const playerList: Player[] = [player]; // players[0] = 本地人類 P1
    const scene = this; // 供 ctx 內 arrow 取 scene 服務（uiSystem 待機點）
    // 共用 context（各 system 只透過它取服務/狀態）。
    this.ctx = {
      scene: this,
      worldBounds,
      players: playerList,
      // player = 本地人類 P1 = players[0]（getter alias，現有讀 ctx.player 的碼不動）。
      get player(): Player {
        return this.players[0];
      },
      addPlayer(p: Player): void {
        playerList.push(p);
      },
      getWaitingAnchor: (playerIndex: number): { x: number; y: number } => {
        // 委派 UISystem→BottomPanel（界騎 getWaitingAnchor 權威）；未提供時 fallback：
        // 下方面板一帶、按 playerId 水平分散（對齊 landing 分散語意）。
        const precise = scene.getWaitingAnchor(playerIndex);
        if (precise) return precise;
        return { x: landingX(playerIndex, GAME_WIDTH * 0.5), y: GAME_HEIGHT - 60 };
      },
      input,
      effects,
      spawner,
      energy,
      transform,
      credit,
      combo,
      ticket,
      chest,
      wave,
      jp,
      buff,
      helmet,
      getEnemies: () => spawner.getEnemies(),
      scriptedControl: false, // 用戶 #4：守護波開場導引走位時設 true 鎖操作
      guardFocusPause: false, // 守護波聚焦定格：focus 期間 true 凍結玩法系統（聚焦 UI tween 照播）
    };

    // 能量飛光需在擊殺回呼裡取寶盒 UI 錨點：UISystem 提前建立（存 field，registerSystems 再註冊）。
    this.uiSystem = new UISystem();
    const uiSystem = this.uiSystem;
    const effectsRef = effects;

    // 擊殺 → 寶盒能量按「各 player 對這隻的傷害比例」分給各自 chest（決策 c61872a6）。
    // + 能量飛寶盒表演（第4項，純視覺）：每個有貢獻的 player 從敵人死亡位置飛一道識別色能量光
    //   到該 player 寶盒 UI 位置。⚠️ addCharge 維持即時加值、飛光只是疊加表演（數值/視覺解耦）。
    spawner.onEnemyKilled = (enemyKey, damageByPlayer, deathPos) => {
      const total = chestChargeForResolved(getResolvedChest(), enemyKey);
      const shares = splitChestByDamage(total, damageByPlayer, player.playerId);
      for (const [pid, amount] of shares) {
        chest.addCharge(pid, amount); // 即時加值（不動時機/邏輯）
        // 階段3：二段變身能量改「擊中累積」（PlayerControl 命中 hook），不再擊殺累積——此處移除 accumulateSecondTransform。
        if (amount <= 0) continue;
        const anchor = uiSystem.getChestAnchor(pid);
        if (anchor)
          effectsRef.flyEnergy(deathPos.x, deathPos.y, anchor.x, anchor.y, playerColor(pid));
      }
      // 階段2：怪死亡有機率掉落「英雄變身道具」（帶 roster 隨機抽的英雄 key；撿了換英雄）。
      //   ★框架先鋪：roster 現只 SunWukong→道具帶 SunWukong（撿了換同一個，看不出換人，預期）；之後 roster 加英雄即自動生效。
      if (shouldDropHeroItem()) {
        const heroKey = pickHero(HERO_ROSTER) ?? undefined;
        if (heroKey) transform.spawnItem('heroDrop', undefined, deathPos, undefined, heroKey);
      }
    };
    // 防穿透對所有 player（多人）：讓 spawner 讀 players[]。
    spawner.getAllPlayers = () => this.ctx.players;
    // 階段3：玩家被怪擊中 → 二段能量倒扣（★flag 關/能量 0/未一段變身 → no-op 由 TransformSystem gate）。
    spawner.onPlayerHit = (pid) => transform.loseSecondTransformEnergy(pid);
    // 魔尖塔環狀技命中玩家 → 扣 energyCost 段能量（ratio 已在 EnemySpawner 算好：段×energyLossOnHit）。
    spawner.onPlayerRingHit = (pid, energyRatio) => transform.loseSecondTransformEnergy(pid, energyRatio);
    // hitFeel 表演注入：新生敵人受擊/死亡時播白閃/punch/火花/死亡粒子（純視覺）。
    spawner.hitFeelFx = effects;

    // debug 掛勾（無頭 probe/E2E 用；不影響玩法）：魔尖塔尖塔怪 spawn + 存活數自查。
    (window as unknown as { __TOWER__?: unknown }).__TOWER__ = {
      spawn: (x: number, y: number, hp?: number, ring?: { intervalSec?: number; expandPxPerRing?: number; energyCost?: number }) =>
        spawner.spawnTower(x, y, hp, ring),
      aliveCount: () => spawner.getAliveTowerCount(),
      /** probe 用：對第一座存活尖塔猛打致死（驗被打掉清除 + onTowerDestroyed）。 */
      killFirst: () => {
        const t = spawner.getEnemies().find((e) => e.isTower() && !e.isDead());
        if (!t) return false;
        for (let i = 0; i < 999 && !t.isDead(); i += 1) t.takeHit(50, 0, { x: t.getHitCenter().x, y: t.getHitCenter().y });
        return true;
      },
      /** probe 用：直接觸發塔波 onTowerWave（模擬波騎 gate 跑完），驗開場序列（聚集→聚焦→生塔）。 */
      triggerWave: (preset: unknown) => wave.onTowerWave?.(preset as never),
      /** probe 用：讀開場定格/鎖操作旗標。 */
      flags: () => ({ scriptedControl: this.ctx.scriptedControl, guardFocusPause: this.ctx.guardFocusPause }),
    };

    // 開箱報獎表演（第5項，純視覺）：openChest 尾段回呼 → 在該玩家寶盒位置演出。
    // ⚠️ chest 數值(addTickets/buff)已在 openChest 即時套用、此處只做視覺、與數值解耦。
    chest.onChestOpened = (pid, reward) => {
      const anchor = uiSystem.getChestAnchor(pid);
      if (anchor) effects.chestReward(anchor.x, anchor.y, reward.kind, reward.tickets, playerColor(pid));
    };

    // COMBO 結算報獎表演（第3項，純視覺）：settle 尾段回呼 → 在該玩家頭上演出。
    // ⚠️ combo 數值(addTickets)已在 settle 即時結算、此處只做視覺、與數值解耦。
    combo.onComboSettled = (pid, count, tickets, isMax) => {
      const p = this.ctx.players.find((pl) => pl.playerId === pid);
      const pos = p?.getPosition() ?? { x: GAME_WIDTH * 0.5, y: GAME_HEIGHT * 0.5 };
      effects.comboReward(pos.x, pos.y, count, tickets, isMax, playerColor(pid));
    };

    // 用戶 #3 收尾：JP 燈 HUD（3組×5顆，機台 jackpot 三層感），每幀反映 JpSystem litCount。
    this.jpLampHud = new JpLampHud(this);

    // 獎勵節點報獎演出（用戶 #3，純視覺）：進 Reward 節點 → 「恭喜獲獎！」banner + 飛光到「該組下一顆 JP 燈」→ 到達點亮該燈。
    // 先 pickLightGroup 決定要點哪組 → 飛光飛向該組真燈位置 → 到達 jp.addRewardLight(該組) 點亮（看得到燈號增加）。
    wave.onReward = () => {
      const markerX = GAME_WIDTH * 0.5;
      const markerY = 120;
      const group = pickLightGroup(); // 先決定點哪組，飛光才能飛向該組真燈
      const anchor = this.jpLampHud?.getNextLampAnchor(group, jp.getLights(group));
      const toX = anchor?.x ?? markerX;
      const toY = anchor?.y ?? 60;
      effects.rewardFanfare(markerX, markerY, toX, toY, () => {
        jp.addRewardLight(group); // 光到達該組下一顆燈才點亮（HUD 下一幀反映）；集滿派彩+循環
      });
    };

    // 2 新事件（單一架構重構）：地雷＝附加類、讀取式（比照火雨）。MineSystem 每幀讀 wave.getActiveMinePreset()
    //   自撒地雷，無 onMineTrap 回呼（波騎已移除）。此處只建立 + 註冊（每幀 update 讀 preset + 推進倒數）。
    const mineTrap = new MineTrapSystem();
    this.mineTrapSystem = mineTrap; // registerSystems 再註冊

    // 2 新事件：★橋接尖塔怪(征騎 EnemySpawner)↔守護波(波騎 WaveSystem)接口。
    //   魔尖塔＝單獨波次（Event + tower preset）：onTowerWave 帶 TowerPreset（波騎 updateEventNode 解析 preset 後給）。
    //   生 preset.towerCount 座尖塔（各 towerHp + ringSkill 依序固定環參數），橫向均分場上。
    wave.onTowerWave = (preset) => {
      const n = Math.max(1, preset.towerCount);
      const ring = {
        ringCount: preset.ringSkill.ringCount,
        baseRadiusPx: preset.ringSkill.baseRadiusPx,
        radiusStepPx: preset.ringSkill.radiusStepPx,
        ringIntervalSec: preset.ringSkill.ringIntervalSec,
        ringThicknessPx: preset.ringSkill.ringThicknessPx,
        energyCost: preset.ringSkill.energyCost,
        warningSec: preset.ringSkill.warningSec, // C9：環炸前紅圈預警秒數（波騎 schema 5b6d17d）
        vacuumRadiusPx: preset.ringSkill.vacuumRadiusPx, // ②真空帶半徑（用戶可調，波騎新增欄）
      };
      // A2：塔位＝preset.positions 前 N 座（有則用），不足/省略用預設環形補到 towerCount（1920×1080 場景座標）。
      const positions = resolveTowerPositions(preset.positions, n, GAME_WIDTH, GAME_HEIGHT);
      const scale = preset.towerScale != null && preset.towerScale > 0 ? preset.towerScale : 1; // A3：塔 sprite 縮放（省略=1）
      // ★真空帶（塔 body 碰撞半徑 + 圓心偏移）：波騎 towerConfig 已有 towerCollisionRadiusPx/OffsetXPx/YPx 欄（正式型別）。
      //   省略＝不覆寫、用現行預設 radiusPx/圓心（不破舊行為）。跟 ring vacuumRadiusPx 無關。
      const towerCollisionRadiusPx = preset.towerCollisionRadiusPx;
      // 波騎 preset 欄位解析（resolveTowerIntro/Ui/Messages 純函式，逐欄 ?? 預設，0-nullish 安全）。
      const intro = resolveTowerIntro(preset);
      const ui = resolveTowerUi(preset);
      const msgs = resolveTowerMessages(preset);
      this.towerRewardTickets = ui.rewardTickets; // E：過關發獎用（onTowerWaveResult 讀）
      // ★Bug2：生塔動作改在聚焦「之前」執行（beginFocus 呼叫），回傳生成的塔 entities 供聚焦提 depth 照亮。
      //   生 towerCount 座塔（發亮/提 depth 由 TowerIntroSequence 在聚焦時做）。ringSkill 判定靠 guardFocusPause 凍結、combat 才開。
      //   ★③：塔不生血條/「尖塔」標籤——用戶：塔沒血量（麻痺=定住由環狀技 applyStun 處理）不該有血條。
      //   （守護波雕像血條走 GuardTarget、完全獨立，不受此影響。）
      const spawnTowers = () => {
        const towers = [];
        for (let i = 0; i < n; i += 1) {
          const t = spawner.spawnTower(positions[i].x, positions[i].y, preset.towerHp, ring, scale);
          if (towerCollisionRadiusPx != null && towerCollisionRadiusPx >= 0) {
            t.setTowerCollisionRadius(towerCollisionRadiusPx); // ★真空帶：覆寫塔碰撞半徑，讓角色能貼近+可調（正式型別）
          } else {
            // ★省略 towerCollisionRadiusPx → 走塔專屬預設 110（非沿用怪 67.5，見 TOWER_DEFAULT_COLLISION_RADIUS_PX 註）。
            //   (乙) 貼地圓盤後縱深擋距=半徑×0.5，塔沿用怪 67.5 縱深僅~34 太薄不像塔基實擋＝footgun；塔立地結構該有自己預設。
            t.setTowerCollisionRadius(TOWER_DEFAULT_COLLISION_RADIUS_PX);
          }
          // ★碰撞圓圓心偏移（用戶微調圓心位置）：省略＝0（正對塔視覺中心）。
          if (preset.towerCollisionOffsetXPx != null || preset.towerCollisionOffsetYPx != null) {
            t.setTowerCollisionOffset(preset.towerCollisionOffsetXPx ?? 0, preset.towerCollisionOffsetYPx ?? 0);
          }
          towers.push(t);
        }
        return towers;
      };
      // ★塔波照搬守護波 GuardEvent 開場：玩家聚集中央 → 聚焦壓黑+定格 → 生塔+發亮 → combat。
      //   中心＝波騎 gatherPointPx（可編、預設畫面中央 960,540）；聚集半徑用預設（波騎未給 gatherOffsetPx）。
      this.towerIntro?.forceFinish(); // 保險：上一場 intro 未清乾淨先收掉
      this.towerIntro = new TowerIntroSequence(this.ctx, {
        center: { x: intro.gatherPointPx.x, y: intro.gatherPointPx.y },
        maxWalkSec: intro.maxWalkSec,
        introFocusSec: intro.introFocusSec,
        spotlightRadiusPx: intro.spotlightRadiusPx,
        introEventText: msgs.introEventText,
        eventTextDurationSec: msgs.eventTextDurationSec,
        towerMessageText: msgs.towerMessageText,
        towerPositions: positions, // Bug2：聚焦聚光燈打在塔位上（非玩家聚集點）
        spawnTowers, // ★Bug2：beginFocus 前生塔+回傳 entities（聚焦時提 depth 照亮）
        onCombatStart: () => wave.notifyTowerCombatStart(), // ★#2：聚焦結束→通知 WaveSystem 開 drip（波騎 WaveSystem 已有 public notifyTowerCombatStart method，正式型別呼叫）
      });
    };
    // 每摧毀一座尖塔 → 通知守護波累計（波騎判 towersDestroyed>=towerCount 過關提前 advance）。
    spawner.onTowerDestroyed = () => wave.notifyTowerDestroyed();
    // ★塔波結算（比照 GuardEvent.finish 發獎）：過關(won=true)→發寶盒進度給本地 P1；不論勝敗都收乾淨 intro。
    //   （多人獎勵分配之後另議，比照守護波先給 P1。）
    wave.onTowerWaveResult = (won: boolean) => {
      this.towerIntro?.forceFinish(); // 保險：波結束時若 intro 還在（極端 skip）→ 解鎖/清聚焦
      this.towerIntro = null;
      if (won) {
        const reward = this.towerRewardTickets; // E：波騎 preset rewardTickets（過關發寶盒進度給 P1，比照守護波發獎）
        this.ctx.chest.addCharge(this.ctx.player.playerId, reward);
        console.info(`[Tower] 過關！寶盒進度 +${reward}`);
      } else {
        console.info('[Tower] 失敗（時限內未打完），無獎勵，關卡續行');
      }
    };

    this.registerSystems();

    for (const sys of this.systems) {
      sys.init(this.ctx);
    }

    // 項目3 投幣進場循環：所有玩家（含 P1）開場站下方面板待機點、真空環隱藏、不可操控。
    // 需在 systems.init 之後（UISystem/BottomPanel 待機點就緒）。按 C 投幣才 EnterGame。
    for (const p of this.ctx.players) {
      const w = this.ctx.getWaitingAnchor(p.playerId);
      // 待機角色也抬同高度，站在台座頂面（跟台座 lift 對齊）。
      p.setWaiting(w.x, w.y - WAITING_PLATFORM_LIFT);
    }

    // 待機台座（立足平台）：每個有待機點的欄位畫一張台座 image（常駐）。
    // depth 介於面板(PANEL_DEPTH=1000)與待機角色(PANEL_DEPTH+10)之間 → 面板<台座<角色，
    // 台座看得見、角色站在台座上不被蓋。台座中心對齊待機點（角色腳踩台座頂面）。
    this.drawWaitingPlatforms();

    // 場景 shutdown（stop/restart/切場景）時，依序呼叫各 system.destroy()，
    // 釋放事件監聽/計時器，避免場景重啟累積殘留。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  /** 在每個有待機點的欄位畫待機台座（介於面板與待機角色之間的 depth）。 */
  private drawWaitingPlatforms(): void {
    if (!this.textures.exists(UI_ICONS.platform.key)) return; // 未載到台座圖則不畫（graceful）
    if (this.uiSystem?.isPlatformVisible?.() === false) return; // 用戶 #6：platform 勾掉 → 不畫待機台座
    const maxColumns = this.uiSystem?.getSlotCount?.() ?? this.ctx.players.length;
    for (let i = 0; i < maxColumns; i++) {
      const w = this.uiSystem?.getWaitingAnchor(i);
      if (!w) continue; // 該欄無待機點（未啟用）不畫
      // 用戶 #1：平台畫在待機角色「腳下」而非同中心，否則被角色身體蓋住看不見（俯視角台座本就在腳底）。
      // 角色待機中心在 (w.x, w.y - LIFT)；腳底約在中心下方 PLATFORM_FEET_OFFSET，台座擺此處露出、角色像站在上面。
      const charY = w.y - WAITING_PLATFORM_LIFT;
      const plat = this.add
        .image(w.x, charY + PLATFORM_FEET_OFFSET, UI_ICONS.platform.key)
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH + 5); // 面板(1000) < 台座(1005) < 待機角色(1010)
      // 用戶 #1：layout 'platform' element 有給尺寸則套（ui-editor 可調大小）；沒給用原生尺寸。
      if (w.w && w.h) plat.setDisplaySize(w.w, w.h);
    }
  }

  /** 待機點解析（委派 UISystem→BottomPanel）；未就緒回 undefined，由 ctx.getWaitingAnchor fallback。 */
  getWaitingAnchor(playerIndex: number): { x: number; y: number } | undefined {
    return this.uiSystem?.getWaitingAnchor(playerIndex);
  }

  /**
   * 註冊系統。順序 = 每幀執行順序（變身-leader 定）：
   *   Input → Credit → Energy → PlayerControl → Enemy → Transform → Combo → Ticket → Wave → UI → Debug。
   * InputSystem 排最前：每幀先 snapshot justPressed，後面系統該幀讀到一致值。
   * Credit/Energy 在 PlayerControl 前：閘門/放招/充能/耗盡狀態就緒供讀。
   * Transform 在 Enemy 後、UI 前：撿道具/變身/魂力更新後，UI 讀到當幀。
   * Combo/Ticket 在 PlayerControl 命中結算後、UI 前：連段倒數/結算彩票後 UI 讀當幀。
   * UI 排在各狀態更新之後；Debug 疊層排最末。新系統在這裡加一行即可。
   */
  private registerSystems(): void {
    const playerControl = new PlayerControlSystem();
    const enemy = new EnemySystem();
    // 十六輪(追加)：GrabSystem 掙脫成功→請求玩家強制真攻擊（揮開 grabber）；綁 hook 避免 GrabSystem 直接耦合 PlayerControlSystem。
    this.ctx.requestPlayerAttack = (pid: number) => playerControl.requestForcedAttack(pid);
    // 十六輪：充能式衝刺 UI 讀取接口綁定（界騎繪製衝刺充能格 + 冷卻壓黑）。
    this.ctx.getDashCharges = (pid: number) => playerControl.getDashCharges(pid);
    this.ctx.getDashMaxCharges = (pid: number) => playerControl.getDashMaxCharges(pid);
    this.ctx.getDashCooldownProgress = (pid: number) => playerControl.getDashCooldownProgress(pid);
    // 用戶新大功能：二段變身能量條 UI/特效讀取接口（界騎/特效後接；★flag 關時回 0/false）。
    this.ctx.getSecondTransformEnergyRatio = (pid: number) => this.ctx.transform.getSecondTransformEnergyRatio(pid);
    this.ctx.isSecondTransformActive = (pid: number) => this.ctx.transform.isSecondTransformActive(pid);
    this.ctx.isSecondTransformAvailable = (pid: number) => this.ctx.transform.isSecondTransformAvailable(pid);
    // InputSystem 同時是 ctx.input 服務與 registry member；排最前做輸入 snapshot。
    this.register(this.ctx.input);
    this.register(this.ctx.buff); // 計時 buff 框架（頭盔/寶盒共用）：早更新，效果供後面讀
    this.register(this.ctx.helmet); // 頭盔能力（讀 H 鍵套 buff）
    this.register(this.ctx.credit); // Credit：投幣/耗盡狀態 + 命中扣 credit 閘門
    this.register(this.ctx.energy); // 能量/招式：放招決策 + 充能狀態
    this.register(playerControl); // 玩家操控（讀 Input/Credit/Energy）
    this.register(enemy); // 敵人執行時（驅動 spawner）
    this.register(this.ctx.transform); // 變身：道具撿取/變身退變/魂力
    this.register(this.ctx.combo); // COMBO：連段倒數/結算彩票
    this.register(this.ctx.ticket); // 彩票計數器
    this.register(this.ctx.chest); // 寶盒：擊殺累積能量/自動開箱
    this.register(this.ctx.jp); // JP：幕通關給燈/命中累積倍數/集滿派彩
    this.register(this.ctx.wave); // 波次：生怪節奏 + 一幕通關事件（JP 接）
    this.register(new LevelProgressSystem()); // 關卡推進 step1：全波次打完→左通道→走進→notifyPortalEntered（掛 wave.onLevelCleared、update 查走進）
    if (this.mineTrapSystem) this.register(this.mineTrapSystem); // 2 新事件：地雷（讀取式每幀讀 getActiveMinePreset 自撒+推進延遲爆）
    this.register(new FireRainSystem()); // 天降火雨（守護波進行中觸發，只傷玩家）
    this.register(new GrabSystem()); // 抓人機制：沒打怪 8s → grabber 衝來抓、攻擊/倒數掙脫（per-player）
    this.register(new ProgressBarSystem()); // 頂部進度條 HUD：關卡進度 + 守護波倒數（讀 wave/guard）
    this.register(this.uiSystem); // HUD：唯讀當幀狀態刷新顯示（實例已於 create 提前建立）
    // DebugSystem 需讀玩家/敵人判定圖形；正式版可整包移除這行。
    this.register(new DebugSystem(playerControl, this.ctx.spawner));
  }

  private register(system: GameSystem): void {
    this.systems.push(system);
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    // 守護波聚焦定格（對齊 Unity Time.timeScale=0）：focus 期間玩法系統凍結（dt=0），
    //   但 WaveSystem 照跑真實 dt（驅動 GuardEvent focus 計時器結束聚焦，否則卡死）；聚焦 UI 是 scene.tweens 不受 dt 影響照播。
    const focusPause = this.ctx.guardFocusPause;
    for (const sys of this.systems) {
      sys.update(focusPause && sys.name !== 'WaveSystem' ? 0 : dt);
    }
    // ★塔波開場序列：用真實 dt tick（不吃 focusPause 凍結，否則聚焦計時器卡死；比照 WaveSystem 驅動 GuardEvent focus）。
    //   走位/聚焦期間 guardFocusPause 由序列自己開關；玩法系統照上面凍結。intro 完成 → 生塔已觸發、清空。
    if (this.towerIntro) {
      if (this.towerIntro.update(dt)) this.towerIntro = null;
    }
    // 用戶 #3：JP 燈 HUD 反映 JpSystem 各組 litCount（純顯示，僅變動時重繪）。
    // 十五輪：amountOf 傳派彩票面（倍數×JP_TICKET_FACE）→ JP 金額 live 反映 JpSystem。
    this.jpLampHud?.update(
      (g) => this.ctx.jp.getLights(g),
      (g) => this.ctx.jp.getMultiplier(g) * JP_TICKET_FACE,
    );
  }

  /** 場景關閉：依序清理每個 system，清空 registry。由 SHUTDOWN 事件觸發。 */
  private onShutdown(): void {
    for (const sys of this.systems) {
      sys.destroy?.();
    }
    // InputSystem 現在也是 registry member，destroy() 已在上面迴圈被呼叫，無需另外清。
    this.systems = [];
  }
}
