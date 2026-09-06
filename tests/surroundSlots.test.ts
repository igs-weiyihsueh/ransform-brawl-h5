// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  layerRadius,
  slotCountForLayer,
  slotWorldPos,
  chooseNearestSlot,
  tryClaimInnerSlot,
  slotApproachDir,
  encodeSlotId,
  decodeSlotId,
  DEFAULT_SURROUND_PARAMS,
  type SurroundParams,
} from '@/systems/surroundSlots';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * surroundSlots — 槽位同心圓環繞純幾何/選擇（六輪 surround，征騎 c5aab6e，移植 Unity SurroundSlotManager）。
 * 怪物圍角色成同心圓：同心多層×每層等弧長槽位；敵人 claim 最近空槽(內層優先/同層最近)→繞圈到槽。
 * 維度3 斷座標/選擇值。含壞版必紅（內層優先/同層最近/只往內遞補/外層槽多/菁英外圈）。
 * ⚠️ SurroundSlotManager(佔用表狀態)+Enemy 槽位感知移動+coordinateSurround 每幀協調屬狀態機(需 boot,
 *    翼騎 headless 內圈勻分/菁英外層/subagent 看圖驗)、adapter 接線——不補;surroundSlots.ts 純函式補足。
 */
const P: SurroundParams = { baseRadius: 80, layerSpacing: 60, slotArc: 60, maxLayers: 5 };
const C: Vec2 = { x: 1000, y: 500 }; // ring center
const occ = (...ids: number[]) => new Set<number>(ids);

describe('layerRadius / slotCountForLayer — 同心層幾何', () => {
  it('layerRadius = baseRadius + layer×layerSpacing（各層遞增）', () => {
    expect(layerRadius(0, P)).toBe(80);
    expect(layerRadius(1, P)).toBe(140);
    expect(layerRadius(2, P)).toBe(200);
    expect(layerRadius(1, P)).toBeGreaterThan(layerRadius(0, P));
  });

  it('★ slotCountForLayer = max(1, floor(2π×r/slotArc))：外層槽多（周長大），layer0 至少 1', () => {
    // layer0: 2π×80/60 ≈ 8.37 → 8;layer1: 2π×140/60 ≈ 14.66 → 14。
    expect(slotCountForLayer(0, P)).toBe(8);
    expect(slotCountForLayer(1, P)).toBe(14);
    expect(slotCountForLayer(2, P)).toBeGreaterThan(slotCountForLayer(1, P)); // 越外越多
    // 極小半徑仍至少 1。
    expect(slotCountForLayer(0, { ...P, baseRadius: 1, slotArc: 9999 })).toBe(1);
  });
});

describe('slotWorldPos — 槽世界座標（index0 在 0°、繞中心）', () => {
  it('index0 → ringCenter + (r, 0)（0° = +x 方向）', () => {
    const p = slotWorldPos(C, 0, 0, P);
    expect(p.x).toBeCloseTo(C.x + 80);
    expect(p.y).toBeCloseTo(C.y);
  });

  it('各槽離中心距離 = layerRadius（都在該層環上，均分）', () => {
    const count = slotCountForLayer(1, P);
    for (const idx of [0, 1, Math.floor(count / 2), count - 1]) {
      const p = slotWorldPos(C, 1, idx, P);
      expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(140);
    }
  });

  it('index = count/4 附近 → 約 90°（+y，H5 下）', () => {
    const count = slotCountForLayer(0, P); // 8 → index2 = 90°
    const p = slotWorldPos(C, 0, 2, P);
    expect(p.x).toBeCloseTo(C.x); // cos90≈0
    expect(p.y).toBeCloseTo(C.y + 80); // sin90=1
  });
});

describe('encode/decode slotId — 往返一致（layer×1000+index）', () => {
  it('encode(layer,index)=layer×1000+index；decode 還原', () => {
    expect(encodeSlotId(2, 5)).toBe(2005);
    expect(decodeSlotId(2005)).toEqual({ layer: 2, index: 5 });
    for (const [l, i] of [[0, 0], [1, 7], [3, 13], [4, 0]] as const) {
      expect(decodeSlotId(encodeSlotId(l, i))).toEqual({ layer: l, index: i });
    }
  });
});

