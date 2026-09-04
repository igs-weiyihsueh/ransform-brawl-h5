/**
 * hitDetection 單元測試 — QA（測騎）維護。純幾何、零 Phaser。
 *
 * 涵蓋邊界（誠實說明）：
 *   ✅ 證明 obbIntersectsCircle / circleIntersectsCircle / queryHits* /
 *      buildAttackOBB / buildAttackCircle 這些【純幾何函式】的數學正確性,
 *      特別是邊界:貼邊接觸、角(corner)接觸、on-radius、退化(零尺寸)、
 *      以及【旋轉過的 OBB】命中。
 *   ❌ 不證明遊戲裡「實際打擊命中的體驗/手感」,不證明 hitDelay 時序、
 *      擊退、傷害結算 —— 那些牽涉 runtime/Phaser,需 boot smoke / E2E。
 *   ❌ 不證明 AttackData JSON 被正確載入(那是別的模組責任)。
 *
 * 撰寫策略(針對顧問警告「幾何最容易測成空氣」):
 *   - 不只測「明顯中/明顯不中」。每個關鍵邊界都放【剛好在邊界】+【差一點點】兩側,
 *     讓 <= 改 < 這種細改會被 on-edge/on-radius case 抓到。
 *   - 旋轉 OBB 用手工建構(buildAttackOBB 只產生 0 / π,無法測任意角度),
 *     直接對 obbIntersectsCircle 餵入 rotation=π/2、π/4 等,證明「拿掉旋轉那一步」
 *     或「旋轉正負號翻掉」會讓對應 case 變紅。
 */

import { describe, it, expect } from 'vitest';
import {
  obbIntersectsCircle,
  circleIntersectsCircle,
  queryHits,
  queryHitsCircle,
  buildAttackOBB,
  buildAttackCircle,
  type OBB,
  type AttackCircle,
  type Hittable,
  type Vec2,
} from '../src/systems/hitDetection';
import type { AttackData } from '../src/systems/AttackData';
import { PPU } from '../src/config/gameConfig';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 建一個軸對齊 OBB(rotation=0)。中心預設原點。 */
function axisOBB(
  halfLength: number,
  halfWidth: number,
  center: Vec2 = { x: 0, y: 0 },
): OBB {
  return { center, halfLength, halfWidth, rotation: 0 };
}

/** 建一個可命中的 Hittable。 */
function hittable(center: Vec2, radius: number): Hittable {
  return { getHitCenter: () => center, getHitRadius: () => radius };
}

/** 一份合法的 rectangle AttackData(單位 unit)。 */
function rectAttack(over: Partial<AttackData> = {}): AttackData {
  return {
    shapeType: 'rectangle',
    length: 2, // unit
    width: 1, // unit
    offsetX: 1, // unit,沿面向
    offsetY: 0,
    damage: 10,
    hitDelay: 0,
    knockback: 0,
    ...over,
  };
}

/** 一份合法的 circle AttackData(單位 unit)。 */
function circleAttack(over: Partial<AttackData> = {}): AttackData {
  return {
    shapeType: 'circle',
    radius: 1, // unit
    offsetX: 1,
    offsetY: 0,
    damage: 10,
    hitDelay: 0,
    knockback: 0,
    ...over,
  };
}

// ===========================================================================
// obbIntersectsCircle — 軸對齊基本 + 邊界
// ===========================================================================

describe('obbIntersectsCircle — 軸對齊:明顯中/明顯不中(粗略對照)', () => {
  const obb = axisOBB(2, 1); // 中心原點,x:[-2,2] y:[-1,1]

  it('圓心在框內 → 命中', () => {
    expect(obbIntersectsCircle(obb, { x: 0, y: 0 }, 0.5)).toBe(true);
  });

  it('圓遠在外側、半徑碰不到 → 落空', () => {
    expect(obbIntersectsCircle(obb, { x: 100, y: 100 }, 1)).toBe(false);
  });
});

