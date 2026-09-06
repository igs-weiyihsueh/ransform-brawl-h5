// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tetherEndPoint } from '@/systems/itemGuideMath';
import { FOOT_GLOW, footGlowCenter } from '@/config/playerConfig';

/**
 * 牽引線牽到「視覺搜索圈」邊緣（用戶第九輪#5 治本）。
 *
 * 真因（headless 量化）：TransformSystem.drawTethers 舊版傳 charCenter=getVacuumCenter()，
 * 但 getVacuumCenter 已於 #7#8 改成「身體中心」(sprite 幾何中心, 供 surround/推怪上下對稱)，
 * 而玩家看到的貼地搜索圈畫在 footGlowCenter(腳部, 往下 offsetY≈75.6px)。→ tetherEndPoint 算的圈邊緣
 * 是「身體中心圈」邊緣，比視覺搜索圈近 anchor 那側短 ~75.6px（線停身體附近、沒牽到腳下圈）。
 *
 * 治本：drawTethers 改傳 charCenter=玩家 getFootGlowCenter()(＝footGlowCenter, 視覺圈中心)、
 * radiusPx=getVacuumRadius()(foot.radiusPx, 同視覺圈半徑) → 終點落實際搜索圈邊緣（所見即所得）。
 * tetherEndPoint 純函式本身正確(itemGuideMath.test 已測)，此檔驗「傳對中心＝落視覺圈邊緣」的契約。
 */
describe('牽引線終點落「視覺搜索圈」邊緣（#5 傳對 footGlowCenter）', () => {
  const spriteX = 960, spriteY = 400;
  const radius = FOOT_GLOW.radiusPx; // 50
  const anchor = { x: 960, y: 1000 }; // 面板下方待機點（線從下往上）

  const bodyCenter = { x: spriteX, y: spriteY }; // 舊 getVacuumCenter
  const footCenter = footGlowCenter(spriteX, spriteY); // 新 getFootGlowCenter（視覺圈中心）
  const visibleNearEdgeY = footCenter.y + radius; // 視覺搜索圈靠 anchor(下)那側邊緣

  it('傳 footGlowCenter → 終點恰落視覺搜索圈邊緣（dist 到 footCenter ≈ radius、y ≈ 視覺邊緣）', () => {
    const end = tetherEndPoint(anchor, footCenter, radius);
    expect(Math.hypot(end.x - footCenter.x, end.y - footCenter.y)).toBeCloseTo(radius);
    expect(end.y).toBeCloseTo(visibleNearEdgeY); // anchor 正下方 → 終點落橢圓下頂點＝視覺圈邊緣（圓近似在垂直軸精確）
  });

  it('★ 壞版對照：傳 body center（舊）→ 終點短 offsetY≈75.6px、沒到視覺圈邊緣', () => {
    const endOld = tetherEndPoint(anchor, bodyCenter, radius);
    const shortfall = Math.abs(endOld.y - visibleNearEdgeY);
    expect(shortfall).toBeCloseTo(FOOT_GLOW.offsetYPx); // 差一個腳部 offset＝正是使用者看到「沒牽到圈、停身體」的量
    expect(shortfall).toBeGreaterThan(50); // 明顯短一大截（>radius）
  });

  it('搜索圈半徑改變（#5 可調）→ 終點跟著落新半徑邊緣（傳 getVacuumRadius 自動跟）', () => {
    for (const r of [30, 50, 80]) {
      const end = tetherEndPoint(anchor, footCenter, r);
      expect(end.y).toBeCloseTo(footCenter.y + r); // 落 footCenter 下方 r＝新半徑邊緣
    }
  });
});
