import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOverlapSolver,
  getSurroundMode,
  setOverlapSolver,
  setSurroundMode,
  setSurroundRuntimeConfig,
  resetSurroundRuntimeConfig,
  getSurroundRuntimeConfig,
  DEFAULT_SURROUND_RUNTIME_CONFIG,
} from '../src/config/surroundConfig';

describe('surroundConfig — 環繞/推擠實驗開關', () => {
  beforeEach(() => resetSurroundRuntimeConfig());

  it('預設＝contactSolver + slots（現有行為升級版）', () => {
    expect(getOverlapSolver()).toBe('contactSolver');
    expect(getSurroundMode()).toBe('slots');
    expect(getSurroundRuntimeConfig()).toEqual(DEFAULT_SURROUND_RUNTIME_CONFIG);
  });

  it('setOverlapSolver 切 legacy（一鍵回退舊推擠）', () => {
    setOverlapSolver('legacy');
    expect(getOverlapSolver()).toBe('legacy');
    expect(getSurroundMode()).toBe('slots'); // 不影響另一組
  });

  it('setSurroundMode 切 emergent（純湧現 A/B）', () => {
    setSurroundMode('emergent');
    expect(getSurroundMode()).toBe('emergent');
    expect(getOverlapSolver()).toBe('contactSolver'); // 不影響另一組
  });

  it('setSurroundRuntimeConfig 部分覆寫（缺欄不動）', () => {
    setSurroundRuntimeConfig({ surroundMode: 'emergent' });
    expect(getSurroundMode()).toBe('emergent');
    expect(getOverlapSolver()).toBe('contactSolver'); // 沒傳 → 不動
    setSurroundRuntimeConfig({ overlapSolver: 'legacy' });
    expect(getOverlapSolver()).toBe('legacy');
    expect(getSurroundMode()).toBe('emergent'); // 沿用上次
  });

  it('resetSurroundRuntimeConfig 回預設', () => {
    setSurroundMode('emergent');
    setOverlapSolver('legacy');
    resetSurroundRuntimeConfig();
    expect(getOverlapSolver()).toBe('contactSolver');
    expect(getSurroundMode()).toBe('slots');
  });

  it('getSurroundRuntimeConfig 不洩漏可變參照到 DEFAULT（改 state 不動 DEFAULT）', () => {
    setSurroundMode('emergent');
    expect(DEFAULT_SURROUND_RUNTIME_CONFIG.surroundMode).toBe('slots'); // DEFAULT 沒被改到
  });
});