describe('obbIntersectsCircle — 貼邊接觸邊界(釘住 <= 語意)', () => {
  const obb = axisOBB(2, 1);

  it('圓剛好貼右邊(最近點距=半徑)→ 命中(on-edge,含邊界)', () => {
    // 最近點(2,0),圓心(3,0),距=1,radius=1 → 1<=1 命中
    expect(obbIntersectsCircle(obb, { x: 3, y: 0 }, 1)).toBe(true);
  });

  it('圓差一點點碰不到右邊(距 > 半徑)→ 落空', () => {
    // 距=1.0001 > 1 → 落空。與上一條形成 <= 的兩側對照
    expect(obbIntersectsCircle(obb, { x: 3.0001, y: 0 }, 1)).toBe(false);
  });

  it('圓貼上邊(y 方向 on-edge)→ 命中', () => {
    // 最近點(0,1),圓心(0,2),距=1 → 命中
    expect(obbIntersectsCircle(obb, { x: 0, y: 2 }, 1)).toBe(true);
  });
});

describe('obbIntersectsCircle — 角(corner)接觸邊界', () => {
  const obb = axisOBB(2, 1); // 角在 (±2, ±1)

  it('圓剛好在角上(對角線距=半徑)→ 命中', () => {
    // 角(2,1),圓心(2+1,1+1)=(3,2),對角距=√2,radius=√2 → 命中(on-corner)
    const r = Math.SQRT2;
    expect(obbIntersectsCircle(obb, { x: 3, y: 2 }, r)).toBe(true);
  });

  it('圓在角外差一點(對角距 > 半徑)→ 落空', () => {
    // 同上位置但半徑略小於 √2 → 落空
    const r = Math.SQRT2 - 1e-6;
    expect(obbIntersectsCircle(obb, { x: 3, y: 2 }, r)).toBe(false);
  });

  it('角外側 45 度方向,半徑略大於對角距 → 命中', () => {
    const r = Math.SQRT2 + 1e-6;
    expect(obbIntersectsCircle(obb, { x: 3, y: 2 }, r)).toBe(true);
  });
});

describe('obbIntersectsCircle — 退化/零尺寸形狀', () => {
  it('OBB 退化成一點(half=0)→ 等價點對圓:圓涵蓋原點才中', () => {
    const point = axisOBB(0, 0);
    // 圓心(0.5,0) 半徑 0.5 → 最近點(0,0),距=0.5=r → 命中(on-radius)
    expect(obbIntersectsCircle(point, { x: 0.5, y: 0 }, 0.5)).toBe(true);
    // 半徑略小 → 落空
    expect(obbIntersectsCircle(point, { x: 0.5, y: 0 }, 0.5 - 1e-6)).toBe(false);
  });

  it('圓半徑=0(退化成點):點落在框內 → 命中;框外 → 落空', () => {
    const obb = axisOBB(2, 1);
    expect(obbIntersectsCircle(obb, { x: 1, y: 0 }, 0)).toBe(true);
    expect(obbIntersectsCircle(obb, { x: 2.0001, y: 0 }, 0)).toBe(false);
  });

  it('OBB 退化成線段(halfWidth=0):線上 on-edge 命中', () => {
    const seg = axisOBB(2, 0); // x:[-2,2], y=0 的線段
    // 圓心(0,1) 半徑1 → 最近點(0,0) 距=1=r → 命中
    expect(obbIntersectsCircle(seg, { x: 0, y: 1 }, 1)).toBe(true);
    expect(obbIntersectsCircle(seg, { x: 0, y: 1 }, 1 - 1e-6)).toBe(false);
  });
});

// ===========================================================================
// obbIntersectsCircle — 【旋轉 OBB】(顧問重點:別只測軸對齊)
// ===========================================================================

