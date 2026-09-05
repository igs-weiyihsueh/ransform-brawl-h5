import Phaser from 'phaser';
import { loadLevels } from '@/config/levelLoader';
import type {
  EnemyType,
  LevelData,
  LevelNodeData,
  SpawnEntry,
  SpawnNodeData,
} from '@/config/levelSchema';
import type { Enemy } from '@/entities/Enemy';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { GuardEvent } from '@/systems/GuardEvent';

/**
 * WaveSystem — 波次/關卡系統（Spawn 節點核心，資料由 JSON 驅動）。
 *
 * 關卡資料來自 public/assets/data/levels.json（schema 見 config/levelSchema.ts，對照 Unity）。
 * 載入/驗證由 config/levelLoader.ts 負責（大聲失敗）。此系統依序跑當前關卡的節點：
 *  - Spawn 節點：滴流生怪，維持場上敵人數（存活 < spawnThreshold 時補到 maxAlive、
 *    受 spawnInterval 節流），按權重挑敵種呼叫 ctx.spawner.spawn，殺到 killQuota → 前進。
 *  - Reward / Event 節點：本階段先 stub，直接跳過（schema 已定型，流程之後接）。
 *
 * 只透過 GameContext 取服務（spawner / getEnemies / worldBounds / player），
 * 不碰 Enemy / EnemySpawner / GameScene 內部（見 docs/h5_collab_spec.md §1、§4）。
 *
 * 載入時機：init(ctx) 內自行 fetch 關卡 JSON（不需 GameScene/BootScene 配合、
 * 不改共用契約）。JSON 就緒前 update() 安靜 no-op（不生怪）；載入或驗證失敗時
 * loader 已大聲報錯並拋例外，WaveSystem 保持未啟用（不會靜默假裝正常）。
 *
 * 擊殺數：EnemySpawner 未提供擊殺回呼，死亡敵人會於下一幀被清除。本系統自行追蹤
 * 「自己生出的敵人」參照，每幀比對是否 isDead() 或已從 ctx.getEnemies() 消失來累計擊殺。
 * 完全自足、零共用契約改動。
 */
export class WaveSystem implements GameSystem {
  readonly name = 'WaveSystem';

  private ctx!: GameContext;

  /** 已載入並驗證的關卡；載入完成前為 null，update() 期間 no-op。 */
  private levels: LevelData[] | null;
  /** 目前執行的關卡索引。 */
  private levelIndex = 0;
  /** 目前節點索引。 */
  private nodeIndex = 0;
  /** 本 Spawn 節點已累計的擊殺數。 */
  private kills = 0;
  /** 距下一次可生怪的倒數（秒）；受 spawnInterval 節流。 */
  private spawnCooldown = 0;
  /** 本系統生出、目前仍追蹤中的敵人（用來偵測擊殺）。 */
  private tracked: Enemy[] = [];

  /** 一幕通關回呼（本關 nodes 全跑完時觸發，供 JP 給燈）。 */
  onStageClear: (() => void) | null = null;

  /** 進行中的守護波（Event 節點）；null 表示非守護波。 */
  private guardEvent: GuardEvent | null = null;

  /** debug/UI：目前守護波（若有）。 */
  getGuardEvent(): GuardEvent | null {
    return this.guardEvent;
  }

  /**
   * @param preloadedLevels 選填：直接注入已驗證的關卡（測試/編輯器預覽用）。
   *   不給時，init() 會自行從 levels.json 載入。
   */
  constructor(preloadedLevels?: LevelData[]) {
    this.levels = preloadedLevels ?? null;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    if (this.levels) {
      this.enterNode(0);
      return;
    }
    // 自行載入 JSON；就緒後啟用。失敗由 loader 大聲報錯並拋例外。
    void loadLevels().then((levels) => {
      this.levels = levels;
      this.levelIndex = 0;
      this.enterNode(0);
    });
  }

  update(dt: number): void {
    if (!this.levels) return; // JSON 尚未就緒 → 安靜等待（不生怪）
    const node = this.currentNode();
    if (!node) return; // 全部節點跑完

    if (node.nodeType === 'Spawn') {
      this.updateSpawnNode(node, dt);
    } else if (node.nodeType === 'Event') {
      this.updateEventNode(node, dt);
    } else {
      // Reward：stub，直接前進（schema 已定，流程之後接）。
      this.advanceNode();
    }
  }

  /** Event 節點（守護波）：首次進入建 GuardEvent，每幀 tick，結束前進節點。 */
  private updateEventNode(node: { eventPresetName: string }, dt: number): void {
    if (!this.guardEvent) {
      // 守護波敵種/drip 全由 preset 決定（不動凍結的 levelSchema）。
      this.guardEvent = new GuardEvent(this.ctx, node.eventPresetName);
    }
    const done = this.guardEvent.update(dt);
    if (done) {
      this.guardEvent = null;
      this.advanceNode();
    }
  }

