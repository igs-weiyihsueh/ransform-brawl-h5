import type { GameSystem } from '@/systems/GameSystem';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import type { FormationConfig, FormationType } from '@/config/formationConfig';
import { computeFormationSlots } from '@/config/formationConfig';
import { effectiveEnemyPlayBounds } from '@/config/mapConfig';
import { PPU } from '@/config/gameConfig';
import {
  DOUQI_SPAWN_CONFIG,
  DOUQI_ENEMY_STATS,
  DOUQI_LEVEL_CONFIG,
  DOUQI_EVENT_REWARD_CONFIG,
  type DouqiSpawnConfig,
} from '@/config/douqiConfig';
import {
  computeWaveQuota,
  currentSpawnIntervalMs,
  currentMaxAlive,
  filterUnlockedEntries,
  isBossWave,
  isEventWave,
  type DouqiSpawnEntry,
} from '@/systems/douqiSpawnMath';
import { pickWeightedType } from '@/systems/waveMath'; // ★單一來源：波騎抽出的共用輪盤（735ca1d，byte-gate 驗過）
import { DouqiTowerEvent } from '@/systems/DouqiTowerEvent';

/** 生怪驅動狀態機。 */
export type DouqiWaveState = 'spawning' | 'clearing' | 'intermission' | 'boss' | 'event' | 'won';

/** 事件種類（循環內序：3=塔、5=守護、7=佔領）。 */
export type DouqiEventKind = 'tower' | 'guard' | 'capture' | 'none';

/** v45 陣型類型名 → 我方 FormationType 映射（我方素材只有 Line/Triangle/Square/Circle/Hexagonal）。 */
const FORMATION_TYPE_MAP: Record<string, FormationType> = {
  matrix: 'Square', // 方陣
  ring: 'Circle', // 環
  line: 'Line', // 橫排
  wedge: 'Triangle', // 楔形/箭頭
  doubleRing: 'Hexagonal', // 雙環→用 Hexagonal 環數表達密集環
  scatter: 'Square', // 散佈→大方陣鬆散間隔
};

/**
 * DouqiSpawnSystem — 鬥氣模式 10 關生怪驅動（階段 3 後半）。
 *
 * ★與 normal WaveSystem **互斥註冊**（GameScene gameMode gate：douqi 才註冊本系統，同時 WaveSystem/
 *   LevelProgressSystem 不註冊）——同時只一個生怪驅動跑。★完全不動 WaveSystem 本體（波騎 file）。
 * ★quota/gate/過關 douqi 自寫（不套 normal shouldSpawnMore/shouldAdvanceSpawn，語意不合）。
 * ★沿用 ctx.spawner（EnemySpawner）生怪：spawn(type,x,y) 逐 slot（★per-slot pickWeightedType，
 *   spawnFormation 只支援單一 enemyType 故不用它、改自算 slot + 逐隻 spawn，順帶吃 onEnemySpawned 的 teamLevel scale）。
 *
 * 狀態機：spawning（accumulator 生陣型批次到 quota）→ clearing（生滿等清）→ 達 quota 分流：
 *   BOSS 關→boss（佔位，spawnBoss 留階段 5）、事件關→event（佔位，塔/守護/佔領圈留階段 4）、
 *   普通關→intermission（喘息）→ wave++ 開波首批立刻湧出。
 *
 * ★這批範圍（異靈定）：生怪驅動 + 10 關 quota + byWave 解鎖 + 陣型批次 + 過關分流骨架 +
 *   普通關完整跑通。boss/event 先做狀態機骨架（佔位＝簡單清場過關、不卡流程），具體留階段 4/5。
 */
export class DouqiSpawnSystem implements GameSystem {
  readonly name = 'DouqiSpawnSystem';

