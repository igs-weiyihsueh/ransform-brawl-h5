import { loadLevels } from '@/config/levelLoader';
import { SPAWN_WARNING_DURATION_SEC, ENEMY_BODY_RADIUS_PX } from '@/config/enemyConfig';
import { ENEMY_PLAY_BOUNDS, insetBounds } from '@/config/mapConfig';
import {
  type FireRainPreset,
  resolveNodeFireRain,
} from '@/config/fireRainConfig';
import {
  getResolvedFireRainPreset,
  isResolvedFireRainPreset,
} from '@/config/fireRainSchema';
import { getResolvedGuardPreset } from '@/config/guardSchema';
import { shouldSpawnMore, shouldAdvanceSpawn, pickSpawnPoint } from '@/systems/waveMath';
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
import { waveMessageFor, WAVE_MESSAGE_FX } from '@/systems/waveMessage';

/** 獎勵節點報獎演出保持時間（秒，用戶 #3：banner 浮現 0.35 + 停 3s + 退出/飛光 ≈ 0.35+3+0.3+0.7）。 */
const REWARD_HOLD_SEC = 4.4;

/**
 * 獎勵節點「進度段自動填滿」補間時長（秒，對齊 Unity RunRewardNode rewardFillDuration，預設 0.6）。
 * Reward 表演末段：進度條該獎勵段 currentSegmentProgress 0→1 lerp 自動填滿（非瞬跳）再前進下一節點。
 * 排在報獎流程（banner+飛光點燈）之後 → 用 hold 的最後 REWARD_FILL_DURATION 秒做填滿動畫。
 */
