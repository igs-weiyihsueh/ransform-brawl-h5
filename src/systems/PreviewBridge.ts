import { assertValidLevels } from '@/config/levelLoader';
import { type LevelData, LEVELS_SCHEMA_VERSION } from '@/config/levelSchema';
import {
  PREVIEW_MSG,
  PREVIEW_QUERY_FLAG,
  type PreviewMessage,
} from '@/config/previewProtocol';

/**
 * PreviewBridge — 遊戲端的「編輯器試玩」交握橋接。
 *
 * 只在 ?preview=1 時啟用（見 isPreviewMode）。一般玩家路徑完全不會建立這個橋，
 * 也不會 postMessage / 掛 listener。
 *
 * 流程：
 *  1. start()：向 parent 送 preview-ready（帶本端 LEVELS_SCHEMA_VERSION），並掛 message listener。
 *  2. 收到 preview-levels：**同源檢查** + 在遊戲端**再跑一次 assertValidLevels**（iframe 邊界＝不信任輸入，雙重驗證）。
 *     - 過 → 呼叫 onLevels(levels) 由遊戲端注入 WaveSystem 跑。
 *     - 不過 → 回送 preview-error（逐條原因），不帶壞資料跑。
 *  3. 所有對 parent 的 postMessage 都指定 targetOrigin = 自身 origin（同源）。
 */

/** 是否為試玩模式（URL 帶 ?preview=1）。一般玩家不會帶此 flag。 */
export function isPreviewMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get(PREVIEW_QUERY_FLAG) === '1';
}

export class PreviewBridge {
  private readonly origin: string;
  private readonly onLevels: (levels: LevelData[]) => void;
  private readonly listener: (e: MessageEvent) => void;

  /**
   * @param onLevels 收到並「雙重驗證通過」的關卡時呼叫（遊戲端據此注入 WaveSystem）。
   */
  constructor(onLevels: (levels: LevelData[]) => void) {
    this.origin = window.location.origin;
    this.onLevels = onLevels;
    this.listener = (e: MessageEvent) => this.onMessage(e);
  }

  /** 啟動交握：掛 listener + 送 preview-ready 給 parent。 */
  start(): void {
    window.addEventListener('message', this.listener);
    this.post({ type: PREVIEW_MSG.ready, schemaVersion: LEVELS_SCHEMA_VERSION });
  }

  /** 停止（解除 listener），供場景關閉或不再需要時呼叫。 */
  stop(): void {
    window.removeEventListener('message', this.listener);
  }

  private onMessage(e: MessageEvent): void {
    // 同源檢查：只收自己 origin 的訊息，忽略任意來源。
    if (e.origin !== this.origin) return;

    const data = e.data as PreviewMessage | undefined;
    if (!data || typeof data !== 'object') return;
    if (data.type !== PREVIEW_MSG.levels) return;

    // iframe 邊界＝不信任輸入：遊戲端再驗一次。
    try {
      const validated = assertValidLevels(data.payload);
      this.onLevels(validated.levels);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.post({ type: PREVIEW_MSG.error, reason });
    }
  }

  /** 對 parent 送訊息，targetOrigin 指定為自身 origin（同源）。 */
  private post(msg: PreviewMessage): void {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, this.origin);
    }
  }
}