describe('chooseNearestSlot — 內層優先 + 同層最近（同心圓核心）', () => {
  it('★ 內層優先：內層有空 → 回內層槽（即使外層某槽離 enemy 更近）', () => {
    // enemy 遠在外層某槽正上方，但 layer0 全空 → 必回 layer0。
    const enemy: Vec2 = { x: C.x + 300, y: C.y }; // 靠外層方向
    const id = chooseNearestSlot(enemy, C, occ(), P, 0);
    expect(decodeSlotId(id).layer).toBe(0); // 內層優先
  });

  it('★ 同層最近：layer0 多空槽 → 選離 enemy 最近那個（別繞對側）', () => {
    // enemy 在中心 +x 側遠處 → layer0 最近槽應是 index0(+x, 0°)。
    const enemy: Vec2 = { x: C.x + 500, y: C.y };
    const id = chooseNearestSlot(enemy, C, occ(), P, 0);
    expect(decodeSlotId(id)).toEqual({ layer: 0, index: 0 });
    // enemy 在 -x 側 → 最近應是對側 index（≈180°），非 index0。
    const enemyL: Vec2 = { x: C.x - 500, y: C.y };
    const idL = chooseNearestSlot(enemyL, C, occ(), P, 0);
    const posL = slotWorldPos(C, 0, decodeSlotId(idL).index, P);
    expect(posL.x).toBeLessThan(C.x); // 選到 -x 側槽，就近非繞對側
  });

  it('內層全滿 → 落到下一層', () => {
    // 佔滿 layer0 全部 8 槽 → 必回 layer1。
    const full0 = new Set<number>();
    for (let i = 0; i < slotCountForLayer(0, P); i += 1) full0.add(encodeSlotId(0, i));
    const id = chooseNearestSlot({ x: C.x + 100, y: C.y }, C, full0, P, 0);
    expect(decodeSlotId(id).layer).toBe(1);
  });

  it('全層滿 → -1', () => {
    const all = new Set<number>();
    for (let l = 0; l < P.maxLayers; l += 1)
      for (let i = 0; i < slotCountForLayer(l, P); i += 1) all.add(encodeSlotId(l, i));
    expect(chooseNearestSlot({ x: C.x, y: C.y }, C, all, P, 0)).toBe(-1);
  });

  it('★ minLayer（菁英=2）→ 不選 layer0/1（排外圈）', () => {
    const id = chooseNearestSlot({ x: C.x + 100, y: C.y }, C, occ(), P, 2);
    expect(decodeSlotId(id).layer).toBeGreaterThanOrEqual(2);
  });
});

describe('tryClaimInnerSlot — 只往更內層遞補（不外/同層、不抖動）', () => {
  it('★ 只往內：currentLayer=2、內層有空 → 回更內層（layer<2）', () => {
    const id = tryClaimInnerSlot({ x: C.x + 100, y: C.y }, C, 2, occ(), P, 0);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(decodeSlotId(id).layer).toBeLessThan(2); // 更內
  });

  it('currentLayer <= minLayer → -1（已在最內可到層，不遞補）', () => {
    expect(tryClaimInnerSlot({ x: C.x, y: C.y }, C, 0, occ(), P, 0)).toBe(-1);
    expect(tryClaimInnerSlot({ x: C.x, y: C.y }, C, 2, occ(), P, 2)).toBe(-1); // 菁英已在 minLayer2
  });

  it('★ 更內層無空 → -1（保留原槽，不往外/同層遞補）', () => {
    // 佔滿 layer0 + layer1（currentLayer=2 的所有更內層）→ 無更內空 → -1。
    const innerFull = new Set<number>();
    for (const l of [0, 1])
      for (let i = 0; i < slotCountForLayer(l, P); i += 1) innerFull.add(encodeSlotId(l, i));
    expect(tryClaimInnerSlot({ x: C.x + 100, y: C.y }, C, 2, innerFull, P, 0)).toBe(-1);
  });
});

describe('slotApproachDir — 徑向+切線繞行方向（非直穿中央）', () => {
  it('已在槽位（enemy=slotPos）→ (0,0)', () => {
    const slot = slotWorldPos(C, 0, 0, P);
    const d = slotApproachDir(slot, C, slot);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(0);
  });

  it('回傳正規化方向（長度≈1 或 0）', () => {
    const slot = slotWorldPos(C, 1, 3, P);
    const enemy: Vec2 = { x: C.x + 200, y: C.y + 50 };
    const d = slotApproachDir(enemy, C, slot);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });

  it('★ 繞行非直穿：enemy 與目標槽在對側時，方向有切線分量（不直線穿過中心）', () => {
    // enemy 在 +x 同層槽位，目標槽在 -x 對側同層 → 直穿會經過中心 C；繞行方向應偏切線(y 分量顯著)。
    const enemy = slotWorldPos(C, 1, 0, P); // +x 側
    const half = Math.floor(slotCountForLayer(1, P) / 2);
    const slot = slotWorldPos(C, 1, half, P); // ≈對側 -x
    const d = slotApproachDir(enemy, C, slot);
    // 直穿會是純 -x 方向(dy≈0)；繞行則 y 分量顯著。
    expect(Math.abs(d.y)).toBeGreaterThan(0.3);
  });

  it('同層同角度、僅半徑不同 → 純徑向（切線分量≈0）', () => {
    // enemy 在 layer2 的 index0 角度(0°)、目標 layer0 index0(也 0°) → 只需往內徑向。
    const enemy: Vec2 = { x: C.x + 200, y: C.y }; // 0° 方向、r=200
    const slot = slotWorldPos(C, 0, 0, P); // 0° 方向、r=80
    const d = slotApproachDir(enemy, C, slot);
    expect(d.y).toBeCloseTo(0); // 無切線
    expect(d.x).toBeLessThan(0); // 往內(-x，朝中心)
  });
});
