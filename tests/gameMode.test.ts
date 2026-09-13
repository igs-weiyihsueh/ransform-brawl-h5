import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_MODE, resolveGameMode } from '@/config/gameMode';

/** GameMode 收斂純函式測試（鬥氣模式階段 0）。★核心：缺省/非法一律 normal＝現況安全。 */
describe('resolveGameMode', () => {
  it("'douqi' → 'douqi'", () => {
    expect(resolveGameMode('douqi')).toBe('douqi');
  });
  it("'normal' → 'normal'", () => {
    expect(resolveGameMode('normal')).toBe('normal');
  });
  it('undefined → normal（★缺省＝現況）', () => {
    expect(resolveGameMode(undefined)).toBe('normal');
  });
  it('非法值 → normal（安全預設）', () => {
    expect(resolveGameMode('garbage')).toBe('normal');
    expect(resolveGameMode(123)).toBe('normal');
    expect(resolveGameMode(null)).toBe('normal');
  });
  it('DEFAULT_GAME_MODE === normal', () => {
    expect(DEFAULT_GAME_MODE).toBe('normal');
  });
});