  private ctx!: GameContext;
  private readonly cfg: DouqiSpawnConfig = DOUQI_SPAWN_CONFIG;
  /** 取隊伍等級（GameScene 注入自 playerControlRef.getDouqiTeamLevel）。 */
  private readonly getTeamLevel: () => number;
  /** ★套鬥氣敵人 scale（GameScene 注入自 playerControlRef.scaleDouqiEnemy；傳 douqi 專屬 base HP/傷）。 */
  private readonly scaleEnemy: (enemy: Enemy, baseHp: number, baseDamage: number) => void;
  /** ★塔扇形命中玩家→二段能量倒扣（GameScene 注入自 spawner.onPlayerHit 語意）。 */
  private readonly onPlayerHitEnergy: (playerId: number) => void;
  /** ★事件成功獎勵回呼（GameScene 注入：發經驗/掉道具佔位）。 */
  private readonly grantEventReward: (expKills: number, dropCount: number, dropRingPx: number) => void;

  /** 當前事件（塔）。守護/佔領 commit2 加。 */
  private towerEvent: DouqiTowerEvent | null = null;
  private eventKind: DouqiEventKind = 'none';

  private state: DouqiWaveState = 'spawning';
  private currentWave = 1;
  private quota = 0;
  /** 本波已擊殺數（達 quota 分流）。 */
  private killed = 0;
  /** 本波已生成數（達 quota 轉 clearing 停生）。 */
  private spawned = 0;
  /** 生怪 accumulator（ms）。 */
  private spawnAccumMs = 0;
  /** 本波已存活秒（interval 遞減用）。 */
  private waveAliveSec = 0;
  /** 喘息結束時間戳（ms，performance.now 基準）。 */
  private intermissionUntil = 0;
  /** 佔位事件/BOSS 關的簡單計時（ms）——佔位期間清完就過，不卡流程。 */
  private placeholderElapsedMs = 0;

  constructor(
    getTeamLevel: () => number,
    scaleEnemy: (enemy: Enemy, baseHp: number, baseDamage: number) => void,
    onPlayerHitEnergy: (playerId: number) => void,
    grantEventReward: (expKills: number, dropCount: number, dropRingPx: number) => void,
  ) {
    this.getTeamLevel = getTeamLevel;
    this.scaleEnemy = scaleEnemy;
    this.onPlayerHitEnergy = onPlayerHitEnergy;
    this.grantEventReward = grantEventReward;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.startWave(1);
  }

  // ---- 對外查詢（HUD/probe/GameScene）----
  getState(): DouqiWaveState {
    return this.state;
  }
  getCurrentWave(): number {
    return this.currentWave;
  }
  getQuota(): number {
    return this.quota;
  }
  getKilled(): number {
    return this.killed;
  }

  /** GameScene 於 douqi onEnemyKilled 呼：本波擊殺 +1（過關判定）。塔不算入 quota。 */
  notifyKill(enemyKey: string): void {
    if (enemyKey === 'Enemy_Tower') return;
    if (this.state === 'won') return;
    this.killed += 1;
    this.checkWaveComplete();
  }

  update(dt: number): void {
    if (this.state === 'won') return;
    const dtMs = dt * 1000;
    switch (this.state) {
      case 'spawning':
        this.waveAliveSec += dt;
        this.tickSpawning(dtMs);
        break;
      case 'clearing':
        // 生滿等清：不再生怪，靠 notifyKill 達 quota 分流。
        break;
      case 'intermission':
        if (this.now() >= this.intermissionUntil) this.advanceToNextWave();
        break;
      case 'boss':
        // ★佔位：BOSS 具體留階段 5（簡單清場過關、不卡流程）。
        this.tickPlaceholder(dtMs);
        break;
      case 'event':
        this.tickEvent(dt, dtMs);
        break;
    }
  }

