import { loadLevels } from '@/config/levelLoader';
import { SPAWN_WARNING_DURATION_SEC, ENEMY_BODY_RADIUS_PX } from '@/config/enemyConfig';
import { effectiveEnemyPlayBounds, insetBounds } from '@/config/mapConfig';
import {
  type FireRainPreset,
  resolveNodeFireRain,
} from '@/config/fireRainConfig';
import {
  getResolvedFireRainPreset,
  isResolvedFireRainPreset,
  clearResolvedFireRainCache,
} from '@/config/fireRainSchema';
import { getResolvedGuardPreset, clearResolvedGuardCache } from '@/config/guardSchema';
import { getResolvedMinePreset, isResolvedMinePreset, clearResolvedMineCache } from '@/config/mineSchema';
import { getResolvedTowerPreset, isResolvedTowerPreset, clearResolvedTowerCache } from '@/config/towerSchema';
import type { MinePreset } from '@/config/mineConfig';
import type { TowerPreset } from '@/config/towerConfig';
import { resolveTowerMessages } from '@/config/towerConfig';
import { shouldSpawnMore, shouldAdvanceSpawn, pickSpawnPoint } from '@/systems/waveMath';
import type {
  EnemyType,
  EventNodeData,
  LevelData,
  LevelNodeData,
  SpawnEntry,
  SpawnGroup,
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
 * timedEventText（EffectSystem 事件大字）滑進+滑出總額外秒數：滑進 400ms + 滑出 350ms = 0.75s。
 * 塔波 towerGate 用「eventTextDurationSec + 此值」＝等大字全程（滑進+顯滿+滑出）結束才觸發第二段，避免重疊（Bug1）。
 * 對齊 EffectSystem.timedEventText 的 duration:400 + delayedCall(400+dur) + duration:350。
 */
const TIMED_EVENT_TEXT_SLIDE_SEC = 0.75;

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
/**
 * 單一 group 的執行期狀態（用戶：group 分層 per-group 狀態機）。
 * 每 group 各自 cooldown/refilling latch/追蹤自己生出的怪 → 獨立算佔用、獨立 drip 維持場上數。
 * kills 仍全 node 共用（killQuota 全場過關），tallyKills 掃所有 group 的 tracked。
 */
interface SpawnGroupState {
  cfg: SpawnGroup;
  cooldown: number;
  pending: number; // 該 group 預警中（即將生成）數
  refilling: boolean; // 補怪遲滯 latch（同扁平路徑語意）
  tracked: Enemy[]; // 該 group 生出、仍存活追蹤中的怪（算 group 佔用）
}

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
  /** group 分層執行期狀態（用戶：多 group 並行）；空=走扁平單流。enterNode 依 node.groups 重建。 */
  private spawnGroupStates: SpawnGroupState[] = [];
  /** 本系統生出、目前仍追蹤中的敵人（用來偵測擊殺）。 */
  private tracked: Enemy[] = [];
  /** 預警中（登場預警圈淡入中、敵人尚未生成）的數量：計入 alive，避免預警期間超生。 */
  private pendingSpawns = 0;

  /** 一幕通關回呼（本關 nodes 全跑完時觸發，供 JP 給燈）。★純視覺給燈，不推進（推進走 waitingForPortal gate）。 */
  onStageClear: (() => void) | null = null;

  /**
   * ★關卡推進 step1（無 camera）：本關全波次跑完 → emit 此（供征騎開左通道 UI）+ 進 waitingForPortal gate 停生怪。
   * 玩家走進通道 → 征騎呼 notifyPortalEntered() → 重置波次組當「下一關」。與 onStageClear 語意分開：
   * onStageClear＝給燈（純視覺）、onLevelCleared＝開通道 gate 流程（兩者同點都發、邏輯不重複）。
   */
  onLevelCleared: (() => void) | null = null;
  /** ★等待玩家走進通道（本關跑完後停住）：true 期間 update 不生怪、不推進，直到 notifyPortalEntered()。 */
  private waitingForPortal = false;
  /** ★陣型（怪物 AI 第 2 塊）：本節點是否已生過陣型（有 node.formation 時進節點呼一次 spawnFormation，避免重生）。 */
  private formationSpawned = false;

  /** 獎勵節點回呼（用戶 #3：進 Reward 節點時觸發一次，供 GameScene 播報獎演出+點 JP 燈）。 */
  onReward: (() => void) | null = null;
  /** 獎勵演出保持計時（進 Reward 節點時設，倒數完才前進，讓報獎演出播完）。 */
  private rewardHold = 0;

  /**
   * 魔尖塔觸發回呼（用戶：魔尖塔=單獨波次，比照守護波）：走到魔尖塔事件時觸發一次，帶 tower preset。
   * 遊戲端（征騎）生成 towerCount 座尖塔（各 towerHp + ringSkill 環狀技）；勝敗判定＝本系統（走既有 advance）。
   * ★地雷=附加類（讀取式，比照火雨）：game-side MineSystem 每幀讀 getActiveMinePreset()，無 onMineTrap 回呼。
   */
  onTowerWave: ((preset: TowerPreset) => void) | null = null;
  /** 事件節點（魔尖塔）保持計時 + 是否已觸發（進節點時設，倒數完前進）。 */
  private eventHold = 0;
  private eventTriggered = false;
  /**
   * 魔尖塔（TowerWave）階段 B：本波已摧毀尖塔數。征騎 TowerSystem 每摧毀一座呼叫 notifyTowerDestroyed()，
   * 本系統累計；達 node.towerCount → 過關（提前 advance）。進 node 時歸 0。
   */
  private towersDestroyed = 0;
  /**
   * 魔尖塔結果回呼（階段 B，供遊戲端/征騎收尾清尖塔、播勝敗演出）：true=過關(打完)、false=失敗(限時到沒打完)。
   * ★失敗不 GameOver：兩者都 advance 下一節點（沿用守護波規格 decision）。
   */
  onTowerWaveResult: ((won: boolean) => void) | null = null;
  /**
   * #2 架構對稱：塔波「戰鬥開始」旗標（預設 false）。塔波雜兵 drip gate 綁此（非 eventTriggered），
   * 比照守護波 GuardEvent.isCombatPhase()——聚焦壓黑（gather→focus）期間 drip 不跑，endFocus（聚焦結束）後才 drip。
   * 由征騎 TowerIntroSequence.endFocus() 呼 notifyTowerCombatStart() 設 true；進 node/觸發時歸 false。
   */
  private towerCombatStarted = false;

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

  /**
   * 用戶：地雷訊息/撒雷要晚於「第 N 波」波次宣告（比照火雨）。進節點時若帶 attachMineTrap，設此延遲秒數，
   * 期間 getActiveMinePreset() 回 null（game-side MineSystem 因此延後撒地雷+「小心地雷！」宣告），
   * 讓波次宣告先顯示、地雷訊息接在其後。倒數在 update() 遞減；<=0 才開放撒地雷。
   */
  private mineGateSec = 0;

  /**
   * B4：塔波登場流程比照火雨/地雷——「塔波提示文字(waveMessage) → 顯完 → 壓黑+生塔+塔發亮」不重疊。
   * 進 tower Event 節點時設此延遲秒數（一個 waveMessage 時長）；期間 updateTowerWaveNode 按住不發 onTowerWave
   * （故 gate 內 eventTriggered 仍 false → isTowerWaveActive() 回 false、進度條先不顯塔條）。
   * gate 跑完（<=0）才觸發 onTowerWave（征騎收到即跑壓黑+生塔+發亮）。倒數在 update() 遞減。
   */
  private towerGateSec = 0;

  /** debug/UI：目前守護波（若有）。 */
  getGuardEvent(): GuardEvent | null {
    return this.guardEvent;
  }

  /** Debug（N 熱鍵，搬自 Unity LevelProgressManager:103）：請求強制完成當前節點、跳下一個。下一幀 update() 處理。 */
  requestSkipCurrentNode(): void {
    this.skipRequested = true;
  }

  /**
   * 魔尖塔（TowerWave 階段 B）：征騎 TowerSystem 每摧毀一座尖塔呼叫此，本系統累計。
   * 達當前 TowerWave 節點 towerCount → updateTowerWaveNode 判過關（提前 advance）。
   * 只在 TowerWave 節點進行中有意義（非 TowerWave 節點呼叫無害，換節點會歸 0）。
   */
  notifyTowerDestroyed(): void {
    this.towersDestroyed += 1;
  }

  /**
   * #2 架構對稱：征騎 TowerIntroSequence.endFocus()（聚焦壓黑結束、開打）呼此，本系統設 towerCombatStarted=true
   * → 塔波雜兵 drip 才開始（比照守護波 endFocus 進 combat phase）。聚焦期間不呼＝drip 不跑。
   * 非塔波呼叫無害（進 node/觸發時歸 false，且 drip 僅在 tower 節點跑）。
   */
  notifyTowerCombatStart(): void {
    this.towerCombatStarted = true;
  }

  /**
   * 魔尖塔波狀態公開 accessor（B5/B6 進度條+倒數，比照 getGuardEvent 那套；征騎 ProgressBarSystem 讀）。
   * 「塔波進行中」＝目前節點是 tower Event 且已觸發（eventTriggered）、尚未 advance。
   * 非塔波時：isTowerWaveActive()→false、其餘回 0（安全預設，ProgressBar 可據此切換金條/塔條）。
   */
  private currentTowerPreset(): TowerPreset | null {
    const node = this.currentNode();
    if (node?.nodeType !== 'Event') return null;
    const en = (node as EventNodeData).eventPresetName;
    return isResolvedTowerPreset(en) ? getResolvedTowerPreset(en) : null;
  }

  /** 目前是否為魔尖塔波進行中（tower Event 節點 + 已觸發生塔、未 advance）。 */
  isTowerWaveActive(): boolean {
    return this.currentTowerPreset() !== null && this.eventTriggered;
  }

  /** 已消滅尖塔數（進度條分子；非塔波回 0）。 */
  getTowerWaveDestroyed(): number {
    return this.isTowerWaveActive() ? this.towersDestroyed : 0;
  }

  /** 當前塔波總塔數（進度條分母；非塔波回 0）。 */
  getTowerWaveTotal(): number {
    const t = this.currentTowerPreset();
    return t && this.eventTriggered ? t.towerCount : 0;
  }

  /** 塔波剩餘倒數秒（B6；非塔波回 0）。 */
  getTowerWaveRemaining(): number {
    return this.isTowerWaveActive() ? Math.max(0, this.eventHold) : 0;
  }

  /** 塔波限時秒數（B6 分母；非塔波回 0）。 */
  getTowerWaveTimeLimit(): number {
    const t = this.currentTowerPreset();
    return t && this.eventTriggered ? t.timeLimitSec : 0;
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
    // A1：魔尖塔波 Event 節點附加火雨（用戶：魔尖塔波節點可追加火雨）。
    //   editor 寫 node.attachFireRain（'none' 或火雨 preset 名）；此處讀取端認 Tower 節點。
    //   ★時序：只在塔波已觸發（eventTriggered，towerGate 跑完塔已生）後才降——比照 Spawn 的 gate 觀念、
    //   避免塔波提示文字/壓黑 intro 期間火雨太早下（與 mine/fire gate 一致）。'none'→不降。
    if (node?.nodeType === 'Event' && isResolvedTowerPreset((node as EventNodeData).eventPresetName)) {
      if (!this.eventTriggered) return null; // towerGate 內 / 尚未生塔 → 火雨先按住
      const raw = (node as { attachFireRain?: string }).attachFireRain;
      if (raw && raw !== 'none') return getResolvedFireRainPreset(raw);
      return null;
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

  /**
   * 目前該不該撒地雷 + 用哪組參數（用戶：地雷=附加類，讀取式，比照 getActiveFireRainPreset）。
   * game-side MineSystem 每幀讀此：有 preset → 全場自動撒地雷（初始 count 顆、之後維持 maintainCount）、無則不撒。
   * - 任何節點（Spawn / Event 守護·魔尖塔）帶 attachMineTrap（地雷 preset 名）→ 該波次/事件進行時撒該地雷。
   * - ★①撒雷 gate（比照火雨 combat-phase gate，非只等 1.6s）：
   *   · Spawn 節點：等 mineGateSec（波次宣告時長；Spawn 無壓黑登場）。
   *   · 守護波節點：等 guardEvent.isCombatPhase()（解暗後才撒，同 FireRainSystem 守護波邏輯）。
   *   · 塔波節點：等 towerCombatStarted（endFocus 聚焦結束後才撒）。
   *   → 事件節點登場序列（大字/走位/聚焦壓黑）期間不撒，避免「第一段訊息就撒」。
   * - 否則 → null（不撒地雷）。
   */
  getActiveMinePreset(): MinePreset | null {
    const node = this.currentNode();
    if (!node) return null;
    const attach = (node as { attachMineTrap?: string }).attachMineTrap;
    if (!attach || !isResolvedMinePreset(attach)) return null;
    // ①combat-phase gate（事件節點登場壓黑期間不撒，比照火雨）：
    if (node.nodeType === 'Event') {
      const en = (node as EventNodeData).eventPresetName;
      if (isResolvedTowerPreset(en)) {
        if (!this.towerCombatStarted) return null; // 塔波：endFocus（開打）後才撒
      } else if (this.guardEvent && !this.guardEvent.isCombatPhase()) {
        return null; // 守護波：解暗進 combat 後才撒（同 FireRainSystem）
      }
    } else {
      // Spawn（或其他非壓黑登場）：維持 mineGateSec（波次宣告時長）。
      if (this.mineGateSec > 0) return null;
    }
    return getResolvedMinePreset(attach);
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
      const presetName = (node as EventNodeData).eventPresetName;
      // 魔尖塔波：進度＝已摧毀尖塔數 / 目標塔數（對齊用戶「打掉幾/N 塔」）。未觸發或無塔→0。
      if (isResolvedTowerPreset(presetName)) {
        const tc = getResolvedTowerPreset(presetName).towerCount;
        if (!this.eventTriggered || tc <= 0) return 0;
        return Math.min(1, Math.max(0, this.towersDestroyed / tc));
      }
      // 守護波/火雨波：已過時間 / 限時。
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
    // ★關卡推進 gate：本關跑完後停住等玩家走進通道（notifyPortalEntered）→ 期間不生怪、不推進。
    if (this.waitingForPortal) return;
    const node = this.currentNode();
    if (!node) return; // 全部節點跑完

    // 用戶：火雨訊息晚於波次宣告 → 進節點後 gate 倒數，期間 getActiveFireRainPreset 對 Spawn 回 null。
    if (this.fireRainGateSec > 0) this.fireRainGateSec = Math.max(0, this.fireRainGateSec - dt);
    // 用戶：地雷訊息/撒雷晚於波次宣告（比照火雨）→ gate 倒數，期間 getActiveMinePreset 回 null。
    if (this.mineGateSec > 0) this.mineGateSec = Math.max(0, this.mineGateSec - dt);
    // B4：塔波登場 gate 倒數，期間 updateTowerWaveNode 按住不發 onTowerWave（讓 waveMessage 先顯完）。
    if (this.towerGateSec > 0) this.towerGateSec = Math.max(0, this.towerGateSec - dt);

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

  /**
   * 魔尖塔事件（守護波勝敗判定；用戶：魔尖塔=單獨波次，比照守護波，Event eventPresetName=tower preset）。
   * ★勝敗雙結束條件（decision f45c7d08，變身-leader 把關）：
   *   - 限時內打完全部尖塔（towersDestroyed >= towerCount）＝過關 → 提前 advance。
   *   - 限時到還沒打完＝失敗 → ★不 GameOver、一樣 advance 下一節點。
   *   兩者都走既有 advanceNode()（不新增波次生命週期、不動 killQuota/clamp/人數縮放不變量）。
   * 尖塔擊破數由征騎 TowerSystem 呼 notifyTowerDestroyed() 累計；onTowerWaveResult(won) 供收尾清尖塔/播演出。
   */
  private updateTowerWaveNode(node: EventNodeData, dt: number): void {
    const t: TowerPreset = getResolvedTowerPreset(node.eventPresetName);
    // B4：gate 期間（waveMessage 顯示中）先不生塔——按住 onTowerWave，讓塔波提示文字先顯完。
    //   gate 內 eventTriggered 維持 false → isTowerWaveActive() 回 false（進度條先不顯塔條）。
    if (this.towerGateSec > 0) return;
    if (!this.eventTriggered) {
      this.eventTriggered = true;
      this.eventHold = t.timeLimitSec; // 限時倒數
      this.towersDestroyed = 0; // 本波擊破數歸零
      this.towerCombatStarted = false; // #2：觸發生塔＝進入聚焦壓黑，尚未開打→drip 先不跑，等征騎 endFocus 通知
      this.onTowerWave?.(t); // 觸發入口（征騎接：waveMessage 已顯完 → 壓黑+生成 towerCount 座尖塔＋發亮＋ringSkill 環狀技）
    }
    this.eventHold -= dt;

    // #2 架構對稱：塔波附加雜兵 drip gate 綁 towerCombatStarted（非 eventTriggered），比照守護波 isCombatPhase()。
    //   聚焦壓黑（gather→focus）期間 towerCombatStarted=false → 不 drip；征騎 endFocus→notifyTowerCombatStart 後才 drip。
    //   ★雜兵是「附加壓力」純 drip、不計過關（過關只看 towersDestroyed）；換節點 enterNode 清雜兵/pending+旗標。
    if (this.towerCombatStarted && node.spawns && node.spawns.length > 0 && (node.maxAlive ?? 0) > 0) {
      const scale = this.playerCountScale();
      const maxAlive = Math.max(1, Math.round((node.maxAlive ?? 0) * scale));
      const spawnThreshold = Math.max(1, Math.round((node.spawnThreshold ?? node.maxAlive ?? 1) * scale));
      const occupancy = this.ctx.getEnemies().length + this.pendingSpawns;
      if (occupancy < spawnThreshold) this.spawnRefilling = true;
      else if (occupancy >= maxAlive) this.spawnRefilling = false;
      if (this.spawnCooldown > 0) this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0 && this.spawnRefilling && occupancy < maxAlive) {
        this.spawnOne(node.spawns);
        this.spawnCooldown = node.spawnInterval ?? 1;
      }
    }

    // 過關：限時內打完全部尖塔 → 提前結束。
    if (this.towersDestroyed >= t.towerCount) {
      this.onTowerWaveResult?.(true);
      this.advanceNode();
      return;
    }
    // 失敗：限時到還沒打完 → 不 GameOver，一樣前進下一節點。
    if (this.eventHold <= 0) {
      this.eventHold = 0;
      // #3 照守護波 finish 平移：清場上未打掉的塔（塔=isTower 的 Enemy 一併清），避免超時失敗塔留在場上。
      //   同守護波 GuardEvent.finish()/Debug skip 清怪位置、完全對稱。
      this.ctx.spawner.clearAllEnemies();
      this.onTowerWaveResult?.(false);
      this.advanceNode();
    }
  }

  /**
   * Event 節點分派（用戶：單一架構，純 eventPresetName 分派）：
   * - 火雨 preset（isResolvedFireRainPreset）→ 純火雨波（計時跑完前進）。
   * - 魔尖塔 preset（isResolvedTowerPreset）→ 魔尖塔波（勝敗判定，updateTowerWaveNode）。
   * - 否則 → 守護波（建 GuardEvent，吃 guard preset + per-node drip 覆蓋）。
   * 地雷=附加類（attachMineTrap），非 Event 節點型別；game-side 讀 getActiveMinePreset 撒（不在此分派）。
   */
  private updateEventNode(node: EventNodeData, dt: number): void {
    const presetName = node.eventPresetName ?? '';
    // 純火雨 Event 節點（eventPresetName 是火雨 preset）：計時跑完前進，不建守護/雕像。
    if (isResolvedFireRainPreset(presetName)) {
      const preset = getResolvedFireRainPreset(presetName);
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
    // 魔尖塔 preset → 魔尖塔波（勝敗判定）。
    if (isResolvedTowerPreset(presetName)) {
      this.updateTowerWaveNode(node, dt);
      return;
    }
    // 守護波（含可選 attachFireRain）。
    if (!this.guardEvent) {
      this.guardEvent = new GuardEvent(this.ctx, presetName, {
        maxAlive: node.maxAlive,
        spawnThreshold: node.spawnThreshold,
        spawnInterval: node.spawnInterval,
        spawns: node.spawns,
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
    // ★編輯器調值→遊戲即時生效通則（用戶：真空帶調了沒變的真因＝resolved cache 一個 page load 只讀 localStorage 一次就 cache 死）。
    //   進節點前把本系統會讀的 preset cache 清一次，重讀 localStorage override→用戶在編輯器套用後下次進波即讀到新值（免 F5）。
    //   tower cache 另在下方 isTowerNode 分支清（同精神）；guard/firerain/mine 通用在此清。
    clearResolvedGuardCache();
    clearResolvedFireRainCache();
    clearResolvedMineCache();
    clearResolvedTowerCache();
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
    this.eventHold = 0; // 換節點清事件（MineTrap/TowerWave）計時
    this.eventTriggered = false;
    this.towersDestroyed = 0; // 換節點清魔尖塔擊破數（階段 B）
    this.towerCombatStarted = false; // #2：換節點清塔波戰鬥旗標（drip gate；下個塔波等 endFocus 才 true）
    this.formationSpawned = false; // ★換節點清陣型旗標（下個 formation 節點進入時再呼一次 spawnFormation）
    // group 分層：進 Spawn 節點時依 node.groups 重建 per-group 狀態；無 groups → 空陣列（走扁平單流）。
    const enteredNode = this.currentLevel()?.nodes[index];
    const groups = enteredNode?.nodeType === 'Spawn' ? (enteredNode as SpawnNodeData).groups : undefined;
    this.spawnGroupStates = (groups && groups.length > 0)
      ? groups.map((cfg) => ({ cfg, cooldown: 0, pending: 0, refilling: true, tracked: [] }))
      : [];
    this.announceNode();
    // 用戶：火雨訊息晚於波次宣告。進 Spawn 節點且帶 attachFireRain → 按住火雨一個波次宣告顯示時長，
    //   讓「第 N 波」先出，火雨（含「天降火雨！」宣告）接在其後。非火雨節點 gate=0（不影響）。
    const entered = this.currentNode();
    const hasFireRain = entered?.nodeType === 'Spawn' && !!(entered as { attachFireRain?: string }).attachFireRain;
    this.fireRainGateSec = hasFireRain ? WAVE_MESSAGE_FX.durationSec : 0;
    // 用戶：地雷同樣晚於波次宣告（比照火雨）。任何節點（Spawn/Event）帶 attachMineTrap → 按住一個波次宣告時長，
    //   讓「第 N 波」先出、地雷（含「小心地雷！」宣告 game-side 發）接其後。無地雷 gate=0（不影響）。
    const hasMine = !!(entered as { attachMineTrap?: string })?.attachMineTrap;
    this.mineGateSec = hasMine ? WAVE_MESSAGE_FX.durationSec : 0;
    // B4：進 tower Event 節點 → 按住一個 waveMessage 時長才生塔（塔波提示文字顯完 → 壓黑+生塔+發亮 by 征騎）。
    //   gate 內 eventTriggered 維持 false → isTowerWaveActive() 回 false（征騎進度條先不顯塔條）。非塔波 gate=0。
    const isTowerNode = entered?.nodeType === 'Event' && isResolvedTowerPreset((entered as EventNodeData).eventPresetName);
    if (isTowerNode) {
      // 塔波登場第一段大字（照守護波：enterNode 只發 introEventText 大字 timedEventText）。
      //   ★第二段提示（towerMessageText）由征騎 TowerIntroSequence.beginFocus 發（跟守護波「聚焦時才滑進提示」一致）。
      //   ★Bug1 gate 時序（對齊守護波 reveal gate「等 introText 全程結束」精神）：timedEventText 實際週期＝
      //   滑進 0.4s + 顯滿 eventTextDurationSec + 滑出 0.35s（EffectSystem:699）。towerGate 必須等這整段結束才觸發
      //   onTowerWave→beginFocus 發第二段，否則第一段大字還在滑出就出第二段＝重疊/未關就出下段。
      //   introEventText='' → timedEventText 不發（無大字）→ gate 只需 0（無需等文字）。
      const tmsg = resolveTowerMessages(getResolvedTowerPreset((entered as EventNodeData).eventPresetName));
      if (tmsg.introEventText !== '') {
        this.ctx.effects?.timedEventText?.(tmsg.eventTextDurationSec, tmsg.introEventText);
        this.towerGateSec = tmsg.eventTextDurationSec + TIMED_EVENT_TEXT_SLIDE_SEC; // 等大字全程結束（滑進+顯滿+滑出）
      } else {
        this.towerGateSec = 0; // 無第一段大字 → 不需等
      }
    } else {
      this.towerGateSec = 0;
    }
  }

  /** 過場提示（#9，純視覺）：進節點時依類型顯示螢幕中央提示文字。 */
  private announceNode(): void {
    const node = this.currentNode();
    if (!node) return;
    // 守護波 Event 節點：不發節點宣告 waveMessage——守護波有自己的開場序列
    //   （GuardEvent timedEventText「限時事件」→嚴格接續「協力合作，守護雕像」），再發節點宣告會重疊（用戶回報）。
    // ★塔波：也不在此發 waveMessage——塔波登場改用守護波兩段訊息（enterNode 的 timedEventText+guardText），
    //   若這裡再發單段 waveMessage 會與兩段訊息重疊。火雨/一般事件才發 waveMessageFor。
    if (node.nodeType === 'Event') {
      const en = (node as { eventPresetName?: string }).eventPresetName;
      const isFire = !!en && isResolvedFireRainPreset(en);
      if (!isFire) return; // 守護波 + 塔波 → 跳過單段節點宣告（各有自己的開場訊息）；只有純火雨波發
    }
    if (node.nodeType === 'Spawn') this.spawnWaveNumber += 1; // 累計波序（跨關）
    const text = waveMessageFor(node, this.spawnWaveNumber);
    this.ctx.effects?.waveMessage(text);
  }

  /** 前進到下一節點；本關 nodes 全跑完 → 開通道 gate（等玩家走進 notifyPortalEntered 才進下一輪，step1）。 */
  private advanceNode(): void {
    const level = this.currentLevel();
    if (!level) return;
    if (this.nodeIndex + 1 < level.nodes.length) {
      this.enterNode(this.nodeIndex + 1);
    } else {
      // ★本關 nodes 全跑完＝一關通關：onStageClear 給燈（純視覺）+ onLevelCleared 開通道 gate。
      //   ★step1：不再自動 levelIndex+1，改停住 waitingForPortal，等玩家走進通道呼 notifyPortalEntered()。
      this.nodeIndex = level.nodes.length; // 停在末端（currentNode()=undefined，不再生怪）
      this.waitingForPortal = true;
      this.onStageClear?.(); // 給燈（視覺慶祝，照舊）
      this.onLevelCleared?.(); // 開通道 gate（征騎收→畫左通道）
    }
  }

  /**
   * ★關卡推進 step1（無 camera）：玩家走進左通道時征騎呼此 → 重置波次組當「下一關」重跑一輪。
   * 現只 1 關 Level0，先 loop（levelIndex 回 0、enterNode(0)、清 gate）；之後有多關序列資料再進下一組。
   * 防呆：非 waitingForPortal 態呼叫忽略（避免重複觸發/誤呼）。比照 notifyTowerCombatStart public API 範式。
   */
  notifyPortalEntered(): void {
    if (!this.waitingForPortal) return; // 非等待態 → 忽略（防呆）
    this.waitingForPortal = false;
    this.ctx.spawner.clearAllEnemies(); // 進下一關前清場上殘怪（乾淨起跑，比照 skip/塔波失敗清場）
    if (this.levels && this.levelIndex + 1 < this.levels.length) {
      this.levelIndex += 1; // 有下一關序列 → 進下一組
    } else {
      this.levelIndex = 0; // 最後一關（現只 1 關）→ loop 重跑同組當下一關
    }
    this.enterNode(0);
  }

  /** ★是否在「本關跑完、等玩家走進通道」態（征騎/進度條可查；true 期間 WaveSystem 停生怪）。 */
  isAwaitingLevelAdvance(): boolean {
    return this.waitingForPortal;
  }

  // ---- Spawn 節點 -----------------------------------------------------------

  private updateSpawnNode(node: SpawnNodeData, dt: number): void {
    this.tallyKills();

    // 波次×人數（多人遷移 S5）：killQuota 依人數縮放。killQuota 為 node 層全場過關（group 分層仍沿用）。
    const scale = this.playerCountScale();
    const killQuota = Math.round(node.killQuota * scale);
    const nextIsSpawn = this.nextNodeIsSpawn(); // Spawn→Spawn：維持滿場（不套 quota 上限）；否則 drain-to-clear

    const alive = this.ctx.getEnemies().length; // 全場實際敵人數（含殘怪；過關/清空 gate 用真實佔用）
    const pending = this.totalPending(); // 全場預警中（扁平 + 所有 group）

    // 用戶 #6 (2) gate 清空 + 六輪#5 維持場面：下一節點也是 Spawn → 殺滿 quota 即前進(殘怪接續)；否則殺滿且清空才進。
    //   ★group 分層仍是 node 層 killQuota 全場過關（全場 alive/pending 一起判）。
    if (shouldAdvanceSpawn(this.kills, killQuota, alive, pending, nextIsSpawn)) {
      this.advanceNode();
      return;
    }

    // ★陣型（怪物 AI 第 2 塊）：有 node.formation → 進節點呼一次征騎 spawnFormation（一次生齊整隊、列隊推進），
    //   之後不跑 drip；killQuota 照掃 getEnemies 判過關（formation 怪也在 getEnemies）。無 formation → 現有散兵 drip。
    //   ★anchor＝可走區中心 + 當前 levelOffsetX（offset-aware，陣型生玩家當前區塊；征騎 spawnFormation 內部不再加 offset）。
    if (node.formation) {
      if (!this.formationSpawned) {
        this.formationSpawned = true;
        const eb = effectiveEnemyPlayBounds(); // 已含 levelOffsetX（比照 pickSpawnPosition）
        const anchor = { x: (eb.minX + eb.maxX) / 2, y: (eb.minY + eb.maxY) / 2 };
        // 征騎 EnemySpawner.spawnFormation(config, anchor)；用型別轉接（EnemySpawner 是征騎 file、他 cp 後有此法）。
        (this.ctx.spawner as unknown as {
          spawnFormation?: (config: unknown, anchor: { x: number; y: number }) => unknown;
        }).spawnFormation?.(node.formation, anchor);
      }
      return; // 有 formation → 不跑 drip（列隊推進，非滴流）
    }

    // group 分層：多 group 各自並行 drip（各自 cooldown/佔用/維持場上數）；killQuota 全場過關（上方已判）。
    if (this.spawnGroupStates.length > 0) {
      // ★修 groups 卡關 bug：groups 原本只看 occupancy<maxConcurrent 無 killQuota 停生 gate，
      //   達 quota 後照樣每殺一隻補一隻→alive 恆>0→shouldAdvanceSpawn 的 alive<=0 永不成立→死鎖。
      //   比照扁平單流 shouldSpawnMore 首行 `!nextIsSpawn && kills+alive+pending>=quota 停生`：
      //   下一節點非 Spawn（該收斂進 Reward/Event）且達 quota → 停 group drip 讓場面清空過關。
      //   nextIsSpawn（下一關也 Spawn）不套此 gate（維持滿場語意不變）。
      const stopDrip = !nextIsSpawn && this.kills + alive + pending >= killQuota;
      this.updateSpawnGroups(dt, stopDrip);
      return;
    }

    // 扁平單流（無 groups，向後相容）：----------------------------------------
    const maxAlive = Math.round(node.maxAlive * scale);
    const spawnThreshold = Math.round(node.spawnThreshold * scale);

    // 補怪遲滯 latch（用戶：補怪門檻補到 maxAlive，非只補到門檻）：跌破 spawnThreshold 開、達 maxAlive 關。
    const occupancy = alive + this.pendingSpawns;
    if (occupancy < spawnThreshold) this.spawnRefilling = true;
    else if (occupancy >= maxAlive) this.spawnRefilling = false;

    if (this.spawnCooldown > 0) this.spawnCooldown -= dt;

    // 不超生 + 維持場面（Spawn→Spawn 略過 quota 上限維持滿場；補到 maxAlive 非停門檻）。
    if (
      this.spawnCooldown <= 0 &&
      shouldSpawnMore(this.kills, alive, this.pendingSpawns, killQuota, maxAlive, spawnThreshold, nextIsSpawn, this.spawnRefilling)
    ) {
      this.spawnOne(node.spawns);
      this.spawnCooldown = node.spawnInterval;
    }
  }

  /**
   * 多 group 並行 drip（用戶：group 分層）。每 group 獨立：算自己佔用（自己 tracked 存活 + pending）、
   * 各自遲滯 latch、各自 cooldown、補到自己的 maxConcurrent（純 drip 維持場上數，無產出上限）。
   * killQuota 全場過關已在 updateSpawnNode 上方判（此處只管刷）。
   * minConcurrent 省略 → 門檻＝maxConcurrent（< max 即補的單純維持）；填了 → 跌破 min 才觸發、補到 max。
   * ★stopDrip：達 quota 且下一節點非 Spawn（該收斂進 Reward/Event）→ 停所有 group 補生，讓場面清空過關（修卡關）。
   */
  private updateSpawnGroups(dt: number, stopDrip: boolean): void {
    const scale = this.playerCountScale();
    const livingSet = new Set<Enemy>(this.ctx.getEnemies());
    for (const gs of this.spawnGroupStates) {
      // 該 group 佔用＝自己 tracked 仍存活數 + 自己 pending（tallyKills 已移除死怪，這裡再用 livingSet 保險）。
      const groupAlive = gs.tracked.reduce((n, e) => (!e.isDead() && livingSet.has(e) ? n + 1 : n), 0);
      const occupancy = groupAlive + gs.pending;
      const maxConcurrent = Math.max(1, Math.round(gs.cfg.maxConcurrent * scale));
      // 門檻：minConcurrent 省略 → 用 maxConcurrent（< max 即補）；填了 → 用 min（跌破 min 觸發）。
      const threshold = gs.cfg.minConcurrent !== undefined
        ? Math.round(gs.cfg.minConcurrent * scale)
        : maxConcurrent;
      if (occupancy < threshold) gs.refilling = true;
      else if (occupancy >= maxConcurrent) gs.refilling = false;

      if (gs.cooldown > 0) gs.cooldown -= dt;

      // 純 drip 維持（無 killQuota 上限、無 count）：達 maxConcurrent 停，否則跌破門檻或補怪中 → 補。
      // ★達 quota 收斂（stopDrip）→ 一律停生，讓殘怪被清光、alive 歸 0 使過關判定成立。
      const canSpawn = !stopDrip && occupancy < maxConcurrent && (occupancy < threshold || gs.refilling);
      if (gs.cooldown <= 0 && canSpawn) {
        this.spawnOne(gs.cfg.spawns, gs);
        gs.cooldown = gs.cfg.spawnInterval;
      }
    }
  }

  /** 全場預警中總數（扁平 pendingSpawns + 所有 group pending）。 */
  private totalPending(): number {
    let p = this.pendingSpawns;
    for (const gs of this.spawnGroupStates) p += gs.pending;
    return p;
  }

  /** 依人數的難度係數：1人×1 / 2人×1.5 / 3人×2 / 4人×2.5（playerCount=players[].length）。 */
  private playerCountScale(): number {
    const n = Math.max(1, this.ctx.players.length);
    return 1 + (n - 1) * 0.5;
  }

  /**
   * 統計擊殺：追蹤中的敵人凡已死亡或已從場上快照消失者計為一次擊殺並移出追蹤。
   * 掃扁平 tracked + 所有 group 的 tracked（kills 全 node 共用＝killQuota 全場過關）。
   */
  private tallyKills(): void {
    const livingSet = new Set<Enemy>(this.ctx.getEnemies());
    const sweep = (list: Enemy[]): Enemy[] => {
      const still: Enemy[] = [];
      for (const e of list) {
        if (e.isDead() || !livingSet.has(e)) this.kills += 1;
        else still.push(e);
      }
      return still;
    };
    this.tracked = sweep(this.tracked);
    for (const gs of this.spawnGroupStates) gs.tracked = sweep(gs.tracked);
  }

  /** 依權重挑一種敵人，在合理位置生成並納入追蹤。group 分層時傳 groupState → 記進該 group（算 group 佔用）。 */
  private spawnOne(spawns: SpawnEntry[], groupState?: SpawnGroupState): void {
    const type = this.pickWeighted(spawns);
    if (!type) return;
    const { x, y } = this.pickSpawnPosition();
    // 一般波 Unity 登場：生成點先冒預警圈淡入 spawnWarningDuration → 怪才原地出現（非場邊走進）。
    // 預警期間計入 pending（維持上限帳），淡入完才真正 spawn + 移入 tracked。group 分層記進該 group。
    if (groupState) groupState.pending += 1;
    else this.pendingSpawns += 1;
    const spawnGen = this.spawnGeneration; // 捕捉當下世代；skip/換節點 enterNode 遞增後此排程作廢
    let handleRef: { cancel: () => void } | null = null;
    const doSpawn = (): void => {
      // 完成 → 從 active 召喚陣 handle 陣列移除（避免膨脹）。
      if (handleRef) { this.activeSpawnWarnings = this.activeSpawnWarnings.filter((h) => h !== handleRef); }
      // N skip/換節點作廢：世代已變 → 放棄生怪（不把「正在出生的怪」帶進下一節點）。pending 已在 enterNode 清 0。
      if (spawnGen !== this.spawnGeneration) return;
      if (groupState) {
        groupState.pending = Math.max(0, groupState.pending - 1);
        const enemy = this.ctx.spawner.spawn(type, x, y);
        groupState.tracked.push(enemy);
      } else {
        this.pendingSpawns = Math.max(0, this.pendingSpawns - 1);
        const enemy = this.ctx.spawner.spawn(type, x, y);
        this.tracked.push(enemy);
      }
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

  /** 選生怪位置：用 effectiveEnemyPlayBounds()（＝ENEMY_PLAY_BOUNDS 已 +當前 levelOffsetX，怪可移動區, inset 體型）
   *  → ★關卡推進 block-offset：怪生在玩家當前所在的 offset 區塊（非原點），連過多關持續生對區塊。
   *  離玩家 minDist、回第一個夠遠的(非挑最遠→不會離玩家太遠)。 */
  private pickSpawnPosition(): { x: number; y: number } {
    // effectiveEnemyPlayBounds()＝ENEMY_PLAY_BOUNDS 平移當前 levelOffsetX（征騎 seam）；inset 敵人體型 → 整個 body 在界內。
    const bounds = insetBounds(effectiveEnemyPlayBounds(), ENEMY_BODY_RADIUS_PX);
    const b = { minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY };
    const playerPos = this.ctx.player.getPosition();
    const minDistFromPlayer = 260; // 離玩家(px)：夠遠不生身上、又不會太遠跑很久(用戶：別太遠)
    return pickSpawnPoint(b, playerPos, minDistFromPlayer, Math.random);
  }
}
