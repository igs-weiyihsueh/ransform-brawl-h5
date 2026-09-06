/**
 * chestSchema.ts — 寶盒開箱設定表格式 + 驗證 + resolveChest 純函式
 *   （寶盒開放設定，用戶第九輪 #6；遊戲讀取端 + chest 編輯器共用單一真相）。
 *
 * 對齊 dashSchema/guardSchema/fireRainSchema 模式：零 Phaser，只 import chestConfig 型別/值當打包預設。
 * 匯出結構 { version, openThreshold, chargeByEnemy }。CHEST_OPEN_THRESHOLD + CHEST_CHARGE_BY_ENEMY 當打包預設。
 *
 * ★0-nullish 安全（本檔關鍵）：能量值 0 是合法（某怪擊殺給 0 charge、門檻理論可設 0）——
 *   一律用 ?? 合併 override，**絕不用 ||**（|| 會把 0 當 falsy 吃掉，測騎有壞版 || testcase 必紅）。
 */
import { CHEST_OPEN_THRESHOLD, CHEST_CHARGE_BY_ENEMY } from '@/config/chestConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 匯出檔頂層。openThreshold/chargeByEnemy 皆 optional：override 缺欄位 → 沿用打包預設。 */
export interface ChestFile {
  version: number;
  /** 開箱門檻（chestCharge ≥ 此值自動開箱）。省略 → 沿用打包 CHEST_OPEN_THRESHOLD。 */
  openThreshold?: number;
  /** 各敵人擊殺給的 chestCharge（key=敵人 key）。override 逐鍵合併(?? 保留 0)。省略 → 打包預設。 */
  chargeByEnemy?: Record<string, number>;
}

export const CHEST_SCHEMA_VERSION = 1 as const;

/** 遊戲要用的已解析寶盒設定（resolveChest 回傳）。 */
export interface ResolvedChest {
  openThreshold: number;
  chargeByEnemy: Record<string, number>;
}

/** 打包預設深拷貝當初值（editor 初值 / resolve fallback）。 */
export function defaultChestFile(): ChestFile {
  return {
    version: CHEST_SCHEMA_VERSION,
    openThreshold: CHEST_OPEN_THRESHOLD,
    chargeByEnemy: { ...CHEST_CHARGE_BY_ENEMY },
  };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateChestResult =
  | { ok: true; data: ChestFile }
  | { ok: false; errors: string[] };

export class ChestValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`寶盒設定驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'ChestValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/** 驗證任意 JSON 是否為合法 ChestFile。openThreshold/chargeByEnemy 皆 optional，有給才驗。 */
export function validateChest(json: unknown): ValidateChestResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) {
    return { ok: false, errors: ['根層級必須是物件 { version, openThreshold?, chargeByEnemy? }。'] };
  }
  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 version: 1）。');
  } else if (root.version !== CHEST_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${CHEST_SCHEMA_VERSION}）。`);
  }
  // openThreshold（optional）：若提供必須是數字且 ≥ 0（0 合法）。
  if (root.openThreshold !== undefined) {
    if (!isFiniteNumber(root.openThreshold)) {
      errors.push('「開箱門檻 openThreshold」若提供必須是數字。');
    } else if (root.openThreshold < 0) {
      errors.push(`「開箱門檻 openThreshold」=${root.openThreshold} 不可為負。`);
    }
  }
  // chargeByEnemy（optional）：若提供必須是物件，各值數字且 ≥ 0（0 合法：某怪給 0 能量）。
  if (root.chargeByEnemy !== undefined) {
    const cbe = asObject(root.chargeByEnemy);
    if (!cbe) {
      errors.push('「各怪能量 chargeByEnemy」若提供必須是物件（{ 敵人key: 數字 }）。');
    } else {
      for (const [k, v] of Object.entries(cbe)) {
        if (!isFiniteNumber(v)) {
          errors.push(`chargeByEnemy「${k}」的值必須是數字。`);
        } else if (v < 0) {
          errors.push(`chargeByEnemy「${k}」=${v} 不可為負。`);
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as ChestFile };
}

/** 驗證通過回收斂型別；否則拋 ChestValidationError（大聲失敗）。 */
export function assertValidChest(raw: unknown): ChestFile {
  const result = validateChest(raw);
  if (!result.ok) throw new ChestValidationError(result.errors);
  return result.data;
}

/**
 * 解析遊戲要用的寶盒設定（純函式，抽給測騎；同 resolveGuard/resolveDash 模式）。
 * - override 通過 validateChest → openThreshold ?? 打包、chargeByEnemy 逐鍵 {...打包, ...override}。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設（行為 100% 不變）。
 * ★0-nullish：openThreshold===0 / chargeByEnemy 某鍵===0 皆合法，用 ?? 保留（絕不用 ||）。
 *
 * @param override loadOverride(EDITOR_STORE_KEYS.chest) 的原始物件（未驗證）；null=無 override。
 * @param packagedThreshold 打包門檻（預設 CHEST_OPEN_THRESHOLD）。
 * @param packagedCharge 打包各怪能量（預設 CHEST_CHARGE_BY_ENEMY）。
 */
export function resolveChest(
  override: unknown,
  packagedThreshold: number = CHEST_OPEN_THRESHOLD,
  packagedCharge: Record<string, number> = CHEST_CHARGE_BY_ENEMY,
): ResolvedChest {
  const fallback = (): ResolvedChest => ({
    openThreshold: packagedThreshold,
    chargeByEnemy: { ...packagedCharge },
  });
  if (override === null || override === undefined) return fallback();
  const result = validateChest(override);
  if (!result.ok) return fallback();
  const data = result.data;
  return {
    // ★?? 非 ||：override.openThreshold===0 合法、要保留。
    openThreshold: data.openThreshold ?? packagedThreshold,
    // 逐鍵合併：打包為底，override 覆蓋同名（含 0）、可新增敵種鍵。
    chargeByEnemy: { ...packagedCharge, ...(data.chargeByEnemy ?? {}) },
  };
}

/** 取某敵人擊殺給的 chestCharge（未列→0）。遊戲端 chestChargeFor 可改讀 resolved 版。 */
export function chestChargeForResolved(resolved: ResolvedChest, enemyKey: string): number {
  return resolved.chargeByEnemy[enemyKey] ?? 0;
}

/** 已解析寶盒設定 cache（遊戲啟動讀一次；重開換）。 */
let resolvedChestCache: ResolvedChest | null = null;

/** 遊戲端取得已解析寶盒設定（override 優先 + cache）。 */
export function getResolvedChest(): ResolvedChest {
  if (resolvedChestCache) return resolvedChestCache;
  const override = loadOverride(EDITOR_STORE_KEYS.chest);
  if (override !== null) {
    const result = validateChest(override);
    if (!result.ok) console.warn('[chestSchema] chest override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedChestCache = resolveChest(override);
  return resolvedChestCache;
}
