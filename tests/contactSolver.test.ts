// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  solveContacts,
  paceMove,
  pushPairKey,
  overlapAgentsToContactBodies,
  DEFAULT_CONTACT_SOLVER_PARAMS,
  type ContactBody,
} from '@/systems/contactSolver';

/**
 * contactSolver TS 移植【草案】行為驗證（對照 Unity ContactSolver，蟲騎 review 用）。
 * 斷言 5 點避雷：質量分攤/無限質量牆/count>1 平均/relaxation 鬆弛/early-out/pushPairs 消費/paceMove 削分量。
 */
const P = { jacobiRelaxation: 1, contactSlop: 0 }; // 測純幾何時關鬆弛/slop（隔離）
let _id = 0;
function body(x: number, y: number, r: number, mass: number, canBePushed = true): ContactBody {
  return { id: `b${_id++}`, x, y, radius: r, mass, canBePushed };
}

describe('solveContacts — Compute+Apply', () => {
  it('兩等質量重疊 → 各推一半（對稱、沿連線分開）', () => {
    // i=(0,0) j=(30,0)，r=20 各 → minDist40 dist30 corrected10 → 各 mB/sum=0.5 → 各 5，i 往 -x、j 往 +x。
    const { positions } = solveContacts([body(0, 0, 20, 1), body(30, 0, 20, 1)], new Set(), P);
    expect(positions[0].x).toBeCloseTo(-5);
    expect(positions[1].x).toBeCloseTo(35);
  });

  it('★(乙)貼地圓盤：縱深(垂直)方向要更近才接觸（dy/squash）＝橢圓判定，垂直重疊比水平淺', () => {
    // 水平：i(0,0) j(30,0) r20 → dist30 < minDist40 → 重疊推開（同上：各推 5）。
    const horiz = solveContacts([body(0, 0, 20, 1), body(30, 0, 20, 1)], new Set(), P);
    expect(Math.abs(horiz.positions[0].x)).toBeGreaterThan(0); // 水平 30px 有推
    // 垂直：i(0,0) j(0,30) r20——螢幕 dy=30 但地面 dyG=30/0.5=60 → groundDist=60 > minDist40 → ★不接觸、不推。
    const vert = solveContacts([body(0, 0, 20, 1), body(0, 30, 20, 1)], new Set(), P);
    expect(vert.positions[0].y).toBeCloseTo(0); // 垂直 30px 貼地還原後夠遠→不推
    expect(vert.positions[1].y).toBeCloseTo(30);
    // ＝同樣螢幕 30px，水平推、垂直不推＝貼地橢圓（縱深要更近才接觸），跟視覺貼地圓盤一致。
  });

  it('★質量分攤：重的推得少（i 重 3、j 輕 1 → i 分 mB/sum=1/4、j 分 mA/sum=3/4）', () => {
    const { positions } = solveContacts([body(0, 0, 20, 3), body(30, 0, 20, 1)], new Set(), P);
    // corrected=10；i 位移 10×(1/4)=2.5(往-x)、j 10×(3/4)=7.5(往+x)。
    expect(positions[0].x).toBeCloseTo(-2.5);
    expect(positions[1].x).toBeCloseTo(37.5);
  });

  it('★無限質量牆（j canBePushed=false）→ i 吃全部、j 不動', () => {
    const { positions } = solveContacts([body(0, 0, 20, 1), body(30, 0, 20, 1, false)], new Set(), P);
    expect(positions[0].x).toBeCloseTo(-10); // 全量 corrected
    expect(positions[1].x).toBeCloseTo(30); // 牆不動
  });

  it('★count>1 平均：被兩隻夾（左右各推）→ 位移取平均不加總彈飛', () => {
    // 中間 i=(0,0)，左 j=(-30,0)、右 k=(30,0)，r20 各。i 對 j 得 +? 對 k 得 -?，count=2 → 平均。
    const { positions } = solveContacts(
      [body(0, 0, 20, 1), body(-30, 0, 20, 1), body(30, 0, 20, 1)],
      new Set(), P,
    );
    // i 對 j(左)：dir=(0-(-30))=+x → i +5；對 k(右)：dir=(0-30)=-x → i -5。加總 0，count2 平均仍 0 → i 幾乎不動（左右抵消）。
    expect(positions[0].x).toBeCloseTo(0);
    // j/k 各被 i 推開 5（各自 count1）。
    expect(positions[1].x).toBeCloseTo(-35);
    expect(positions[2].x).toBeCloseTo(35);
  });

  it('★非對稱夾（左兩右一）：向量和→除 count（非逐 pair 平均），蟲騎 review 確認機制', () => {
    // 中間 i=(0,0)；左 j=(-30,0)、k=(-31,0) 都推 i 往+x；右 l=(30,0) 推 i 往-x。r20 各、等質量各半。
    // i 對 j: 重疊10→+x各半+5；對 k: 重疊9→+4.5；對 l: 重疊10→-5。向量和=+4.5；count=3→/3=1.5。
    // ★關鍵：向量和(+4.5)再除 count(3)=1.5，非逐 pair 平均。
    const { positions } = solveContacts(
      [body(0, 0, 20, 1), body(-30, 0, 20, 1), body(-31, 0, 20, 1), body(30, 0, 20, 1)],
      new Set(), P,
    );
    expect(positions[0].x).toBeCloseTo(1.5); // 被左邊兩隻淨推向右
  });

  it('★relaxation=0.5 → 位移減半', () => {
    const { positions } = solveContacts([body(0, 0, 20, 1), body(30, 0, 20, 1)], new Set(),
      { jacobiRelaxation: 0.5, contactSlop: 0 });
    expect(positions[0].x).toBeCloseTo(-2.5); // 原 -5 × 0.5
    expect(positions[1].x).toBeCloseTo(32.5);
  });

  it('★contactSlop 容忍微量重疊 → 淺重疊在容忍內不推', () => {
    // dist38、minDist40 → 重疊2；slop=3 → corrected=40-38-3=-1<=0 → 不推。
    const { positions } = solveContacts([body(0, 0, 20, 1), body(38, 0, 20, 1)], new Set(),
      { jacobiRelaxation: 1, contactSlop: 3 });
    expect(positions[0].x).toBeCloseTo(0);
    expect(positions[1].x).toBeCloseTo(38);
  });

  it('early-out：未重疊(dist>=minDist) 不動', () => {
    const { positions } = solveContacts([body(0, 0, 20, 1), body(100, 0, 20, 1)], new Set(), P);
    expect(positions[0].x).toBeCloseTo(0);
    expect(positions[1].x).toBeCloseTo(100);
  });

  it('★pushPairs：i 已推 j（i>j 在 set）→ 整段給 j、i 不被修正', () => {
    const bi = body(0, 0, 20, 1), bj = body(30, 0, 20, 1);
    const pairs = new Set([pushPairKey(bi.id, bj.id)]); // i pushing j
    const { positions } = solveContacts([bi, bj], pairs, P);
    expect(positions[0].x).toBeCloseTo(0); // i(推方)不動
    expect(positions[1].x).toBeCloseTo(40); // j 吃整段 corrected 10（往+x）
  });
});

