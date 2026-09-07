// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  loadOverride,
  clearOverride,
  hasOverride,
} from '@/config/editorStore';

/**
 * editorStore — 編輯器「套用到遊戲」localStorage 契約（匯入機制核心，翼騎整合波騎 5a463ca）。
 * 編輯器(寫)+遊戲讀取端(讀)共用此檔,key/讀寫單一真相。applyToGame 存→loadOverride 優先讀→clearOverride 回預設。
 * 純模組(用 globalThis.localStorage)→ node 需 polyfill。維度3 斷存/讀/清/key/安全 fallback。含壞版必紅。
 * ⚠️ 編輯器「套用」按鈕 + 遊戲啟動 loader 優先讀 override 接線屬狀態機(需 boot,翼騎 headless 驗 uiLayout/levels override 生效)
 *    ——不補;editorStore 純模組(round-trip + 安全 fallback + key 契約)補足。零 schema 驗(validate 在呼叫端)。
 */

/** 記憶體 Map mock localStorage。 */
function makeMemoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
  } as Storage;
}

const K = EDITOR_STORE_KEYS.uiLayout;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = makeMemoryStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('editorStore — key 契約（單一真相，勿打錯）', () => {
  it('★ EDITOR_STORE_KEYS 四值硬斷（打錯→遊戲端讀不到，匯入整條斷）', () => {
    expect(EDITOR_STORE_KEYS.uiLayout).toBe('transformbrawl:uiLayout');
    expect(EDITOR_STORE_KEYS.levels).toBe('transformbrawl:levels');
    expect(EDITOR_STORE_KEYS.enemies).toBe('transformbrawl:enemies');
    expect(EDITOR_STORE_KEYS.skills).toBe('transformbrawl:skills');
  });
});

describe('editorStore — applyToGame（存,不驗 schema）', () => {
  it('存後 localStorage[key] 有值（= JSON.stringify），回 true', () => {
    expect(applyToGame(K, { a: 1 })).toBe(true);
    expect(localStorage.getItem(K)).toBe(JSON.stringify({ a: 1 }));
  });

  it('editorStore 只存不驗：餵任何物件都照存（validate 是呼叫端的事）', () => {
    expect(applyToGame(K, { anything: true, nested: [1, 2] })).toBe(true);
    expect(localStorage.getItem(K)).toBe(JSON.stringify({ anything: true, nested: [1, 2] }));
  });
});

describe('editorStore — round-trip / clear / has', () => {
  it('★ round-trip：applyToGame 存 → loadOverride 讀回相同物件（deep-equal，物件非字串）', () => {
    const data = { a: 1, nested: { b: 2, arr: [3, 4] } };
    applyToGame(K, data);
    const back = loadOverride(K);
    expect(back).toEqual(data); // deep-equal
    expect(typeof back).toBe('object'); // 物件非字串（有 parse）
  });

  it('沒存過 → loadOverride 回 null', () => {
    expect(loadOverride(K)).toBeNull();
  });

  it('★ clearOverride 後 → loadOverride null、hasOverride false（removeItem）', () => {
    applyToGame(K, { a: 1 });
    expect(hasOverride(K)).toBe(true);
    clearOverride(K);
    expect(loadOverride(K)).toBeNull();
    expect(hasOverride(K)).toBe(false);
  });

  it('hasOverride：存了 true、沒存 false', () => {
    expect(hasOverride(K)).toBe(false);
    applyToGame(K, { a: 1 });
    expect(hasOverride(K)).toBe(true);
  });

  it('各 key 獨立（存 uiLayout 不影響 levels）', () => {
    applyToGame(EDITOR_STORE_KEYS.uiLayout, { u: 1 });
    expect(hasOverride(EDITOR_STORE_KEYS.levels)).toBe(false);
    expect(loadOverride(EDITOR_STORE_KEYS.uiLayout)).toEqual({ u: 1 });
  });
});

describe('editorStore — 安全 fallback（各環境不炸）', () => {
  it('★ 壞 JSON：getItem 回非法 JSON → loadOverride null（不 throw）', () => {
    localStorage.setItem(K, '{not valid json');
    expect(() => loadOverride(K)).not.toThrow();
    expect(loadOverride(K)).toBeNull();
  });

  it('★ setItem throw（配額滿）→ applyToGame false（不炸）', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...makeMemoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    } as Storage;
    expect(() => applyToGame(K, { a: 1 })).not.toThrow();
    expect(applyToGame(K, { a: 1 })).toBe(false);
  });

  it('★ localStorage 全不存在 → applyToGame false / loadOverride null / hasOverride false（不炸）', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => applyToGame(K, { a: 1 })).not.toThrow();
    expect(applyToGame(K, { a: 1 })).toBe(false);
    expect(loadOverride(K)).toBeNull();
    expect(hasOverride(K)).toBe(false);
    expect(() => clearOverride(K)).not.toThrow();
  });
});
