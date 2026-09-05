import Phaser from 'phaser';
import { CHARACTERS } from '@/config/animationConfig';
import { chestChargeFor } from '@/config/chestConfig';
import { BACKGROUND_COLOR, GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
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
import { PlayerControlSystem } from '@/systems/PlayerControlSystem';
import { TransformSystem } from '@/systems/TransformSystem';
import { TicketSystem } from '@/systems/TicketSystem';
import { UISystem } from '@/systems/UISystem';
import { ProgressBarSystem } from '@/systems/ProgressBarSystem';
import { FireRainSystem } from '@/systems/FireRainSystem';
import { GrabSystem } from '@/systems/GrabSystem';
import { WaveSystem } from '@/systems/WaveSystem';

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
    UISystem.preload(this); // 載入 UI icon（coin/ticket/ring/chest/lamp）
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
    };

    // 能量飛光需在擊殺回呼裡取寶盒 UI 錨點：UISystem 提前建立（存 field，registerSystems 再註冊）。
    this.uiSystem = new UISystem();
    const uiSystem = this.uiSystem;
    const effectsRef = effects;

    // 擊殺 → 寶盒能量按「各 player 對這隻的傷害比例」分給各自 chest（決策 c61872a6）。
    // + 能量飛寶盒表演（第4項，純視覺）：每個有貢獻的 player 從敵人死亡位置飛一道識別色能量光
    //   到該 player 寶盒 UI 位置。⚠️ addCharge 維持即時加值、飛光只是疊加表演（數值/視覺解耦）。
    spawner.onEnemyKilled = (enemyKey, damageByPlayer, deathPos) => {
      const total = chestChargeFor(enemyKey);
      const shares = splitChestByDamage(total, damageByPlayer, player.playerId);
      for (const [pid, amount] of shares) {
        chest.addCharge(pid, amount); // 即時加值（不動時機/邏輯）
        if (amount <= 0) continue;
        const anchor = uiSystem.getChestAnchor(pid);
        if (anchor)
          effectsRef.flyEnergy(deathPos.x, deathPos.y, anchor.x, anchor.y, playerColor(pid));
      }
    };
    // 防穿透對所有 player（多人）：讓 spawner 讀 players[]。
    spawner.getAllPlayers = () => this.ctx.players;
    // hitFeel 表演注入：新生敵人受擊/死亡時播白閃/punch/火花/死亡粒子（純視覺）。
    spawner.hitFeelFx = effects;

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
    for (const sys of this.systems) {
      sys.update(dt);
    }
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