  // ---- 節點流程 -------------------------------------------------------------

  private currentLevel(): LevelData | undefined {
    return this.levels?.[this.levelIndex];
  }

  private currentNode(): LevelNodeData | undefined {
    return this.currentLevel()?.nodes[this.nodeIndex];
  }

  /** 進入目前關卡的指定節點索引，重置節點狀態。 */
  private enterNode(index: number): void {
    this.nodeIndex = index;
    this.kills = 0;
    this.spawnCooldown = 0;
    this.tracked = [];
  }

  /** 前進到下一節點；本關跑完則進下一關（皆無則停在尾端）。 */
  private advanceNode(): void {
    const level = this.currentLevel();
    if (!level) return;
    if (this.nodeIndex + 1 < level.nodes.length) {
      this.enterNode(this.nodeIndex + 1);
    } else if (this.levels && this.levelIndex + 1 < this.levels.length) {
      // 本關 nodes 全跑完 = 一幕通關。
      this.onStageClear?.();
      this.levelIndex += 1;
      this.enterNode(0);
    } else {
      // 全破：最後一關 nodes 全跑完 = 一幕通關（也算）。
      this.onStageClear?.();
      this.nodeIndex = level.nodes.length;
    }
  }

  // ---- Spawn 節點 -----------------------------------------------------------

  private updateSpawnNode(node: SpawnNodeData, dt: number): void {
    this.tallyKills();

    // 波次×人數（多人遷移 S5）：killQuota/maxAlive 依人數縮放。
    const scale = this.playerCountScale();
    const killQuota = Math.round(node.killQuota * scale);
    const maxAlive = Math.round(node.maxAlive * scale);
    const spawnThreshold = Math.round(node.spawnThreshold * scale);

    if (this.kills >= killQuota) {
      this.advanceNode();
      return;
    }

    if (this.spawnCooldown > 0) {
      this.spawnCooldown -= dt;
    }

    const alive = this.tracked.length;
    // 存活 < spawnThreshold 時，滴流補到 maxAlive（每 spawnInterval 生一隻）。
    if (alive < spawnThreshold && this.spawnCooldown <= 0 && alive < maxAlive) {
      this.spawnOne(node.spawns);
      this.spawnCooldown = node.spawnInterval;
    }
  }

  /** 依人數的難度係數：1人×1 / 2人×1.5 / 3人×2 / 4人×2.5（playerCount=players[].length）。 */
  private playerCountScale(): number {
    const n = Math.max(1, this.ctx.players.length);
    return 1 + (n - 1) * 0.5;
  }

  /**
   * 統計擊殺：追蹤中的敵人凡已死亡或已從場上快照消失者計為一次擊殺並移出追蹤。
   */
  private tallyKills(): void {
    const livingSet = new Set<Enemy>(this.ctx.getEnemies());
    const still: Enemy[] = [];
    for (const e of this.tracked) {
      if (e.isDead() || !livingSet.has(e)) {
        this.kills += 1;
      } else {
        still.push(e);
      }
    }
    this.tracked = still;
  }

  /** 依權重挑一種敵人，在合理位置生成並納入追蹤。 */
  private spawnOne(spawns: SpawnEntry[]): void {
    const type = this.pickWeighted(spawns);
    if (!type) return;
    const { x, y } = this.pickSpawnPosition();
    const enemy = this.ctx.spawner.spawn(type, x, y);
    this.tracked.push(enemy);
  }

  /** 輪盤法：依相對權重挑一個敵種。 */
  private pickWeighted(spawns: SpawnEntry[]): EnemyType | null {
    if (spawns.length === 0) return null;
    let total = 0;
    for (const s of spawns) total += Math.max(0, s.weight);
    if (total <= 0) return spawns[0].enemyType;
    let r = Math.random() * total;
    for (const s of spawns) {
      r -= Math.max(0, s.weight);
      if (r <= 0) return s.enemyType;
    }
    return spawns[spawns.length - 1].enemyType;
  }

  /** 選生怪位置：世界邊界內留邊距隨機取點，避免生在玩家身上。 */
  private pickSpawnPosition(): { x: number; y: number } {
    const bounds = this.ctx.worldBounds;
    const margin = 80; // 邊距（像素）
    const minX = bounds.x + margin;
    const maxX = bounds.x + bounds.width - margin;
    const minY = bounds.y + margin;
    const maxY = bounds.y + bounds.height - margin;

    const playerPos = this.ctx.player.getPosition();
    const minDistFromPlayer = 300; // 像素

    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      x = Phaser.Math.Between(minX, maxX);
      y = Phaser.Math.Between(minY, maxY);
      if (Math.hypot(x - playerPos.x, y - playerPos.y) >= minDistFromPlayer) {
        break;
      }
    }
    return { x, y };
  }
}
