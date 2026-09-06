// @vitest-environment jsdom
/**
 * GuardTarget 讀雕像/血條 UI config 整合（用戶第十輪#1#4）。
 * - 傳 ui override → 血條寬套用（takeDamage 後 barFill.width 依 barWidthPx×ratio，非舊 hardcode 100）。
 * - 省略 ui → 用打包預設（#1 放大後的 barWidthPx=160）。
 * - hitRadius：headless 無 statue 紋理走方塊 fallback(radiusPx=60)，statueHeightPx→hitRadius 的
 *   等比公式(dispW=targetH×ratio, radiusPx=dispW/2)在 resolveGuardStatueUi 純函式測 + 讀碼契約覆蓋。
 * ⚠️ jsdom + HEADLESS scene，afterEach forceDestroy 不殘留。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { GuardTarget } from '@/entities/GuardTarget';
import { resolveGuardStatueUi, GUARD_STATUE_UI_DEFAULTS } from '@/config/guardConfig';

let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class T extends Phaser.Scene {
      constructor() { super({ key: 'T' }); }
      create(): void { scene = this; resolve(); }
    }
    game = new Phaser.Game({
      type: Phaser.HEADLESS, width: 100, height: 100, scene: [T],
      audio: { noAudio: true }, banner: false,
    });
  });
});
afterAll(() => game?.destroy(true));

/** 讀 barFill 寬（GuardTarget 私有；用 container 子物件反射，維度3 斷實際繪製寬）。 */
function barFillWidth(t: GuardTarget): number {
  // barFill 是 container 第 4 個子物件（body,label,barBg,barFill）。
  const container = (t as unknown as { container: Phaser.GameObjects.Container }).container;
  const fill = container.list[container.list.length - 1] as Phaser.GameObjects.Rectangle;
  return fill.width;
}

describe('GuardTarget — 讀雕像/血條 UI config（#1#4）', () => {
  it('傳 ui override barWidthPx=200 → 滿血血條寬=200（非舊 hardcode 100）', () => {
    const ui = resolveGuardStatueUi({ barWidthPx: 200 });
    const t = new GuardTarget(scene, 0, 0, 100, ui);
    expect(barFillWidth(t)).toBeCloseTo(200); // 滿血 ratio=1
    t.destroy();
  });

  it('半血 → 血條寬=barWidthPx×0.5（依 config 縮放，非寫死 100×ratio）', () => {
    const ui = resolveGuardStatueUi({ barWidthPx: 200 });
    const t = new GuardTarget(scene, 0, 0, 100, ui);
    t.takeDamage(50); // 剩 50/100
    expect(barFillWidth(t)).toBeCloseTo(100); // 200×0.5
    t.destroy();
  });

  it('省略 ui → 用打包預設放大血條（#1：barWidthPx=160）', () => {
    const t = new GuardTarget(scene, 0, 0, 100); // 不傳 ui
    expect(barFillWidth(t)).toBeCloseTo(GUARD_STATUE_UI_DEFAULTS.barWidthPx); // 160
    t.destroy();
  });
});
