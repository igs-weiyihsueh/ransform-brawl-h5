import Phaser from 'phaser';
import {
  DEFAULT_LEVEL,
  type EnemyWeight,
  type LevelConfig,
  type SpawnNode,
  type WaveNode,
} from '@/config/levelConfig';
import type { Enemy } from '@/entities/Enemy';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * WaveSystem — 波次/關卡系統（Spawn 節點核心）。
 *
 * 關卡是節點序列（見 config/levelConfig.ts，對照 Unity）。此系統依序跑節點：
 *  - Spawn 節點：滴流生怪，維持場上敵人數到 maxAlive（存活 < spawnThreshold 時補、
 *    受 spawnInterval 節流），按權重挑敵種呼叫 ctx.spawner.spawn，殺到 killQuota → 前進。
 *  - Reward / Event 節點：本階段先 stub，直接跳過（之後接發獎/守護流程）。
 *
 * 只透過 GameContext 取服務（spawner / getEnemies / worldBounds / player），
 * 不碰 Enemy / EnemySpawner / GameScene 內部（見 docs/h5_collab_spec.md §1、§4）。
 *
 * 擊殺數取得方式：EnemySpawner 目前未提供擊殺回呼或擊殺計數 API，
 * 且死亡敵人會被 spawner 於下一幀從清單移除。為不動共用契約，本系統自行追蹤
 * 「自己生出的敵人」的參照：每幀比對這些敵人是否已死亡（Enemy.isDead()）或已從
 * ctx.getEnemies() 消失，據此累計擊殺數。此法完全自足、零共用契約改動。
 *   （若未來要更精準/更省的擊殺回呼，屬 spawner 的 additive 契約改動 → 走異靈。）
 */
export class WaveSystem implements GameSystem {
  readonly name = 'WaveSystem';

  private ctx!: GameContext;
  private readonly level: LevelConfig;

  /** 目前節點索引。 */
  private nodeIndex = 0;
  /** 本 Spawn 節點已累計的擊殺數。 */
  private kills = 0;
  /** 距下一次可生怪的倒數（秒）；受 spawnInterval 節流。 */
  private spawnCooldown = 0;

  /** 本系統生出、目前仍追蹤中的敵人（用來偵測擊殺）。 */
  private tracked: Enemy[] = [];

  constructor(level: LevelConfig = DEFAULT_LEVEL) {
    this.level = level;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.enterNode(0);
  }

  update(dt: number): void {
    const node = this.currentNode();
    if (!node) return; // 關卡跑完

    if (node.type === 'spawn') {
      this.updateSpawnNode(node, dt);
    } else {
      // Reward / Event：stub，直接前進（之後接流程）。
      this.advanceNode();
    }
  }

  // ---- 節點流程 -------------------------------------------------------------

  private currentNode(): WaveNode | undefined {
    return this.level.nodes[this.nodeIndex];
  }

  /** 進入指定索引的節點，重置該節點狀態。 */
  private enterNode(index: number): void {
    this.nodeIndex = index;
    this.kills = 0;
    this.spawnCooldown = 0;
    this.tracked = [];
  }

  /** 前進到下一節點（若已是最後一個則停在尾端）。 */
  private advanceNode(): void {
    if (this.nodeIndex < this.level.nodes.length) {
      this.enterNode(this.nodeIndex + 1);
    }
  }

  // ---- Spawn 節點 -----------------------------------------------------------

  private updateSpawnNode(node: SpawnNode, dt: number): void {
    this.tallyKills();

    // 完成條件：殺到 killQuota → 前進。
    if (this.kills >= node.killQuota) {
      this.advanceNode();
      return;
    }

    // 滴流補怪節流。
    if (this.spawnCooldown > 0) {
      this.spawnCooldown -= dt;
    }

    const alive = this.aliveTrackedCount();
    // 場上存活 < spawnThreshold 時，補到 maxAlive（受 spawnInterval 節流，一次補一隻）。
    if (alive < node.spawnThreshold && this.spawnCooldown <= 0) {
      // 不一次補滿：每 spawnInterval 生一隻，直到達 maxAlive；
      // 「補到 maxAlive」的語意由持續補怪達成，門檻只決定「何時開始補」。
      if (alive < node.maxAlive) {
        this.spawnOne(node.weights);
        this.spawnCooldown = node.spawnInterval;
      }
    }
  }

  /**
   * 統計擊殺：比對追蹤中的敵人，凡已死亡或已從場上消失者計為一次擊殺並移出追蹤。
   * 用 getEnemies() 的當前快照判斷「是否還在場上」，避免只靠 isDead() 漏掉
   * 已被 spawner 清除的敵人。
   */
  private tallyKills(): void {
    const living = this.ctx.getEnemies();
    const livingSet = new Set<Enemy>(living);
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

  /** 目前仍在追蹤（= 場上存活、由本系統生的）敵人數。 */
  private aliveTrackedCount(): number {
    return this.tracked.length;
  }

  /** 依權重挑一種敵人，在合理位置生成並納入追蹤。 */
  private spawnOne(weights: EnemyWeight[]): void {
    const type = this.pickWeighted(weights);
    if (!type) return;
    const { x, y } = this.pickSpawnPosition();
    const enemy = this.ctx.spawner.spawn(type, x, y);
    this.tracked.push(enemy);
  }

  /** 輪盤法：依相對權重挑一個敵種 key。 */
  private pickWeighted(weights: EnemyWeight[]): string | null {
    if (weights.length === 0) return null;
    let total = 0;
    for (const w of weights) total += Math.max(0, w.weight);
    if (total <= 0) return weights[0].type;
    let r = Math.random() * total;
    for (const w of weights) {
      r -= Math.max(0, w.weight);
      if (r <= 0) return w.type;
    }
    return weights[weights.length - 1].type;
  }

  /**
   * 選生怪位置：在世界邊界內留邊距隨機取點，並避免生在玩家身上（太近則重取幾次）。
   */
  private pickSpawnPosition(): { x: number; y: number } {
    const bounds = this.ctx.worldBounds;
    const margin = 80; // 邊距（像素），避免貼邊生成
    const minX = bounds.x + margin;
    const maxX = bounds.x + bounds.width - margin;
    const minY = bounds.y + margin;
    const maxY = bounds.y + bounds.height - margin;

    const playerPos = this.ctx.player.getPosition();
    const minDistFromPlayer = 300; // 像素：不要生在玩家臉上

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
