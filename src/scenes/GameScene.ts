import Phaser from 'phaser';
import { CHARACTERS } from '@/config/animationConfig';
import { BACKGROUND_COLOR, GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import type { LevelData } from '@/config/levelSchema';
import { Player, PLAYER_CHARACTERS } from '@/entities/Player';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import { DebugSystem } from '@/systems/DebugSystem';
import { EffectSystem } from '@/systems/EffectSystem';
import { EnemySpawner } from '@/systems/EnemySpawner';
import { EnemySystem } from '@/systems/EnemySystem';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { InputSystem } from '@/systems/InputSystem';
import { PlayerControlSystem } from '@/systems/PlayerControlSystem';
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

  /** 載入全部角色逐幀圖 + 攻擊特效。 */
  preload(): void {
    for (const charKey of Object.keys(CHARACTERS)) {
      CharacterAnimator.preload(this, charKey);
    }
    EffectSystem.preload(this);
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

    // 共用 context（各 system 只透過它取服務/狀態）。
    this.ctx = {
      scene: this,
      worldBounds,
      player,
      input,
      effects,
      spawner,
      getEnemies: () => spawner.getEnemies(),
    };

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
   *   Input → PlayerControl → Enemy → Wave → UI → Debug。
   * InputSystem 排最前：每幀先 snapshot justPressed，後面系統該幀讀到一致值。
   * UI 排在玩家/敵人/波次更新之後，才讀到「當幀」狀態；Debug 疊層排最末。
   * 新系統在這裡加一行即可，無須改 update()。
   */
  private registerSystems(): void {
    const playerControl = new PlayerControlSystem();
    const enemy = new EnemySystem();
    // InputSystem 同時是 ctx.input 服務與 registry member；排最前做輸入 snapshot。
    this.register(this.ctx.input);
    this.register(playerControl); // 玩家操控（讀 Input 服務）
    this.register(enemy); // 敵人執行時（驅動 spawner）
    // 波次：試玩模式注入 previewLevels（跑編輯器送來的關卡）；一般玩家 undefined → WaveSystem 自行 fetch JSON。
    this.register(new WaveSystem(this.previewLevels));
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