  // ---- 生怪核心 ----
  private tickSpawning(dtMs: number): void {
    // ★踩雷②：事件/BOSS 關由 checkWaveComplete 轉 state，spawning 只在普通生怪階段跑。
    if (this.spawned >= this.quota) {
      // 本波已生滿 quota → 轉 clearing（等玩家清完）。
      this.state = 'clearing';
      return;
    }
    this.spawnAccumMs += dtMs;
    const teamLevel = this.getTeamLevel();
    const interval = currentSpawnIntervalMs(this.waveAliveSec, teamLevel, this.cfg, DOUQI_LEVEL_CONFIG.cap);
    if (this.spawnAccumMs < interval) return;
    this.spawnAccumMs = 0;
    // ★踩雷⑥：同屏上限 × 等級 × 多人 aliveScale。達上限→這次不生（下次補）。
    const alive = this.countAlive();
    const maxAlive = currentMaxAlive(teamLevel, this.alivePlayerCount(), this.cfg, DOUQI_LEVEL_CONFIG.cap);
    if (alive >= maxAlive) return;
    this.spawnOneFormation();
  }

  /** 生一個陣型批次（typeWeights 挑類型 → computeFormationSlots 算座標 → 每 slot pickWeightedType 生怪）。 */
  private spawnOneFormation(): void {
    const rng = Math.random;
    // 陣型類型輪盤（enemyType 欄複用為陣型名 key；全解鎖故 currentWave 給 999 等效不過濾）。
    const formationName = pickWeightedType(this.formationEntries(), rng) ?? 'ring';
    const fType = FORMATION_TYPE_MAP[formationName] ?? 'Circle';
    const count = Math.round(
      this.cfg.formationCountMin + rng() * (this.cfg.formationCountMax - this.cfg.formationCountMin),
    );
    const config: FormationConfig = {
      type: fType,
      count,
      distance: this.cfg.formationSpacingUnit,
      facingDeg: 90, // 面向下（朝玩家區）
    };
    const slots = computeFormationSlots(config);
    const anchor = this.pickAnchor();
    // ★byWave 解鎖過濾（douqi 語意，我方 filterUnlockedEntries）→ 再丟波騎共用輪盤 pickWeightedType（單一來源）。
    // ★byWave 解鎖過濾（douqi 語意，我方 filterUnlockedEntries）→ 再丟波騎共用輪盤 pickWeightedType（單一來源）。
    //   entries 的 enemyType 欄裝**邏輯怪種名**（normal/tank/shooter…），供反查 DOUQI_ENEMY_STATS 專屬 base HP/傷。
    const typeEntries = filterUnlockedEntries(this.enemyTypeEntries(), this.currentWave);
    for (const slot of slots) {
      // ★别一次生超過 quota：生滿即停（殘留由 clearing 收）。
      if (this.spawned >= this.quota) break;
      const logicalName = pickWeightedType(typeEntries, rng) ?? 'normal';
      const stat = DOUQI_ENEMY_STATS[logicalName] ?? DOUQI_ENEMY_STATS.normal;
      const x = anchor.x + slot.x * PPU;
      const y = anchor.y + slot.y * PPU;
      const enemy = this.ctx.spawner.spawn(stat.spawnKey, x, y);
      // ★套鬥氣專屬 base HP/傷（DOUQI_ENEMY_STATS）× teamLevel scale——修「敵人恆 1~3 HP 秒殺」（原乘 normal config 3/2/10）。
      this.scaleEnemy(enemy, stat.maxHp, stat.attackDamage);
      this.applyTelegraph(enemy);
      this.spawned += 1;
    }
  }

  /** ★踩雷⑤：登場保護 spawnTelegraphMs——生成後半透明、不可傷不可被打（Enemy.setSpawnProtectionSec）。 */
  private applyTelegraph(enemy: Enemy): void {
    const ms = this.cfg.spawnTelegraphMs;
    if (ms <= 0) return;
    enemy.setSpawnProtectionSec(ms / 1000);
  }

