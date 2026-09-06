import { describe, expect, it } from 'vitest';
import { shouldEnterCharge } from '@/systems/enemySeparation';

/**
 * shouldEnterCharge（用戶第十輪#2 菁英打不到雕像，治本；決策 34b0be5b「停止=攻擊基準」）。
 *
 * 真因（headless 量化）：菁英 immovable 環繞槽 minLayer=2 → 半徑 = baseRadius 80 + 2×layerSpacing 60 = 200px
 *   ＝ attackRange 2unit×PPU 100 = 200px（剛好邊界）。攻擊 shape 半徑=attack.radius 1.5×scale 1.5×PPU 100=225px
 *   遠遠涵蓋雕像（canReach=true）。舊 gate `dist<=attackPx && canReach`：鄰居分離力/浮點把 dist 推過 200 →
 *   粗 gate false → 明明搆得到卻不揮 → 卡外圈空轉。
 *
 * 治本：近戰只信 canReach（攻擊 shape 權威判定）；射彈仍用 dist<=attackPx 當射程 gate。
 */
describe('shouldEnterCharge — 近戰信 canReach、射彈信射程', () => {
  const ATTACK_PX = 200; // attackRange 2unit × PPU 100

  describe('近戰（melee）', () => {
    it('菁英環繞槽=200px（＝attackRange 邊界）canReach 搆得到 → 應蓄力（治本核心）', () => {
      // 舊 gate：dist 200 <= 200 是 true，但被分離力推過 200 就 false → 卡外圈。
      expect(shouldEnterCharge('melee', 200, ATTACK_PX, true)).toBe(true);
    });

    it('dist 被推過 attackRange（201）但攻擊 shape 仍搆得到 → 應蓄力（不再被粗 gate 誤殺）', () => {
      expect(shouldEnterCharge('melee', 201, ATTACK_PX, true)).toBe(true);
    });

    it('大範圍菁英 dist=260 攻擊半徑 225 仍涵蓋雕像（canReach true）→ 應蓄力', () => {
      expect(shouldEnterCharge('melee', 260, ATTACK_PX, true)).toBe(true);
    });

    it('攻擊 shape 搆不到（canReach false）→ 不蓄力（繼續逼近，不空揮）', () => {
      expect(shouldEnterCharge('melee', 150, ATTACK_PX, false)).toBe(false);
      expect(shouldEnterCharge('melee', 999, ATTACK_PX, false)).toBe(false);
    });

    it('近戰不受 dist>attackPx 影響（只看 canReach）', () => {
      // 距離很遠但 canReach true（理論上不會發生，但驗證 gate 純由 canReach 決定）
      expect(shouldEnterCharge('melee', 5000, ATTACK_PX, true)).toBe(true);
    });
  });

  describe('射彈（projectile，canReach 恆 true）', () => {
    it('射程內（dist<=attackPx）→ 開火', () => {
      expect(shouldEnterCharge('projectile', 150, ATTACK_PX, true)).toBe(true);
      expect(shouldEnterCharge('projectile', 200, ATTACK_PX, true)).toBe(true);
    });

    it('超出射程（dist>attackPx）→ 不開火（射彈仍受射程 gate，不會超遠亂射）', () => {
      expect(shouldEnterCharge('projectile', 201, ATTACK_PX, true)).toBe(false);
      expect(shouldEnterCharge('projectile', 500, ATTACK_PX, true)).toBe(false);
    });
  });
});
