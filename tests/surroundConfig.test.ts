import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOverlapSolver,
  getSurroundMode,
  getPlayerSolver,
  setOverlapSolver,
  setSurroundMode,
  setPlayerSolver,
  setSurroundRuntimeConfig,
  resetSurroundRuntimeConfig,
  getSurroundRuntimeConfig,
  DEFAULT_SURROUND_RUNTIME_CONFIG,
} from '../src/config/surroundConfig';

describe('surroundConfig — 環繞/推擠實驗開關', () => {
  beforeEach(() => resetSurroundRuntimeConfig());

  it('預設＝contactSolver + slots + ★playerSolver legacy（怪-怪升級但玩家手感不動）', () => {
    expect(getOverlapSolver()).toBe('contactSolver');
    expect(getSurroundMode()).toBe('slots');
    expect(getPlayerSolver()).toBe('legacy'); // ★階段②預設不動手感
    expect(getSurroundRuntimeConfig()).toEqual(DEFAULT_SURROUND_RUNTIME_CONFIG);
  });

  it('setPlayerSolver 切 contactSolver（玩家推擠開關，用戶實機試）→ 不影響另兩組', () => {
    setPlayerSolver('contactSolver');
    expect(getPlayerSolver()).toBe('contactSolver');
    expect(getOverlapSolver()).toBe('contactSolver');
    expect(getSurroundMode()).toBe('slots');
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
    setPlayerSolver('contactSolver');
    resetSurroundRuntimeConfig();
    expect(getOverlapSolver()).toBe('contactSolver');
    expect(getSurroundMode()).toBe('slots');
    expect(getPlayerSolver()).toBe('legacy');
  });

  it('setSurroundRuntimeConfig 可一次覆寫 playerSolver（缺欄不動）', () => {
    setSurroundRuntimeConfig({ playerSolver: 'contactSolver' });
    expect(getPlayerSolver()).toBe('contactSolver');
    expect(getOverlapSolver()).toBe('contactSolver'); // 沒傳 → 不動
    expect(getSurroundMode()).toBe('slots');
  });

  it('getSurroundRuntimeConfig 不洩漏可變參照到 DEFAULT（改 state 不動 DEFAULT）', () => {
    setSurroundMode('emergent');
    expect(DEFAULT_SURROUND_RUNTIME_CONFIG.surroundMode).toBe('slots'); // DEFAULT 沒被改到
  });
});