describe('obbIntersectsCircle — 旋轉 OBB(90 度)', () => {
  // rotation=π/2:local x(長邊,half=2)轉去對齊【世界 y】;local y(half=1)對齊世界 x。
  const obb: OBB = { center: { x: 0, y: 0 }, halfLength: 2, halfWidth: 1, rotation: Math.PI / 2 };

  it('沿世界 y 方向 on-edge(用到長邊 half=2)→ 命中', () => {
    // 世界(0,3):旋轉後 localX=3 → clamp 到 2,距=1=r → 命中。
    // 若「拿掉旋轉那步」把它當軸對齊,y 方向只有 halfWidth=1,(0,3) 距=2-? 會落空 → 鑑別點
    expect(obbIntersectsCircle(obb, { x: 0, y: 3 }, 1)).toBe(true);
  });

  it('沿世界 y 差一點點 → 落空(on-edge 另一側)', () => {
    expect(obbIntersectsCircle(obb, { x: 0, y: 3.0001 }, 1)).toBe(false);
  });

  it('沿世界 x 方向只有短邊(half=1):(2,0) on-edge → 命中', () => {
    // localY = 2(旋轉後),clamp 到 1,距=1=r → 命中
    expect(obbIntersectsCircle(obb, { x: 2, y: 0 }, 1)).toBe(true);
  });

  it('沿世界 x 稍遠 → 落空', () => {
    expect(obbIntersectsCircle(obb, { x: 2.5, y: 0 }, 1)).toBe(false);
  });
});

describe('obbIntersectsCircle — 旋轉 OBB(45 度,鑑別旋轉正負號)', () => {
  // rotation=π/4。長邊 half=3 沿 (cos45, sin45) 方向,短邊 half=0.5。
  const obb: OBB = {
    center: { x: 0, y: 0 },
    halfLength: 3,
    halfWidth: 0.5,
    rotation: Math.PI / 4,
  };

  it('沿長邊方向(第一象限對角線)遠處仍命中(長邊夠長)', () => {
    // (2,2):投影到 localX ≈ 2.828 < 3(在長邊內),localY ≈ 0 → 命中。
    expect(obbIntersectsCircle(obb, { x: 2, y: 2 }, 0.2)).toBe(true);
  });

  it('沿【反】對角線(第四象限)同距離 → 落空(證明方向敏感,非對稱)', () => {
    // (2,-2):正確旋轉下 localY ≈ 2.828 遠超短邊 0.5 → 落空
    expect(obbIntersectsCircle(obb, { x: 2, y: -2 }, 0.2)).toBe(false);
  });

  it('垂直長邊(短邊很薄)方向 on-edge 附近:貼邊命中/差一點落空', () => {
    // 沿短邊法線(−sin45, cos45)=(−0.707,0.707) 距離 0.5 處為 on-edge。
    // 取圓心在該法線 0.5+r 外緣:圓心 = 0.5*n,半徑=r → 最近點在邊上,距=0.5-0.5=0? 用簡潔構造:
    const n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }; // 單位法線
    const onEdge = { x: n.x * (0.5 + 1), y: n.y * (0.5 + 1) }; // 邊外 1 單位,半徑1 → on-edge
    expect(obbIntersectsCircle(obb, onEdge, 1)).toBe(true);
    expect(obbIntersectsCircle(obb, onEdge, 1 - 1e-6)).toBe(false);
  });
});

