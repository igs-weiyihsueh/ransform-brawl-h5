// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  playAreaMaxY,
  PLAYER_BOUNDS,
  ENEMY_PLAY_BOUNDS,
  MAP_BOUNDS,
  PANEL_TOP_Y,
} from '@/config/mapConfig';
import { FOOT_GLOW } from '@/config/playerConfig';

/**
 * 四輪#1 地圖下界穿面板根治（翼騎 888c698）：玩家腳底/怪底邊停面板上緣（面板感知，別寫死）。
 * 真因：玩家 clamp margin 原用 hitRadius(60) < 腳底偏移 FOOT_GLOW.offsetYPx(75.6) → 腳底穿面板 16px。
 * 修：margin 改用 offsetYPx；純函式 playAreaMaxY(panelTopY, bottomMargin)=panelTopY−bottomMargin。怪加面板感知 ENEMY_PLAY_BOUNDS。
 * 維度3 斷邊界值/語意。含壞版必紅（playAreaMaxY 方向 / margin 從 offsetY 非寫死 / 怪面板感知）。
 * ⚠️ clampToMapBounds 每幀 clamp 屬狀態機(需 boot,翼騎量化玩家腳底944/怪底邊934驗過)——不補;純函式+邊界常數斷值補足。
 */
describe('playAreaMaxY — 面板感知下界純函式（panelTopY − bottomMargin）', () => {
  it('playAreaMaxY(944, 75.6) = 868.4', () => {
    expect(playAreaMaxY(944, 75.6)).toBeCloseTo(868.4);
  });

  it('通式：playAreaMaxY(panelTop, margin) = panelTop − margin', () => {
    expect(playAreaMaxY(1000, 100)).toBe(900);
    expect(playAreaMaxY(500, 0)).toBe(500);
    expect(playAreaMaxY(944, FOOT_GLOW.offsetYPx)).toBeCloseTo(944 - FOOT_GLOW.offsetYPx);
  });
});

describe('PLAYER_BOUNDS — 玩家腳底停面板頂（#1 核心）', () => {
  it('maxY = min(MAP_BOUNDS.maxY, playAreaMaxY(PANEL_TOP_Y, offsetYPx)) ≈ 868.4', () => {
    expect(PLAYER_BOUNDS.maxY).toBeCloseTo(868.4);
    expect(PLAYER_BOUNDS.maxY).toBe(Math.min(MAP_BOUNDS.maxY, playAreaMaxY(PANEL_TOP_Y, FOOT_GLOW.offsetYPx)));
  });

  it('★ 腳底=面板頂語意：玩家中心 maxY + FOOT_GLOW.offsetYPx = PANEL_TOP_Y(944)（腳底剛好停面板頂）', () => {
    expect(PLAYER_BOUNDS.maxY + FOOT_GLOW.offsetYPx).toBeCloseTo(PANEL_TOP_Y);
    expect(PANEL_TOP_Y).toBe(944);
  });

  it('★ margin 從 offsetYPx 算非寫死：maxY = PANEL_TOP_Y − FOOT_GLOW.offsetYPx（改 offsetY 邊界會跟，別寫死 868）', () => {
    // 若 margin 寫死 60(hitRadius) → maxY=884 腳底穿面板；寫死 868 → 改 offsetY 不跟。
    expect(PLAYER_BOUNDS.maxY).toBeCloseTo(PANEL_TOP_Y - FOOT_GLOW.offsetYPx);
    expect(PLAYER_BOUNDS.maxY).not.toBe(884); // 非舊 hitRadius margin 值
  });

  it('下界收在面板頂之上：PLAYER_BOUNDS.maxY < PANEL_TOP_Y', () => {
    expect(PLAYER_BOUNDS.maxY).toBeLessThan(PANEL_TOP_Y);
  });
});

describe('ENEMY_PLAY_BOUNDS — 怪面板感知下界', () => {
  // ⚠️ 誠實：當前常數 MAP_BOUNDS.maxY(940) < PANEL_TOP_Y(944)，故 min 的第二臂(PANEL_TOP_Y)不 binding，
  //    怪的面板感知 branch 目前不承重（改成只 MAP_BOUNDS.maxY 不會紅）→ 見 ledger #7。
  //    這些斷言記錄「公式=min(兩者)」語意；當 PANEL_TOP_Y<MAP_BOUNDS.maxY 時才變承重，屆時補鑑別測試。
  it('★ maxY = min(MAP_BOUNDS.maxY, PANEL_TOP_Y)（面板感知公式；當前 =940，見 ledger #7 條件承重）', () => {
    expect(ENEMY_PLAY_BOUNDS.maxY).toBe(Math.min(MAP_BOUNDS.maxY, PANEL_TOP_Y));
  });

  it('怪下界 <= 面板頂（底邊不穿面板）且 X/上界同 MAP_BOUNDS', () => {
    expect(ENEMY_PLAY_BOUNDS.maxY).toBeLessThanOrEqual(PANEL_TOP_Y);
    expect(ENEMY_PLAY_BOUNDS.minX).toBe(MAP_BOUNDS.minX);
    expect(ENEMY_PLAY_BOUNDS.maxX).toBe(MAP_BOUNDS.maxX);
    expect(ENEMY_PLAY_BOUNDS.minY).toBe(MAP_BOUNDS.minY);
  });
});