  // ---- 過關/流程 ----
  private checkWaveComplete(): void {
    if (this.state === 'intermission' || this.state === 'won') return;
    if (this.killed < this.quota) return;
    // 達 quota 分流。
    if (isBossWave(this.currentWave, this.cfg.totalWaves)) {
      this.state = 'boss';
      this.placeholderElapsedMs = 0;
      this.spawnBossPlaceholder();
    } else if (isEventWave(this.currentWave, this.cfg.totalWaves, this.cfg.eventWaves)) {
      this.state = 'event';
      this.placeholderElapsedMs = 0;
      this.startEvent();
    } else {
      this.enterIntermission();
    }
  }

  private enterIntermission(): void {
    this.state = 'intermission';
    this.intermissionUntil = this.now() + this.cfg.intermissionMs;
    // showWaveClear：HUD 表演留 UI 端讀 getState()；此處只切狀態。
  }

  private advanceToNextWave(): void {
    const next = this.currentWave + 1;
    if (next > this.cfg.totalWaves) {
      this.state = 'won';
      return;
    }
    this.startWave(next, /*immediateBurst*/ true);
  }

  /**
   * 開新關卡：算 quota（+殘留怪計入，踩雷③）、歸零計數、state=spawning。
   * @param immediateBurst true 時當幀先生一批（踩雷④：開波首批立刻湧出、不冷場）。
   */
  private startWave(wave: number, immediateBurst = false): void {
    this.currentWave = wave;
    const baseQuota = computeWaveQuota(
      wave,
      this.cfg.quotaBase,
      this.cfg.quotaGrowth,
      this.cfg.preBossQuotaMult,
      this.cfg.quotaCap,
      this.cfg.totalWaves,
    );
    // ★踩雷③：殘留怪計入本波 quota（否則差幾隻清不完）。
    const residual = this.countAlive();
    this.quota = baseQuota + residual;
    this.killed = 0;
    this.spawned = 0;
    this.spawnAccumMs = 0;
    this.waveAliveSec = 0;
    this.state = 'spawning';
    if (immediateBurst) {
      this.spawnOneFormation(); // 開波首批立刻湧出
      this.spawnAccumMs = 0;
    }
  }

  // ---- BOSS / 事件 佔位（具體留階段 5 / 4，佔位不卡流程）----
  private spawnBossPlaceholder(): void {
    // 階段 5 具體 spawnBoss（大血量 Boss + 專屬行為）。佔位：不生額外物、短暫後過關（打倒第10關即通關）。
    // 目前佔位＝placeholder 計時到 → 通關（第10關）或進 intermission。
  }

  // ---- 事件（階段 4；塔 commit1，守護/佔領 commit2）----
  /** 循環內序決定事件種類：3=塔、5=守護、7=佔領。 */
  private eventKindForWave(wave: number): DouqiEventKind {
    const inCycle = ((wave - 1) % this.cfg.totalWaves) + 1;
    if (inCycle === 3) return 'tower';
    if (inCycle === 5) return 'guard';
    if (inCycle === 7) return 'capture';
    return 'none';
  }

  /** 啟動事件（★踩雷①已清 quota 才進 event；★踩雷②event state 不呼 tickSpawning＝停生一般怪）。 */
  private startEvent(): void {
    this.eventKind = this.eventKindForWave(this.currentWave);
    if (this.eventKind === 'tower') {
      this.towerEvent = new DouqiTowerEvent(this.ctx, this.getTeamLevel, this.onPlayerHitEnergy);
      this.towerEvent.start(this.currentWave);
    } else {
      // 守護/佔領 commit2；未實作前佔位（短暫後過關，不卡流程）。
      this.placeholderElapsedMs = 0;
    }
  }

  private tickEvent(dt: number, dtMs: number): void {
    if (this.eventKind === 'tower' && this.towerEvent) {
      this.towerEvent.update(dt);
      if (this.towerEvent.isComplete()) {
        this.completeEvent(/*success*/ true); // 打掉塔＝成功
      }
      return;
    }
    // 守護/佔領未實作前佔位（不卡流程）。
    this.placeholderElapsedMs += dtMs;
    if (this.placeholderElapsedMs >= 1200) this.completeEvent(false);
  }