describe('obbIntersectsCircle — 旋轉正負號【定向鑑別】(專抓 local 座標翻號)', () => {
  // 專為「dx*cos - dy*sin 的正負號被翻成 +」設計的鑑別 case。
  // 用「短邊沿 local x(half=0.5)、長邊沿 local y(half=3)」、rotation=π/4 的薄框:
  // 命中與否由 localX(受翻號影響那一項)是否超出 halfLength 決定。
  const thin: OBB = {
    center: { x: 0, y: 0 },
    halfLength: 0.5, // local x 很短
    halfWidth: 3, // local y 很長
    rotation: Math.PI / 4,
  };

  it('正確旋轉下 (2,2) 的 localX≈2.83 超出短邊 → 落空', () => {
    // 正確: localX = 0.7071*(dx+dy)=0.7071*4≈2.83 > 0.5 → 落空。
    // 若把 localX 的 −dy*sin 翻成 +dy*sin: localX = 0.7071*(dx−dy)=0 → 落到框內變【命中】。
    // 故此條在翻號版會由 false 變 true → 紅,精準抓翻號。
    expect(obbIntersectsCircle(thin, { x: 2, y: 2 }, 0.2)).toBe(false);
  });

  it('正確旋轉下 (2,-2) 的 localX≈0 落在短邊內、localY≈−2.83 clamp 後距≈? → 命中對照', () => {
    // 正確: localX = 0.7071*(2−2)=0(框內), localY = 0.7071*(−2−2)=−2.83 → clamp 到 −3? 不,
    // halfWidth=3 → clamp(−2.83,−3,3)=−2.83(仍在框內) → 最近點=自身 → 距 0 → 命中。
    // 這條在正確版命中;與上一條(2,2)落空形成【定向對照】:證明 localX 的號決定命中,不是對稱亂猜。
    expect(obbIntersectsCircle(thin, { x: 2, y: -2 }, 0.2)).toBe(true);
  });
});

// ===========================================================================
// circleIntersectsCircle — 圓對圓 + on-radius 邊界
// ===========================================================================

describe('circleIntersectsCircle — 基本 + on-radius 邊界(釘住 <= 語意)', () => {
  const atk: AttackCircle = { center: { x: 0, y: 0 }, radius: 2 };

  it('兩圓重疊 → 命中', () => {
    expect(circleIntersectsCircle(atk, { x: 1, y: 0 }, 1)).toBe(true);
  });

  it('兩圓剛好外切(圓心距 = 半徑和)→ 命中(on-radius,含邊界)', () => {
    // 半徑和=2+1=3。圓心距=3 → 命中
    expect(circleIntersectsCircle(atk, { x: 3, y: 0 }, 1)).toBe(true);
  });

  it('兩圓差一點點沒接觸(圓心距 > 半徑和)→ 落空', () => {
    expect(circleIntersectsCircle(atk, { x: 3.0001, y: 0 }, 1)).toBe(false);
  });

  it('on-radius 斜向(3-4-5)剛好外切 → 命中', () => {
    // 半徑和=3。圓心距(3,4)? 那是5。改:半徑和設為5:atk r=4,target r=1,距(3,4)=5 → 命中
    const a2: AttackCircle = { center: { x: 0, y: 0 }, radius: 4 };
    expect(circleIntersectsCircle(a2, { x: 3, y: 4 }, 1)).toBe(true);
    expect(circleIntersectsCircle(a2, { x: 3, y: 4 }, 1 - 1e-6)).toBe(false);
  });

  it('退化:攻擊圓半徑=0,只有目標半徑覆蓋圓心才中', () => {
    const zero: AttackCircle = { center: { x: 0, y: 0 }, radius: 0 };
    expect(circleIntersectsCircle(zero, { x: 1, y: 0 }, 1)).toBe(true); // on-radius
    expect(circleIntersectsCircle(zero, { x: 1, y: 0 }, 1 - 1e-6)).toBe(false);
  });
});

// ===========================================================================
// queryHits / queryHitsCircle — 多目標查詢
// ===========================================================================

describe('queryHits(OBB)— 多目標命中查詢', () => {
  const obb = axisOBB(2, 1);

  it('只回傳落在框內/貼邊的目標,遠處排除', () => {
    const inside = hittable({ x: 0, y: 0 }, 0.5);
    const onEdge = hittable({ x: 3, y: 0 }, 1); // on-edge 命中
    const far = hittable({ x: 100, y: 0 }, 1);
    const hits = queryHits(obb, [inside, onEdge, far]);
    expect(hits).toContain(inside);
    expect(hits).toContain(onEdge);
    expect(hits).not.toContain(far);
    expect(hits).toHaveLength(2);
  });

  it('無目標命中 → 空陣列', () => {
    expect(queryHits(obb, [hittable({ x: 50, y: 50 }, 1)])).toHaveLength(0);
  });
});

