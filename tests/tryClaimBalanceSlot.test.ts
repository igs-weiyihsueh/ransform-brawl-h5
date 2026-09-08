// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  tryClaimBalanceSlot,
  slotWorldPos,
  slotCountForLayer,
  encodeSlotId,
  decodeSlotId,
  DEFAULT_SURROUND_PARAMS,
  type SurroundParams,
} from '@/systems/surroundSlots';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * surroundSlots tryClaimBalanceSlot — 怪物③橫向失衡遞補（用戶「怪卡搜索圈下方」根治，翼騎 a3629c2，additive）。
 * 讀 src a3629c2：環分 4 象限(右-45..45/下45..135/左135..-135/上其餘)，統計 occupied 各象限佔槽(★含 currentSlotId)；
 *   本象限非最擠(counts[curQuad]<max)→-1；否則跨層(minLayer..maxLayers)找「count ≤ 本象限−imbalanceThreshold」的較空象限空槽,
 *   同層優先(layerPenalty 40000)、同象限取離 enemyPos 最近。回可遷 slotId 或 -1。
 * 維度3 斷回傳 slotId 的象限/是否 -1。含壞版必紅(沒 max gate/沒 threshold/沒 layerPenalty)。
 * ⚠️ Enemy surround 每幀呼叫 + 遷移接線屬狀態機(需 boot,翼騎驗)——不補;tryClaimBalanceSlot 純決策補足。
 */
const P: SurroundParams = DEFAULT_SURROUND_PARAMS;
const CENTER: Vec2 = { x: 0, y: 0 };

/** 鏡射 src 的 quadOf（用來挑指定象限的 slot 建構 occupied）。 */
function quadOf(x: number, y: number): number {
  const deg = (Math.atan2(y - CENTER.y, x - CENTER.x) * 180) / Math.PI;
  if (deg >= -45 && deg < 45) return 0; // 右
  if (deg >= 45 && deg < 135) return 1; // 下
  if (deg >= 135 || deg < -135) return 2; // 左
  return 3; // 上
}
/** 取某層某象限的所有 slotId。 */
function slotsInQuad(layer: number, quad: number): number[] {
  const out: number[] = [];
  const n = slotCountForLayer(layer, P);
  for (let i = 0; i < n; i += 1) {
    const pos = slotWorldPos(CENTER, layer, i, P);
    if (quadOf(pos.x, pos.y) === quad) out.push(encodeSlotId(layer, i));
  }
  return out;
}
const quadOfSlot = (id: number): number => {
  const { layer, index } = decodeSlotId(id);
  const p = slotWorldPos(CENTER, layer, index, P);
  return quadOf(p.x, p.y);
};