  /** 事件結束：成功發獎（經驗+道具佔位）、清事件、進喘息（★失敗無獎但仍過關）。 */
  private completeEvent(success: boolean): void {
    if (success) {
      const r = DOUQI_EVENT_REWARD_CONFIG;
      this.grantEventReward(r.expKills, r.dropCount, r.dropRingPx);
    }
    this.towerEvent?.destroy();
    this.towerEvent = null;
    this.eventKind = 'none';
    this.enterIntermission();
  }

  // ---- 事件 HUD 查詢（GameScene/HUD 讀）----
  /** 當前事件種類（HUD 判要顯示塔血條/NPC 血條/佔領進度）。 */
  getEventKind(): DouqiEventKind {
    return this.eventKind;
  }
  /** 塔事件血條 ratio（僅 tower；其他回 -1）。 */
  getTowerHpRatio(): number {
    return this.eventKind === 'tower' && this.towerEvent ? this.towerEvent.getTowerHpRatio() : -1;
  }

  private tickPlaceholder(dtMs: number): void {
    this.placeholderElapsedMs += dtMs;
    // 佔位期間清完就過（不卡流程）：短暫延遲後分流。
    if (this.placeholderElapsedMs < 1200) return;
    if (this.state === 'boss' && this.currentWave >= this.cfg.totalWaves) {
      this.state = 'won'; // 第 10 關 BOSS 佔位打完＝通關（triggerClear 由 GameScene 讀 state 接 GameOverScene won）。
      return;
    }
    // 事件關 或 非最終 BOSS 關佔位 → 進喘息。
    this.enterIntermission();
  }

  // ---- helpers ----
  private now(): number {
    return this.ctx.scene.time.now;
  }

  private countAlive(): number {
    return this.ctx.getEnemies().filter((e) => !e.isDead() && !e.isTower()).length;
  }

  private alivePlayerCount(): number {
    return Math.max(1, this.ctx.players.length);
  }

  /** 生怪錨點：可走界內、離所有玩家 safeDistance、邊緣內縮（best-effort 挑點）。 */
  private pickAnchor(): { x: number; y: number } {
    const b = effectiveEnemyPlayBounds();
    const inset = this.cfg.edgeInsetPx;
    const minX = b.minX + inset;
    const maxX = b.maxX - inset;
    const minY = b.minY + inset;
    const maxY = b.maxY - inset;
    const safe = this.cfg.safeDistanceFromPlayerPx;
    const players = this.ctx.players.map((p) => p.getPosition());
    let best = { x: (minX + maxX) / 2, y: minY };
    let bestDist = -1;
    for (let i = 0; i < 12; i += 1) {
      const x = minX + Math.random() * Math.max(1, maxX - minX);
      const y = minY + Math.random() * Math.max(1, maxY - minY);
      let nearest = Infinity;
      for (const p of players) {
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < nearest) nearest = d;
      }
      if (nearest >= safe) return { x, y }; // 夠遠即用
      if (nearest > bestDist) {
        bestDist = nearest;
        best = { x, y };
      }
    }
    return best; // 都不夠遠→取最遠者
  }

  private formationEntries(): DouqiSpawnEntry[] {
    return Object.entries(this.cfg.formationWeights).map(([name, weight]) => ({
      enemyType: name, // 複用 enemyType 欄裝陣型名（波騎泛型只要 {enemyType,weight}）
      weight,
      unlockWave: 0,
    }));
  }

  /** byWave 解鎖的敵種輪盤項（enemyType = 邏輯怪種名，供反查 DOUQI_ENEMY_STATS 專屬 base；unlockWave 交 filterUnlockedEntries 過濾）。 */
  private enemyTypeEntries(): DouqiSpawnEntry[] {
    return Object.entries(DOUQI_ENEMY_STATS)
      .filter(([, s]) => s.spawnWeight > 0)
      .map(([name, s]) => ({ enemyType: name, weight: s.spawnWeight, unlockWave: s.unlockWave }));
  }
}
