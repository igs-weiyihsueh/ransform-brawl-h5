// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildAttackCircle,
  buildAttackFan,
  circleIntersectsCircle,
  fanIntersectsCircle,
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

  it('★ #3治本：扇形攻擊判定朝 aim(玩家) → 斜上/上/下/左 玩家都 true（怪能打任意方向,decision 34b0be5b）', () => {
    const atk = fanAtk({ radius: 2, angle: 60, offsetX: 0 });
    // isPlayerInEnemyAttackShape 傳 aim=playerPos → fan 朝目標 → 目標恆在中軸(角0) → 距離內就 true。
    for (const p of [
      { x: 100, y: 100 }, // 斜上(舊 45°角外)
      { x: 0, y: 150 }, // 正下
      { x: 0, y: -150 }, // 正上（#3 用戶報的卡住方向）
      { x: -100, y: 0 }, // 正左（面右時舊為背後）
    ]) {
      expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, p, PR)).toBe(true);
    }
  });

  it('扇形：距離外仍 false（朝 aim 只解決角度,距離 gate 不變）', () => {
    const atk = fanAtk({ radius: 2, angle: 60, offsetX: 0 }); // 半徑200px
    // 玩家(0,300)距300 > 200+20 → 距離外 false（朝 aim 也搆不到）。
    expect(isPlayerInEnemyAttackShape(atk, ENEMY, FACE_R, SCALE, { x: 0, y: 300 }, PR)).toBe(false);
  });

  it('★ 相容路徑：buildAttackFan 無 aim → 水平 facing 的角度 gate 仍在（斜上45°>±30°角外 miss、背後 miss）', () => {
    // 無 aim = 舊水平 fan：保留「角度 gate」語意（與 isPlayerInEnemyAttackShape 朝 aim 分開測）。
    const atk = fanAtk({ radius: 2, angle: 60, offsetX: 0 }); // ±30°
    const fanNoAim = buildAttackFan(atk, ENEMY, FACE_R, SCALE); // 無 aim → 水平朝右
    // 正前(100,0)角0 → 命中。
    expect(fanIntersectsCircle(fanNoAim, { x: 100, y: 0 }, PR)).toBe(true);
    // 斜上(100,100)角45° > 30° → 角外 miss（水平 fan 的角度 gate 仍守）。
    expect(fanIntersectsCircle(fanNoAim, { x: 100, y: 100 }, PR)).toBe(false);
    // 背後(-100,0)角180° → miss。
    expect(fanIntersectsCircle(fanNoAim, { x: -100, y: 0 }, PR)).toBe(false);
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