const REWARD_FILL_DURATION = 0.6;

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
  /** spawn 世代 token（enterNode/skip 遞增）：作廢舊節點已排程但未觸發的 spawnWarning doSpawn，清「正在出生的怪」。 */
  private spawnGeneration = 0;
  /** 進行中的召喚陣視覺 handle（spawnWarning 回傳）：skip/換節點 cancel 清視覺，doSpawn 完成自移除。 */
  private activeSpawnWarnings: { cancel: () => void }[] = [];
  /** 累計 Spawn 波序（跨關 1-based，過場提示「第 N 波」用）。 */
  private spawnWaveNumber = 0;
  /** 距下一次可生怪的倒數（秒）；受 spawnInterval 節流。 */
  private spawnCooldown = 0;
  /** 補怪遲滯 latch（用戶：補怪門檻補到 maxAlive）：存活跌破 spawnThreshold 開、達 maxAlive 關；補怪中持續補到滿。 */
  private spawnRefilling = false;
  /** 本系統生出、目前仍追蹤中的敵人（用來偵測擊殺）。 */
  private tracked: Enemy[] = [];
  /** 預警中（登場預警圈淡入中、敵人尚未生成）的數量：計入 alive，避免預警期間超生。 */
  private pendingSpawns = 0;

  /** 一幕通關回呼（本關 nodes 全跑完時觸發，供 JP 給燈）。 */
  onStageClear: (() => void) | null = null;

  /** 獎勵節點回呼（用戶 #3：進 Reward 節點時觸發一次，供 GameScene 播報獎演出+點 JP 燈）。 */
  onReward: (() => void) | null = null;
  /** 獎勵演出保持計時（進 Reward 節點時設，倒數完才前進，讓報獎演出播完）。 */
  private rewardHold = 0;

  /** 進行中的守護波（Event 節點）；null 表示非守護波。 */
  private guardEvent: GuardEvent | null = null;

  /** Debug（N 熱鍵，搬自 Unity LevelProgressManager skipCurrentNode）：強制完成當前節點、跳下一個。 */
  private skipRequested = false;

  /** 純火雨 Event 節點狀態（用戶試玩#4）：active + 剩餘時間（跑完前進節點）。 */
  private fireRainActive = false;
  private fireRainRemaining = 0;

  /**
   * 用戶：火雨訊息要晚於「第 N 波」波次宣告。進節點時若帶 attachFireRain，設此延遲秒數，
   * 期間 getActiveFireRainPreset() 對 Spawn 節點回 null（FireRainSystem 因此延後 start()→「天降火雨！」宣告），
   * 讓波次宣告先顯示、火雨訊息接在其後。倒數在 update() 遞減；<=0 才開放火雨。
   */
  private fireRainGateSec = 0;

  /** debug/UI：目前守護波（若有）。 */
  getGuardEvent(): GuardEvent | null {
    return this.guardEvent;
  }

  /** Debug（N 熱鍵，搬自 Unity LevelProgressManager:103）：請求強制完成當前節點、跳下一個。下一幀 update() 處理。 */
  requestSkipCurrentNode(): void {
    this.skipRequested = true;
  }

  /**
   * 目前該不該降火雨 + 用哪組參數（用戶#2 修正版，FireRainSystem 讀此驅動）：
   * - 任何 Spawn 節點帶 attachFireRain（火雨 preset 名）→ 該波次進行時降該火雨（附加，取代舊獨立 Event 火雨節點）。
   * - 守護波進行中且守護 preset 帶 attachFireRain（火雨 preset 名）→ 該火雨（守護+火雨）。
   * - 舊：純火雨 Event 節點（eventPresetName=火雨 preset）→ 仍相容（resolveFireRainForEvent 認得）。
   * - 否則 → null（不降火雨）。
   */
  getActiveFireRainPreset(): FireRainPreset | null {
    const node = this.currentNode();
    // 用戶#2：Spawn 節點附加火雨（該波進行中即降）。
    // 用戶：火雨訊息晚於波次宣告 → 進節點後有 fireRainGateSec 延遲窗，期間對 Spawn 回 null，
    //   讓「第 N 波」先顯示；延遲跑完（gate<=0）才開放火雨（FireRainSystem 隨即 start→「天降火雨！」）。
    if (node?.nodeType === 'Spawn') {
      if (this.fireRainGateSec > 0) return null; // 波次宣告尚在顯示中 → 火雨先按住
      const attach = (node as { attachFireRain?: string }).attachFireRain;
      if (attach) return getResolvedFireRainPreset(attach);
    }
    // 舊相容：純火雨 Event 節點（eventPresetName 為火雨 preset）。
    if (this.fireRainActive && node?.nodeType === 'Event') {
      const en = (node as { eventPresetName: string }).eventPresetName;
      return isResolvedFireRainPreset(en) ? getResolvedFireRainPreset(en) : null;
    }
    // 守護波 + 守護 preset 帶火雨 preset 名。六輪#1：node.attachFireRain 三態可 per-node 覆蓋 preset 預設。
    // 十四輪：★只在 combat phase 才降火雨（對齊 Unity 解暗後 StartNodeModifiers）——開場 introMove/reveal/focus
    //   聚焦壓黑期間場上乾淨（無怪無火雨），解暗後(combat)才與生怪同時降。避免聚焦期間火雨太早下。
    if (this.guardEvent && !this.guardEvent.isFinished() && this.guardEvent.isCombatPhase()) {
      const preset = getResolvedGuardPreset((node as { eventPresetName?: string })?.eventPresetName);
      const raw = (node as { attachFireRain?: string }).attachFireRain;
      // undefined→沿用 preset.attachFireRain；'none'→null 無火雨；其餘→該 preset 名。
      const chosen = resolveNodeFireRain(raw, preset.attachFireRain);
      return chosen ? getResolvedFireRainPreset(chosen) : null;
    }
    return null;
  }

  /** 目前關卡節點索引（0-based，進度條用：已完成節點數）。 */
  getNodeIndex(): number {
    return this.nodeIndex;
  }

  /** 目前關卡索引（0-based）。FireRainSystem 用來判斷「換關」以重播火雨宣告（七輪#4）。 */
  getLevelIndex(): number {
    return this.levelIndex;
  }

  /** 目前關卡總節點數（進度條分母）；無關卡時 0。 */
  getNodeCount(): number {
    return this.currentLevel()?.nodes.length ?? 0;
  }

  /** 目前關卡各節點類型序列（進度條 marker 用：'Spawn'|'Reward'|'Event'）；無關卡時空陣列。 */
  getNodeTypes(): string[] {
    return this.currentLevel()?.nodes.map((n) => n.nodeType) ?? [];
  }

  /**
   * 目前節點內的完成進度（0..1，進度條珠子串繩「當前段填充」用）。
   * - Spawn：kills / killQuota（隨擊殺往前；開場 kills=0 → 0）。
   * - Event（守護波）：已過時間 / timeLimit（守護進行中往前；未開始 → 0）。
   * - Reward：報獎流程期間 0；末段 REWARD_FILL_DURATION 秒 0→1 lerp 自動填滿（對齊 Unity rewardFillDuration）。
   * - 其他 / 無節點：0（不預填）。
   * 開場 kills=0、守護未開始 → 回 0，修正「開場就有進度」。
   */
  getNodeProgress(): number {
    const node = this.currentNode();
    if (!node) return 0;
    if (node.nodeType === 'Spawn') {
      const quota = Math.round((node as SpawnNodeData).killQuota * this.playerCountScale());
      if (quota <= 0) return 0;
      return Math.min(1, Math.max(0, this.kills / quota));
    }
    if (node.nodeType === 'Event') {
      const g = this.guardEvent;
      if (!g) return 0;
      const limit = g.getTimeLimit();
      if (limit <= 0) return 0;
      return Math.min(1, Math.max(0, 1 - g.getRemaining() / limit));
    }
    if (node.nodeType === 'Reward') {
      // 報獎流程（banner+飛光點燈）期間進度 0；末段 REWARD_FILL_DURATION 內 0→1 自動填滿（Unity rewardFillDuration）。
      if (this.rewardHold <= 0) return 0; // 尚未進入或已結束
      if (this.rewardHold > REWARD_FILL_DURATION) return 0; // 報獎流程階段，尚未開始填滿
      return Math.min(1, Math.max(0, 1 - this.rewardHold / REWARD_FILL_DURATION)); // 末段 lerp 0→1
    }
    return 0;
  }

  /**
   * 是否正在獎勵節點表演中（供 ComboSystem 凍結 COMBO 倒數，對齊 Unity comboFrozen；非戰鬥空檔不倒扣）。
   * ComboSystem update 讀 ctx.wave.isRewardActive?.() → true 時暫停 COMBO 倒數計時。（read-side query，不碰 COMBO 內部。）
   */
  isRewardActive(): boolean {
    return this.currentNode()?.nodeType === 'Reward' && this.rewardHold > 0;
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

    // 用戶：火雨訊息晚於波次宣告 → 進節點後 gate 倒數，期間 getActiveFireRainPreset 對 Spawn 回 null。
    if (this.fireRainGateSec > 0) this.fireRainGateSec = Math.max(0, this.fireRainGateSec - dt);

    // Debug（N 熱鍵）：強制完成當前節點、跳下一個（搬自 Unity skipCurrentNode）。
    //   守護波→forceFinish 乾淨結束(cleanup 雕像/清怪/解鎖/spotlight)；火雨→清 active；Spawn/Reward→直接 advance。
    if (this.skipRequested) {
      this.skipRequested = false;
      if (this.guardEvent && !this.guardEvent.isFinished()) {
        this.guardEvent.forceFinish(); // 內含 cleanup（setGuardTarget(null)/clearAllEnemies/destroy 雕像/解鎖）
        this.guardEvent = null;
      }
      this.fireRainActive = false;
      this.fireRainRemaining = 0;
      this.rewardHold = 0;
      // 對齊 Unity：節點跳過（skip）→ ClearAllActiveEnemies 清場上所有怪，別把舊怪帶進下一節點。
      //   守護波 forceFinish 已清（再清一次無害/冪等）；Spawn/火雨/Reward skip 靠這行補清。
      this.ctx.spawner.clearAllEnemies();
      this.advanceNode(); // enterNode 會重置 kills/cooldown 等（進新節點）
      return;
    }

    if (node.nodeType === 'Spawn') {
      this.updateSpawnNode(node, dt);
    } else if (node.nodeType === 'Event') {
      this.updateEventNode(node, dt);
    } else {
      // Reward（用戶 #3）：進節點時觸發一次報獎演出（onReward），保持一段時間讓演出播完再前進。
      if (this.rewardHold <= 0) {
        this.rewardHold = REWARD_HOLD_SEC;
        this.onReward?.();
      }
      this.rewardHold -= dt;
      if (this.rewardHold <= 0) {
        this.rewardHold = 0;
        this.advanceNode();
      }
    }
  }

  /** Event 節點：火雨 preset → 純火雨波（計時）；否則守護波（建 GuardEvent）。 */
  private updateEventNode(node: { eventPresetName: string }, dt: number): void {
    // 純火雨 Event 節點（eventPresetName 是火雨 preset）：計時跑完前進，不建守護/雕像。
    if (isResolvedFireRainPreset(node.eventPresetName)) {
      const preset = getResolvedFireRainPreset(node.eventPresetName);
      if (this.fireRainRemaining <= 0 && !this.fireRainActive) {
        this.fireRainActive = true;
        this.fireRainRemaining = preset.durationSec;
      }
      this.fireRainRemaining -= dt;
      if (this.fireRainRemaining <= 0) {
        this.fireRainActive = false;
        this.advanceNode();
      }
      return;
    }
    // 守護波（含可選 attachFireRain）。
    if (!this.guardEvent) {
      // 七輪：守護 preset 決定時限/HP/演出；drip（補怪）可由 Event 節點 per-node 覆蓋（node.X ?? preset.X）。
      this.guardEvent = new GuardEvent(this.ctx, node.eventPresetName, {
        maxAlive: (node as { maxAlive?: number }).maxAlive,
        spawnThreshold: (node as { spawnThreshold?: number }).spawnThreshold,
        spawnInterval: (node as { spawnInterval?: number }).spawnInterval,
        spawns: (node as { spawns?: { enemyType: string; weight: number }[] }).spawns,
      });
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

  /**
   * 六輪#5：下一節點是否也是 Spawn（同關內；本關尾則看下一關首節點；皆無則 false）。
   * 用於 shouldAdvanceSpawn：Spawn→Spawn 不清場、殘怪接續帶進下一波（維持場面不空一下）。
   */
  private nextNodeIsSpawn(): boolean {
    const level = this.currentLevel();
    if (!level) return false;
    const next = level.nodes[this.nodeIndex + 1];
    if (next) return next.nodeType === 'Spawn';
    // 本關跑完：看下一關首節點（跨關銜接也維持）。
    const nl = this.levels?.[this.levelIndex + 1];
    return nl?.nodes[0]?.nodeType === 'Spawn';
  }

  /** 進入目前關卡的指定節點索引，重置節點狀態。 */
  private enterNode(index: number): void {
    this.nodeIndex = index;
    this.kills = 0;
    this.spawnCooldown = 0;
    this.spawnRefilling = true; // 新節點：先補到 maxAlive（達上限才關 latch）
    this.tracked = [];
    this.pendingSpawns = 0; // 換節點清預警帳
    this.spawnGeneration += 1; // 遞增世代 → 作廢舊節點已排程但未觸發的 spawnWarning doSpawn（N skip/換節點都清「正在出生的怪」）
    this.clearActiveSpawnWarnings(); // 換節點/skip 清進行中召喚陣視覺（cancel 立即消失，不殘留地上圈）
    this.fireRainActive = false; // 換節點清火雨狀態
    this.fireRainRemaining = 0;
    this.rewardHold = 0; // 換節點清獎勵演出計時（用戶 #3）
    this.announceNode();
    // 用戶：火雨訊息晚於波次宣告。進 Spawn 節點且帶 attachFireRain → 按住火雨一個波次宣告顯示時長，
    //   讓「第 N 波」先出，火雨（含「天降火雨！」宣告）接在其後。非火雨節點 gate=0（不影響）。
    const entered = this.currentNode();
    const hasFireRain = entered?.nodeType === 'Spawn' && !!(entered as { attachFireRain?: string }).attachFireRain;
    this.fireRainGateSec = hasFireRain ? WAVE_MESSAGE_FX.durationSec : 0;
  }

  /** 過場提示（#9，純視覺）：進節點時依類型顯示螢幕中央提示文字。 */
  private announceNode(): void {
    const node = this.currentNode();
    if (!node) return;
    // 守護波 Event 節點（eventPresetName 非火雨 preset＝守護 preset）：不發節點宣告 waveMessage——
    //   守護波有自己的開場序列（GuardEvent timedEventText「限時事件」→嚴格接續「協力合作，守護雕像」），
    //   再發節點宣告會與限時事件同時顯示重疊（用戶回報）。純火雨 Event / Spawn 照發。
    if (node.nodeType === 'Event') {
      const en = (node as { eventPresetName?: string }).eventPresetName;
      if (en && !isResolvedFireRainPreset(en)) return; // 守護波 → 跳過節點宣告
    }
    if (node.nodeType === 'Spawn') this.spawnWaveNumber += 1; // 累計波序（跨關）
    const text = waveMessageFor(node, this.spawnWaveNumber);
    this.ctx.effects?.waveMessage(text);
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

    const alive = this.ctx.getEnemies().length; // 六輪#5：場上實際敵人數(含前一波接續帶進的殘怪)，維持場面/清空 gate 都用真實佔用
    const pending = this.pendingSpawns; // 預警中（即將生成）
    const nextIsSpawn = this.nextNodeIsSpawn(); // Spawn→Spawn：維持滿場（不套 quota 上限）；否則 drain-to-clear

    // 補怪遲滯 latch（用戶：補怪門檻補到 maxAlive，非只補到門檻）：
    //   佔用跌破 spawnThreshold → 開始補（latch on）；補到 maxAlive → 停（latch off）。之間持續補（不在門檻抖動）。
    const occupancy = alive + pending;
    if (occupancy < spawnThreshold) this.spawnRefilling = true;
    else if (occupancy >= maxAlive) this.spawnRefilling = false;

    // 用戶 #6 (2) gate 清空 + 六輪#5 維持場面：下一節點也是 Spawn → 殺滿 quota 即前進(殘怪接續帶進下一波、不空一下)；
    //   下一節點非 Spawn(Reward/Event) → 維持「殺滿且場上清空才進」(不把戰鬥拖進獎勵/守護)。
    if (shouldAdvanceSpawn(this.kills, killQuota, alive, pending, nextIsSpawn)) {
      this.advanceNode();
      return;
    }

    if (this.spawnCooldown > 0) {
      this.spawnCooldown -= dt;
    }

    // 用戶 #6 (1) 不超生：生產總數（kills+alive+pending）< quota 且維持場面條件成立才 drip。
    //   ★Spawn→Spawn（nextIsSpawn）：略過 quota 上限，持續補生維持 maxAlive → 刷怪波間怪數不掉、無空窗。
    //   ★補怪目標=maxAlive（refilling latch）：跌破門檻後一路補到滿，非只補到門檻（對齊 Unity/用戶）。
    if (
      this.spawnCooldown <= 0 &&
      shouldSpawnMore(this.kills, alive, pending, killQuota, maxAlive, spawnThreshold, nextIsSpawn, this.spawnRefilling)
    ) {
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
    // 一般波 Unity 登場：生成點先冒預警圈淡入 spawnWarningDuration → 怪才原地出現（非場邊走進）。
    // 預警期間計入 pendingSpawns（維持 maxAlive 帳），淡入完才真正 spawn + 移入 tracked。
    this.pendingSpawns += 1;
    const spawnGen = this.spawnGeneration; // 捕捉當下世代；skip/換節點 enterNode 遞增後此排程作廢
    let handleRef: { cancel: () => void } | null = null;
    const doSpawn = (): void => {
      // 完成 → 從 active 召喚陣 handle 陣列移除（避免膨脹）。
      if (handleRef) { this.activeSpawnWarnings = this.activeSpawnWarnings.filter((h) => h !== handleRef); }
      // N skip/換節點作廢：世代已變 → 放棄生怪（不把「正在出生的怪」帶進下一節點）。pendingSpawns 已在 enterNode 清 0。
      if (spawnGen !== this.spawnGeneration) return;
      this.pendingSpawns = Math.max(0, this.pendingSpawns - 1);
      const enemy = this.ctx.spawner.spawn(type, x, y);
      this.tracked.push(enemy);
    };
    if (this.ctx.effects && typeof this.ctx.effects.spawnWarning === 'function') {
      // 召喚陣視覺 handle 追蹤：skip/換節點 cancel（清視覺）；doSpawn 完成自移除。
      handleRef = this.ctx.effects.spawnWarning(x, y, SPAWN_WARNING_DURATION_SEC, doSpawn) ?? null;
      if (handleRef) this.activeSpawnWarnings.push(handleRef);
    } else {
      doSpawn(); // 無預警 API（後備）→ 直接生成
    }
  }

  /** 清除所有進行中的召喚陣視覺（skip/換節點）：cancel 立即停 tween/destroy + 清陣列（不生怪）。 */
  private clearActiveSpawnWarnings(): void {
    for (const h of this.activeSpawnWarnings) h.cancel();
    this.activeSpawnWarnings = [];
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

  /** 選生怪位置（七輪 spawn 位置 bug）：改用 ENEMY_PLAY_BOUNDS(怪可移動區, inset 體型)取代 worldBounds(整畫面)
   *  → 生在界內(不出遊戲區/不進面板)；離玩家 minDist、回第一個夠遠的(非挑最遠→不會離玩家太遠)。 */
  private pickSpawnPosition(): { x: number; y: number } {
    // ENEMY_PLAY_BOUNDS inset 敵人體型 → 生怪點讓整個 body 都在可移動區內。
    const bounds = insetBounds(ENEMY_PLAY_BOUNDS, ENEMY_BODY_RADIUS_PX);
    const b = { minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY };
    const playerPos = this.ctx.player.getPosition();
    const minDistFromPlayer = 260; // 離玩家(px)：夠遠不生身上、又不會太遠跑很久(用戶：別太遠)
    return pickSpawnPoint(b, playerPos, minDistFromPlayer, Math.random);
  }
}