describe('paceMove — 速度層預減速', () => {
  it('朝可推 body 前進、本幀會撞進接觸 → 削掉超出質量份額的接近分量 + 記 pushPair', () => {
    // self=(0,0) r20 mass1、body=(50,0) r20 mass1；desiredMove=(20,0) 朝右。
    // dist50 contactDist40 free10；approach20>free10 → 夾。share=self/sum=0.5；allowed=10+(20-10)×0.5=15；cut=5。
    const bs = body(0, 0, 20, 1), bo = body(50, 0, 20, 1);
    const bodies: ContactBody[] = [bs, bo];
    const { move, pushPairs } = paceMove(bs, { x: 20, y: 0 }, bodies, { jacobiRelaxation: 0.5, contactSlop: 0 });
    expect(move.x).toBeCloseTo(15); // 20 - 5
    expect(pushPairs).toContain(pushPairKey(bs.id, bo.id));
  });

  it('對手無限質量 → shareFraction=0 完全推不動（削到只走到接觸面）', () => {
    const bs = body(0, 0, 20, 1), bo = body(50, 0, 20, 1, false);
    const { move, pushPairs } = paceMove(bs, { x: 20, y: 0 }, [bs, bo], { jacobiRelaxation: 0.5, contactSlop: 0 });
    expect(move.x).toBeCloseTo(10); // 只能走 free=10（allowed=free）
    expect(pushPairs).toHaveLength(0); // 不可推 → 不記 pair
  });

  it('遠離該 body（approach<=0）→ 不夾', () => {
    const bs = body(0, 0, 20, 1), bo = body(50, 0, 20, 1);
    const { move } = paceMove(bs, { x: -20, y: 0 }, [bs, bo], { jacobiRelaxation: 0.5, contactSlop: 0 });
    expect(move.x).toBeCloseTo(-20); // 往左遠離 → 不動
  });

  it('self 不在 bodies → 不夾（active-set 成員才參與）', () => {
    const outsider = body(0, 0, 20, 1);
    const { move } = paceMove(outsider, { x: 20, y: 0 }, [body(999, 999, 20, 1)], DEFAULT_CONTACT_SOLVER_PARAMS);
    expect(move.x).toBe(20);
  });
});

