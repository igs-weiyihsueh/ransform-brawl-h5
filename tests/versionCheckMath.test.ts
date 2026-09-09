// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isNewVersion,
  buildVersionUrl,
  parseVersionInfo,
  type VersionInfo,
} from '@/systems/versionCheckMath';

/**
 * versionCheckMath — 版本自動更新檢查純函式（測騎複核翼騎 df6d9b0：根治 GH Pages 載舊版）。
 * 純函式、不依賴 DOM/fetch。三函式各鎖 + 壞版對照。
 */
describe('isNewVersion — 兩邊非空且不等 → 有新版', () => {
  it('★兩邊非空、不相等 → true（有新版部署）', () => {
    expect(isNewVersion('abc123', 'def456')).toBe(true);
  });

  it('★相等 → false（同版，不誤報 reload）', () => {
    expect(isNewVersion('abc123', 'abc123')).toBe(false);
  });

  it('★任一為空（null/undefined/空字串）→ false（尚未載到，不誤報）', () => {
    // current 空：即使 fetched 有值也不報（避免啟動未注入時誤觸 reload）。
    expect(isNewVersion(null, 'def456')).toBe(false);
    expect(isNewVersion(undefined, 'def456')).toBe(false);
    expect(isNewVersion('', 'def456')).toBe(false); // ★空字串 falsy → 走 guard
    // fetched 空：同理不報。
    expect(isNewVersion('abc123', null)).toBe(false);
    expect(isNewVersion('abc123', undefined)).toBe(false);
    expect(isNewVersion('abc123', '')).toBe(false);
    // 兩邊都空 → false（不會因「都空且相等」而漏走 guard）。
    expect(isNewVersion('', '')).toBe(false);
    expect(isNewVersion(null, null)).toBe(false);
  });
});

describe('buildVersionUrl — cache-bust ?t=now（依 baseUrl 是否含 ? 選分隔符）', () => {
  it('★baseUrl 無 ? → 用 ? 接', () => {
    expect(buildVersionUrl('./version.json', 123)).toBe('./version.json?t=123');
  });

  it('★baseUrl 已含 ? → 用 & 接（不產生第二個 ?）', () => {
    expect(buildVersionUrl('a?x=1', 123)).toBe('a?x=1&t=123');
  });

  it('now 省略 → 用 Date.now()（格式含 ?t= 數字，值為當下時戳）', () => {
    const before = Date.now();
    const url = buildVersionUrl('./version.json');
    const m = url.match(/^\.\/version\.json\?t=(\d+)$/);
    expect(m).not.toBeNull();
    const t = Number(m![1]);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});

describe('parseVersionInfo — 容錯解析（格式不符回 null 不炸）', () => {
  it('★合法 {version} → 採用；commit/builtAt 各自帶入', () => {
    const r = parseVersionInfo({ version: 'v1', commit: 'abc', builtAt: '2026-09-09T00:00:00Z' });
    expect(r).toEqual({ version: 'v1', commit: 'abc', builtAt: '2026-09-09T00:00:00Z' });
  });

  it('★缺 version / version 非字串 / version 空字串 → null', () => {
    expect(parseVersionInfo({ commit: 'abc' })).toBeNull(); // 缺 version
    expect(parseVersionInfo({ version: 123 })).toBeNull(); // 非字串
    expect(parseVersionInfo({ version: '' })).toBeNull(); // ★空字串 → null（length===0 守衛）
  });

  it('★null / 非物件（字串/數字/陣列以外基本型）→ null', () => {
    expect(parseVersionInfo(null)).toBeNull();
    expect(parseVersionInfo(undefined)).toBeNull();
    expect(parseVersionInfo('v1')).toBeNull(); // 字串非物件
    expect(parseVersionInfo(123)).toBeNull();
  });

  it('★物件守衛 load-bearing：function-with-props（帶合法 version 但 typeof≠object）→ null', () => {
    // 純字串/數字的 .version 是 undefined → 被 version 檢查擋（等價 mutant）。
    // 用「帶 version:'v1' 屬性的 function」鑑別物件守衛：typeof 'function'≠'object' → null；
    //   若移除 `typeof raw !== 'object'` 守衛 → 讀到 fn.version='v1' → 誤採用 → 紅。
    const fn = Object.assign(() => {}, { version: 'v1', commit: 'c' });
    expect(parseVersionInfo(fn as unknown)).toBeNull();
  });

  it('★commit/builtAt 非字串 → undefined（不帶入髒值），version 仍採用', () => {
    const r = parseVersionInfo({ version: 'v1', commit: 999, builtAt: {} });
    expect(r).toEqual({ version: 'v1', commit: undefined, builtAt: undefined });
  });

  it('★commit/builtAt 逐欄獨立（只給 commit → builtAt undefined，反之亦然；不串欄）', () => {
    // 各欄用不同值，抓「讀 commit 卻回 builtAt」之類串欄 mutant。
    const onlyCommit = parseVersionInfo({ version: 'v1', commit: 'COMMIT_X' });
    expect(onlyCommit).toEqual({ version: 'v1', commit: 'COMMIT_X', builtAt: undefined });
    const onlyBuilt = parseVersionInfo({ version: 'v1', builtAt: 'BUILT_Y' });
    expect(onlyBuilt).toEqual({ version: 'v1', commit: undefined, builtAt: 'BUILT_Y' });
  });
});
