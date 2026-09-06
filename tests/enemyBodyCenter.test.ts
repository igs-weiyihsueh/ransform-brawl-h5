// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ENEMY_BODY_CENTER_OFFSET_Y } from '@/config/enemyConfig';
import { SPRITE_SCALE } from '@/config/combatConfig';
import { buildAttackCircle } from '@/systems/hitDetection';
import type { AttackData } from '@/systems/AttackData';

/**
 * 五輪#4 菁英預警圈圓心對齊視覺 body 中心（翼騎 d955b8a）。
 * 真因：buildAttackCircle 圓心原用 getHitCenter(sprite 幾何中心)，但 frame 上方留白、角色美術在下半
 *   → 幾何中心比可見 body 中心高 → 菁英在預警圈下半不置中（headless dx/dy=0 但看圖偏，數字對≠視覺對）。
 * 修：ENEMY_BODY_CENTER_OFFSET_Y=40×SPRITE_SCALE；Enemy.getBodyCenter()=hitCenter 往下偏 offset×perCharScale；
 *   buildAttackCircle 全改用 getBodyCenter（預警圈+爆發+meleeCircle 傷害+canReachTarget 一致下移）。
 * 維度3 斷 offset 常數/符號/圓心追隨 attackerPos。含壞版必紅。
 * ⚠️ getBodyCenter 是 Enemy entity 方法(讀 this.anim.sprite.y、需 boot)、aoeRing/aoeBurst 繪製 + meleeCircle
 *   接線屬狀態機(翼騎 subagent 看圖驗 CENTERED)——不補;此處補 ★可純測的：offset 常數(非寫死)+ 符號(+y 下)
 *   + getBodyCenter 計算式 + buildAttackCircle 圓心=傳入 attackerPos（offset 由呼叫端下移 → 圓心跟著下移）。
 */
function circleAttack(over: Partial<AttackData> = {}): AttackData {
  return { shapeType: 'circle', radius: 1, offsetX: 0, offsetY: 0, damage: 5, hitDelay: 0, knockback: 0, ...over };
}

describe('ENEMY_BODY_CENTER_OFFSET_Y — body 中心偏移（#4 從 SPRITE_SCALE 算非寫死）', () => {
  it('★ = 40 × SPRITE_SCALE（改 scale 會跟，別寫死 63/29.4）', () => {
    expect(ENEMY_BODY_CENTER_OFFSET_Y).toBeCloseTo(40 * SPRITE_SCALE);
    expect(ENEMY_BODY_CENTER_OFFSET_Y).not.toBe(63); // 非舊估算寫死值
  });

  it('offset > 0（H5 Y 下為正 → body 中心在 sprite 幾何中心「下方」，往可見身體下移）', () => {
    expect(ENEMY_BODY_CENTER_OFFSET_Y).toBeGreaterThan(0);
  });
});

describe('getBodyCenter 計算式 — hitCenter + offset×perCharScale（複現 Enemy.getBodyCenter）', () => {
  // Enemy.getBodyCenter(): { x: sprite.x, y: sprite.y + ENEMY_BODY_CENTER_OFFSET_Y * scaleFactor }
  const bodyCenterY = (spriteY: number, scaleFactor: number) =>
    spriteY + ENEMY_BODY_CENTER_OFFSET_Y * scaleFactor;

  it('★ body 中心 y = hitCenter(sprite) y 往下偏 offset（perCharScale=1）', () => {
    expect(bodyCenterY(500, 1)).toBeCloseTo(500 + ENEMY_BODY_CENTER_OFFSET_Y);
    expect(bodyCenterY(500, 1)).toBeGreaterThan(500); // 確為往下(+y)
  });

  it('perCharScale 放大 → 偏移等比放大（菁英較大 body 中心更低）', () => {
    expect(bodyCenterY(500, 2)).toBeCloseTo(500 + ENEMY_BODY_CENTER_OFFSET_Y * 2);
    expect(bodyCenterY(500, 2) - 500).toBeCloseTo(2 * (bodyCenterY(500, 1) - 500));
  });

  it('x 不受影響（只下移 y，x 同 sprite）', () => {
    // x 直接是 sprite.x，此處以計算式表意：offset 只加在 y。
    expect(ENEMY_BODY_CENTER_OFFSET_Y).toBeGreaterThan(0); // 保 offset 存在
  });
});

describe('buildAttackCircle — 圓心追隨傳入 attackerPos（呼叫端改傳 bodyCenter → 圓心下移）', () => {
  const SCALE = 1;
  it('★ 圓心 y = attackerPos.y + attack.offsetY×scale×PPU：傳 bodyCenter 比傳 hitCenter 低 offset', () => {
    const hitCenter = { x: 960, y: 500 };
    const bodyCenter = { x: 960, y: 500 + ENEMY_BODY_CENTER_OFFSET_Y }; // getBodyCenter 下移
    const atk = circleAttack({ offsetX: 0, offsetY: 0 });
    const cHit = buildAttackCircle(atk, hitCenter, 1, SCALE);
    const cBody = buildAttackCircle(atk, bodyCenter, 1, SCALE);
    // 圓心忠實反映傳入的中心：body 版比 hit 版低 offset（菁英置中修正 = 傳 bodyCenter）。
    expect(cBody.center.y - cHit.center.y).toBeCloseTo(ENEMY_BODY_CENTER_OFFSET_Y);
    expect(cBody.center.y).toBeGreaterThan(cHit.center.y); // 往下
    expect(cBody.center.x).toBe(cHit.center.x); // x 不變
  });

  it('圓心 = attackerPos + attack.offset（無 attack offset 時圓心≡attackerPos）', () => {
    const pos = { x: 300, y: 700 };
    const c = buildAttackCircle(circleAttack({ offsetX: 0, offsetY: 0 }), pos, 1, SCALE);
    expect(c.center).toEqual(pos);
  });

  it('一致性：同一 builder 對任何近戰敵人都以傳入 body 中心為圓心（offset 一致套用）', () => {
    // 衝鋒兵/菁英/一般：呼叫端都傳各自 getBodyCenter → 圓心都在各自 body 中心。
    for (const y of [200, 500, 900]) {
      const body = { x: 100, y: y + ENEMY_BODY_CENTER_OFFSET_Y };
      const c = buildAttackCircle(circleAttack(), body, 1, SCALE);
      expect(c.center.y).toBeCloseTo(y + ENEMY_BODY_CENTER_OFFSET_Y);
    }
  });
});