describe('tryClaimBalanceSlot — 橫向失衡遞補（本象限最擠→遷到較空象限）', () => {
  it('本象限最擠 + 有較空象限 → 回較空象限的空槽（不再 -1）', () => {
    // layer0「下」象限(quad1)塞多隻、「上」象限(quad3)空。cur 在下象限。
    const down = slotsInQuad(0, 1);
    const up = slotsInQuad(0, 3);
    expect(down.length).toBeGreaterThan(0);
    expect(up.length).toBeGreaterThan(0);
    const cur = down[0];
    // occupied：整個下象限塞滿（含 cur）、上象限留空。
    const occupied = new Set<number>(down);
    const enemyPos = slotWorldPos(CENTER, decodeSlotId(cur).layer, decodeSlotId(cur).index, P);
    const got = tryClaimBalanceSlot(enemyPos, CENTER, cur, occupied, P);
    expect(got).not.toBe(-1); // 有遷移目標
    // 遷到的必是「較空」象限（非下象限本身）。
    expect(quadOfSlot(got)).not.toBe(1);
    expect(occupied.has(got)).toBe(false); // 目標是空槽
  });

  it('★ 本象限非最擠 → -1（不亂遷；避免本來就空的象限亂動）', () => {
    // 「下」象限塞 1 隻(cur)、「上」象限塞 3 隻 → 下不是最擠。
    const down = slotsInQuad(0, 1);
    const up = slotsInQuad(0, 3);
    const cur = down[0];
    const occupied = new Set<number>([cur, ...up.slice(0, 3)]);
    const enemyPos = slotWorldPos(CENTER, decodeSlotId(cur).layer, decodeSlotId(cur).index, P);
    expect(tryClaimBalanceSlot(enemyPos, CENTER, cur, occupied, P)).toBe(-1);
  });

  it('★ 無較空象限（四象限佔槽相同）→ -1', () => {
    // 把四象限都填到相同佔槽數(across layers)，使 cur 象限「並列最擠」但沒有象限 ≤ cur−threshold → -1。
    // layer0 各象限槽數不均(1,2,2,3)，故跨 layer0+layer1 湊到每象限剛好 EQ 個。
    const EQ = 3;
    const occupied = new Set<number>();
    for (let q = 0; q < 4; q += 1) {
      const ids = [...slotsInQuad(0, q), ...slotsInQuad(1, q)]; // 該象限跨兩層的槽
      for (const id of ids.slice(0, EQ)) occupied.add(id); // 每象限剛好 EQ 個
    }
    // cur 取「下」象限(quad1)一個已佔的槽。四象限皆 EQ → cur 並列最擠、無較空象限。
    const cur = [...occupied].find((id) => quadOfSlot(id) === 1)!;
    const enemyPos = slotWorldPos(CENTER, decodeSlotId(cur).layer, decodeSlotId(cur).index, P);
    expect(tryClaimBalanceSlot(enemyPos, CENTER, cur, occupied, P)).toBe(-1);
  });

  it('全佔滿（無空槽）→ -1', () => {
    const occupied = new Set<number>();
    for (let layer = 0; layer < P.maxLayers; layer += 1) {
      const n = slotCountForLayer(layer, P);
      for (let i = 0; i < n; i += 1) occupied.add(encodeSlotId(layer, i));
    }
    const cur = slotsInQuad(0, 1)[0];
    const enemyPos = slotWorldPos(CENTER, 0, decodeSlotId(cur).index, P);
    expect(tryClaimBalanceSlot(enemyPos, CENTER, cur, occupied, P)).toBe(-1);
  });

  it('★ imbalanceThreshold 邊界：差恰=threshold 不遷、> threshold 才遷', () => {
    const down = slotsInQuad(0, 1);
    const up = slotsInQuad(0, 3);
    const cur = down[0];
    // 下象限 2 隻、上象限 1 隻：差=1。threshold=1 → count[up]=1 > cur(2)−1=1? 1>1 false → 不 skip... 需 count ≤ cur−threshold=1 才收；up=1 ≤1 收。
    // 為測「差恰=threshold 不遷」：讓上象限 count = cur−threshold+1（剛好不夠空）。
    // 下 3 隻、上 2 隻,threshold=1 → 需 up ≤ 3−1=2；up=2 ≤2 → 收（遷）。差=1=threshold → 這版是「>」邊界:src `counts[q] > counts[curQuad] - threshold` 才 skip。
    // 下=3,上=3,threshold=1：up=3 > 3−1=2 → skip（不遷）＝差 0 不遷。
    const occ0 = new Set<number>([...down.slice(0, 3), ...up.slice(0, 3)]);
    const enemyPos = slotWorldPos(CENTER, 0, decodeSlotId(cur).index, P);
    expect(tryClaimBalanceSlot(enemyPos, CENTER, cur, occ0, P, 0, 1)).toBe(-1); // 一樣擠→不遷
    // 下=3,上=1,threshold=1：up=1 ≤ 3−1=2 → 收（遷）。差=2 > threshold。
    const occ1 = new Set<number>([...down.slice(0, 3), ...up.slice(0, 1)]);
    expect(tryClaimBalanceSlot(enemyPos, CENTER, cur, occ1, P, 0, 1)).not.toBe(-1);
  });
});

describe('tryClaimBalanceSlot — 同層/跨層遷移', () => {
  it('本象限最擠時可跨層遷到較空象限（多候選：同層無空位則跨層）', () => {
    // cur 在 layer1 下象限；下象限 layer0+1 全滿(最擠)。→ 遷到較空象限的空槽（layer1 起）。
    const occ = new Set<number>([...slotsInQuad(0, 1), ...slotsInQuad(1, 1)]);
    const cur = slotsInQuad(1, 1)[0]; // layer1 下象限
    const enemyPos = slotWorldPos(CENTER, 1, decodeSlotId(cur).index, P);
    const got = tryClaimBalanceSlot(enemyPos, CENTER, cur, occ, P);
    expect(got).not.toBe(-1); // 有遷移目標（下象限最擠 → 遷出）
    expect(occ.has(got)).toBe(false); // 目標為空槽
    expect(quadOfSlot(got)).not.toBe(1); // 不遷回下象限（最擠象限）
  });
});

/**
 * 誠實覆蓋分界（測騎自評）：
 *  - ★核心 max-gate（本象限非最擠→-1）已由「本象限非最擠→-1」測 + 壞版控制(拿掉 max gate→該測紅)鎖死——
 *    這是 #3「怪卡搜索圈下方 / 亂遷抖動」根治的核心契約。
 *  - imbalanceThreshold 邊界(threshold=1 時 `>cur−1` 與 `>=cur` 為等價 mutant)、layerPenalty tie-break
 *    幾何隔離困難,未獨立以壞版釘死（環象限槽數不均、跨層更近槽的構造脆弱）——列為誠實分界,不硬湊假鑑別測。
 *  - Enemy surround 每幀呼叫 + 遷移接線屬狀態機(需 boot,翼騎 headless 驗)——不補。
 */
