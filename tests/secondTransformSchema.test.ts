import { describe, expect, it } from 'vitest';
import {
  resolveSecondTransformEnabled,
  SECOND_TRANSFORM_SCHEMA_VERSION,
  defaultSecondTransformFile,
} from '@/config/secondTransformSchema';

/**
 * secondTransformSchema — 二段變身「啟用開關」override 解析（用戶要編輯器可控開/關）。
 * resolveSecondTransformEnabled(override, packaged=false)：
 *   合法 {version:1, enabled:bool} → override.enabled；否則（null/非物件/version 錯/enabled 非 bool）→ packaged。
 * ★預設 packaged=false（override 沒設=關=現況不變）。含壞版對照必紅。
 */
describe('resolveSecondTransformEnabled — override 優先、fallback 打包預設', () => {
  it('override 沒設（null/undefined）→ 回打包預設（預設 false）', () => {
    expect(resolveSecondTransformEnabled(null)).toBe(false);
    expect(resolveSecondTransformEnabled(undefined)).toBe(false);
  });

  it('合法 override enabled=true → 啟用（用戶編輯器開開關）', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: true })).toBe(true);
  });

  it('合法 override enabled=false → 關（用戶編輯器關開關）', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: false })).toBe(false);
  });

  it('packaged 參數可覆寫 fallback（override 無效時回 packaged）', () => {
    expect(resolveSecondTransformEnabled(null, true)).toBe(true);
    expect(resolveSecondTransformEnabled(null, false)).toBe(false);
  });

  it('★壞版對照：version 錯 → 不採用、回 packaged（預設 false）', () => {
    expect(resolveSecondTransformEnabled({ version: 2, enabled: true })).toBe(false);
    expect(resolveSecondTransformEnabled({ enabled: true })).toBe(false); // 缺 version
  });

  it('★壞版對照：enabled 非 boolean → 不採用、回 packaged', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: 'true' })).toBe(false);
    expect(resolveSecondTransformEnabled({ version: 1, enabled: 1 })).toBe(false);
    expect(resolveSecondTransformEnabled({ version: 1 })).toBe(false); // 缺 enabled
  });

  it('★壞版對照：非物件（字串/數字/陣列）→ 回 packaged', () => {
    expect(resolveSecondTransformEnabled('nope' as unknown)).toBe(false);
    expect(resolveSecondTransformEnabled(123 as unknown)).toBe(false);
    expect(resolveSecondTransformEnabled([1, 2] as unknown)).toBe(false);
  });

  it('SCHEMA_VERSION=1、defaultSecondTransformFile 為 {version:1, enabled:預設(false)}', () => {
    expect(SECOND_TRANSFORM_SCHEMA_VERSION).toBe(1);
    const f = defaultSecondTransformFile();
    expect(f.version).toBe(1);
    expect(f.enabled).toBe(false); // 打包預設關
  });
});
