// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildAttackCircle,
  circleIntersectsCircle,
  isPlayerInEnemyAttackShape,
} from '@/systems/hitDetection';
import { PPU } from '@/config/gameConfig';
import type { AttackData } from '@/systems/AttackData';

/**
 * isPlayerInEnemyAttackShape 純函式（用戶試玩新#2 敵人空揮，翼騎 3a337cc）。
 * 揮前形狀確認：用【跟實際命中同一套】buildAttack + intersects（同 offset×scale×PPU 中心、
 * 玩家當圓），判斷玩家是否真在攻擊形狀內。維度3 斷實際 bool + 幾何邊界，非 call-count。
 * ⚠️ Enemy chase→charge 的 canReachTarget 閘整合需 boot 狀態機（entity 層）— 見末段評估，不補。
 */

const ENEMY = { x: 0, y: 0 };
const FACE_R = 1; // 面向右
const SCALE = 1;
const PR = 20; // playerRadius(px)

function circleAtk(over: Partial<AttackData> = {}): AttackData {
  return { shapeType: 'circle', radius: 1, offsetX: 1, offsetY: 0, damage: 5, hitDelay: 0, knockback: 0, ...over };
}
function fanAtk(over: Partial<AttackData> = {}): AttackData {
  return { shapeType: 'fan', radius: 2, angle: 60, offsetX: 0, offsetY: 0, damage: 5, hitDelay: 0, knockback: 0, ...over };
}
function rectAtk(over: Partial<AttackData> = {}): AttackData {
  return { shapeType: 'rectangle', length: 2, width: 1, offsetX: 1, offsetY: 0, damage: 5, hitDelay: 0, knockback: 0, ...over };
}

describe('isPlayerInEnemyAttackShape — 圓形', () => {
  it('圓形：玩家圓心距攻擊圓心 <= radius+playerRadius → true', () => {
    // circle offsetX1/radius1、scale1 → 中心(100,0)、半徑100px。玩家(150,0)距中心50 <= 100+20 → true。
    const atk = circleAtk({ offsetX: 1, radius: 1 });
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 150, y: 0 }, PR)).toBe(true);
  });

  it('圓形：超出 radius+playerRadius → false', () => {
    const atk = circleAtk({ offsetX: 1, radius: 1 }); // 中心(100,0) r100
    // 玩家(250,0)距中心150 > 100+20=120 → false。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 250, y: 0 }, PR)).toBe(false);
  });

  it('圓形加了 playerRadius：邊界玩家（剛好觸邊）算中', () => {
    const atk = circleAtk({ offsetX: 1, radius: 1 }); // 中心(100,0) r100
    // 玩家中心(220,0)距中心120 = 100+20 恰好 → true（含 playerRadius 才判得到）。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 220, y: 0 }, PR)).toBe(true);
    // 略超（221）→ false。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 221, y: 0 }, PR)).toBe(false);
  });
});

describe('isPlayerInEnemyAttackShape — 扇形（距離內且角度內）', () => {
  it('扇形：距離內 + 夾角在 ±angle/2 內（正前方）→ true', () => {
    const atk = fanAtk({ radius: 2, angle: 60, offsetX: 0 }); // 半徑200px、±30°
    // 玩家正前方(100,0)：距100<=200、角0 <=30 → true。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 100, y: 0 }, PR)).toBe(true);
  });

  it('扇形：距離內但角度外（斜上超過 ±30°）→ false', () => {
    const atk = fanAtk({ radius: 2, angle: 60, offsetX: 0 });
    // 玩家(100,100)：距~141<=200,但角 45° > 30° → false。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 100, y: 100 }, PR)).toBe(false);
  });

  it('扇形：玩家在背後（面向右、玩家在左）→ false（不對背後空揮）', () => {
    const atk = fanAtk({ radius: 2, angle: 60, offsetX: 0 });
    // 面向右,玩家(-100,0)在正後方 角180° → false。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: -100, y: 0 }, PR)).toBe(false);
    // 面向左(facing=-1)時,同玩家(-100,0)變正前 → true（面向決定前後）。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, -1, SCALE, { x: -100, y: 0 }, PR)).toBe(true);
  });
});

describe('isPlayerInEnemyAttackShape — 矩形/OBB', () => {
  it('矩形：玩家投影在 width×length 內 → true；軸外 → false', () => {
    // rect length2/width1 offsetX1 scale1 → 中心(100,0)、沿面向長200(±100)、寬100(±50)。
    const atk = rectAtk({ length: 2, width: 1, offsetX: 1 });
    // 玩家(100,0)在中心 → true。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 100, y: 0 }, PR)).toBe(true);
    // 玩家(100,200)遠超寬半50+playerRadius20 → 軸外 false。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 100, y: 200 }, PR)).toBe(false);
  });
});

describe('isPlayerInEnemyAttackShape — #2 根治空揮核心契約', () => {
  it('attackRange 內但攻擊形狀外 → false（粗篩過、形狀確認擋下空揮）', () => {
    // 短圓：offsetX0.5/radius0.4 scale1 → 中心(50,0)、半徑40px。
    const atk = circleAtk({ offsetX: 0.5, radius: 0.4 });
    // 玩家(200,0)：距形狀中心150 > 40+20=60 → 形狀外 false（即使敵人 attackRange 粗篩可能 dist<=range）。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 200, y: 0 }, PR)).toBe(false);
    // 逼近到 (90,0)：距中心40 <= 60 → 進形狀 true（逼近後才該揮）。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 90, y: 0 }, PR)).toBe(true);
  });

  it('與實際命中同基準：isPlayerInEnemyAttackShape ≡ buildAttackCircle + circleIntersectsCircle（圓）', () => {
    const atk = circleAtk({ offsetX: 1, radius: 1 });
    const player = { x: 180, y: 30 };
    // 直接用實際命中判定那套算一次。
    const circle = buildAttackCircle(atk, ENEMY, FACE_R, SCALE);
    const viaHit = circleIntersectsCircle(circle, player, PR);
    // isPlayerInEnemyAttackShape 應完全相同（沒另寫一套判定）。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, player, PR)).toBe(viaHit);
  });

  it('scale 放大攻擊形狀：同玩家在小 scale 外、大 scale 內（形狀隨 scale×PPU）', () => {
    const atk = circleAtk({ offsetX: 1, radius: 1 }); // 中心 offsetX1×scale×PPU、半徑1×scale×PPU
    const player = { x: 300, y: 0 };
    // scale1：中心(100,0) r100 → 距200 > 120 → false。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, 1, player, PR)).toBe(false);
    // scale3：中心(300,0) r300 → 玩家在中心 → true。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, 3, player, PR)).toBe(true);
  });
});