describe('overlapAgentsToContactBodies — 接線適配器（EnemySpawner overlapAgent → ContactBody）', () => {
  it('mass=半徑（大怪重小怪輕）、canBePushed=movable、id 沿用', () => {
    const bodies = overlapAgentsToContactBodies([
      { id: '1', x: 0, y: 0, radius: 30, movable: true },
      { id: '2', x: 50, y: 0, radius: 10, movable: false },
    ]);
    expect(bodies[0]).toEqual({ id: '1', x: 0, y: 0, radius: 30, mass: 30, canBePushed: true });
    expect(bodies[1]).toEqual({ id: '2', x: 50, y: 0, radius: 10, mass: 10, canBePushed: false });
  });

  it('radius 0（grabber/dead 跳過者）→ mass 0（solveContacts 早退不動它）', () => {
    const bodies = overlapAgentsToContactBodies([{ id: '9', x: 0, y: 0, radius: 0, movable: false }]);
    expect(bodies[0].mass).toBe(0);
    expect(bodies[0].radius).toBe(0);
  });

  it('★接線整合：大怪(重)vs小怪(輕)重疊 → 小怪被推多、大怪被推少（質量分攤）', () => {
    // 大怪 r30 mass30 at (0,0)、小怪 r10 mass10 at (35,0)。minDist=40、dist=35、重疊 5。
    // 分攤：大怪吃 mB/sum=10/40=0.25 → 位移少；小怪吃 mA/sum=30/40=0.75 → 位移多。
    const bodies = overlapAgentsToContactBodies([
      { id: 'big', x: 0, y: 0, radius: 30, movable: true },
      { id: 'small', x: 35, y: 0, radius: 10, movable: true },
    ]);
    const { positions } = solveContacts(bodies, new Set(), { jacobiRelaxation: 1, contactSlop: 0 });
    const bigMove = Math.abs(positions[0].x - 0);
    const smallMove = Math.abs(positions[1].x - 35);
    expect(smallMove).toBeGreaterThan(bigMove); // 輕的被推多
    expect(bigMove).toBeCloseTo(5 * 0.25); // 大怪往-x 推 1.25
    expect(smallMove).toBeCloseTo(5 * 0.75); // 小怪往+x 推 3.75
  });

  it('★接線整合：不可推怪(攻擊中菁英/牆)當無限質量 → 自己不動、對手吃全段', () => {
    const bodies = overlapAgentsToContactBodies([
      { id: 'wall', x: 0, y: 0, radius: 30, movable: false }, // 無限質量
      { id: 'mob', x: 55, y: 0, radius: 30, movable: true },
    ]);
    const { positions } = solveContacts(bodies, new Set(), { jacobiRelaxation: 1, contactSlop: 0 });
    expect(positions[0].x).toBeCloseTo(0); // 牆不動
    expect(positions[1].x).toBeCloseTo(60); // mob 吃全段 corrected 5（60-30-30=0 接觸）
  });
});
