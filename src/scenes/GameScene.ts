import Phaser from 'phaser';
import { CHARACTERS } from '@/config/animationConfig';
import { chestChargeFor } from '@/config/chestConfig';
import { BACKGROUND_COLOR, GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import type { LevelData } from '@/config/levelSchema';
import { Player, PLAYER_CHARACTERS } from '@/entities/Player';
import { BuffSystem } from '@/systems/BuffSystem';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
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

    // 共用 context（各 system 只透過它取服務/狀態）。
    this.ctx = {
      scene: this,
      worldBounds,
      players: [player], // 多人遷移 S1：player 實體當 players[0]
      // player = 本地人類 P1 = players[0]（getter alias，現有讀 ctx.player 的碼不動）。
      get player(): Player {
        return this.players[0];
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

    // 擊殺 → 給寶盒能量（依敵人類型 chestChargeFor）。
    spawner.onEnemyKilled = (enemyKey) => chest.addCharge(chestChargeFor(enemyKey));

    this.registerSystems();

    for (const sys of this.systems) {
      sys.init(this.ctx);
    }

    // 場景 shutdown（stop/restart/切場景）時，依序呼叫各 system.destroy()，
    // 釋放事件監聽/計時器，避免場景重啟累積殘留。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
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
    this.register(new UISystem()); // HUD：唯讀當幀狀態刷新顯示
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