describe('queryHitsCircle — 多目標命中查詢', () => {
  const circle: AttackCircle = { center: { x: 0, y: 0 }, radius: 2 };

  it('回傳重疊/外切目標,遠處排除', () => {
    const overlap = hittable({ x: 1, y: 0 }, 1);
    const tangent = hittable({ x: 3, y: 0 }, 1); // on-radius
    const far = hittable({ x: 100, y: 0 }, 1);
    const hits = queryHitsCircle(circle, [overlap, tangent, far]);
    expect(hits).toHaveLength(2);
    expect(hits).not.toContain(far);
  });
});

// ===========================================================================
// buildAttackOBB / buildAttackCircle — 建構(面向、offset、scale、PPU)
// ===========================================================================

describe('buildAttackOBB — 中心/尺寸/面向換算', () => {
  it('面右:中心 = pos + offsetX*scale*PPU,半長=length*scale*PPU/2', () => {
    const obb = buildAttackOBB(rectAttack(), { x: 100, y: 50 }, +1, 1);
    expect(obb.center.x).toBeCloseTo(100 + 1 * 1 * PPU); // 200
    expect(obb.center.y).toBeCloseTo(50);
    expect(obb.halfLength).toBeCloseTo((2 * 1 * PPU) / 2); // 100
    expect(obb.halfWidth).toBeCloseTo((1 * 1 * PPU) / 2); // 50
    expect(obb.rotation).toBeCloseTo(0);
  });

  it('面左:offsetX 往左,rotation=π', () => {
    const obb = buildAttackOBB(rectAttack(), { x: 100, y: 50 }, -1, 1);
    expect(obb.center.x).toBeCloseTo(100 - 1 * 1 * PPU); // 0
    expect(obb.rotation).toBeCloseTo(Math.PI);
  });

  it('scale 放大 → 中心偏移與半長同比例放大', () => {
    const obb = buildAttackOBB(rectAttack(), { x: 0, y: 0 }, +1, 2);
    expect(obb.center.x).toBeCloseTo(1 * 2 * PPU); // 200
    expect(obb.halfLength).toBeCloseTo((2 * 2 * PPU) / 2); // 200
  });

  it('length/width 缺(undefined)→ 視為 0(退化框)', () => {
    const obb = buildAttackOBB(
      rectAttack({ length: undefined, width: undefined }),
      { x: 0, y: 0 },
      +1,
      1,
    );
    expect(obb.halfLength).toBe(0);
    expect(obb.halfWidth).toBe(0);
  });

  it('建構後接命中:面右框貼邊命中一致', () => {
    // pos(0,0) offsetX=1 scale=1 → 中心(100,0),halfLength=100,halfWidth=50
    const obb = buildAttackOBB(rectAttack(), { x: 0, y: 0 }, +1, 1);
    // 右邊界 x=200,圓心(300,0) 半徑100 → on-edge 命中
    expect(obbIntersectsCircle(obb, { x: 300, y: 0 }, 100)).toBe(true);
    expect(obbIntersectsCircle(obb, { x: 300.01, y: 0 }, 100)).toBe(false);
  });
});

describe('buildAttackCircle — 中心/半徑換算', () => {
  it('面右:中心與半徑正確換算(× scale × PPU)', () => {
    const c = buildAttackCircle(circleAttack(), { x: 10, y: 20 }, +1, 1);
    expect(c.center.x).toBeCloseTo(10 + 1 * 1 * PPU); // 110
    expect(c.center.y).toBeCloseTo(20);
    expect(c.radius).toBeCloseTo(1 * 1 * PPU); // 100
  });

  it('面左:offsetX 往左', () => {
    const c = buildAttackCircle(circleAttack(), { x: 10, y: 20 }, -1, 1);
    expect(c.center.x).toBeCloseTo(10 - 1 * 1 * PPU); // -90
  });

  it('radius 缺 → 0(退化圓)', () => {
    const c = buildAttackCircle(circleAttack({ radius: undefined }), { x: 0, y: 0 }, +1, 1);
    expect(c.radius).toBe(0);
  });
});
