// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pickSpawnPoint } from '@/systems/waveMath';

/**
 * pickSpawnPoint — spawn 位置 bug 修正（用戶七輪，翼騎 b0647b0）。
 * 真因：pickSpawnPosition 用 worldBounds(整畫面)→生界外;挑最遠→太遠。
 * 修：用 ENEMY_PLAY_BOUNDS(可移動區)界內 + 回「第一個夠遠」(非最遠)的點。
 * 簽章(讀 src b0647b0)：pickSpawnPoint(bounds, playerPos, minDist, rng, tries=8) → {x,y}。
 *   每 attempt 消耗 2 次 rng()：x=minX+rng*(maxX-minX)、y=minY+rng*(maxY-minY)；dist>=minDist 即 break。
 * 維度3 斷座標/選擇（rng 可注入定測）。含壞版必紅（第一個夠遠非最遠 / gate minDist / 界內）。
 * ⚠️ pickSpawnPosition 用 insetBounds(ENEMY_PLAY_BOUNDS)接線屬狀態機(需 boot,翼騎 headless 界外 0 驗)——不補;pickSpawnPoint 純函式補足。
 */
const B = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
const PLAYER = { x: 500, y: 500 };

/** 腳本化 rng：依序回傳給定值（每 attempt 取 2 個：x,y 比例）。 */
function scriptedRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++ % seq.length];
}

describe('pickSpawnPoint — 界內 + 第一個夠遠（非最遠）', () => {
  it('★ 第一個點就夠遠 → 回它（不再試更遠；即使後面有更遠的點）', () => {
    // minDist=200, player(500,500)。attempt0: rng(0.7,0.5)→(700,500) dist200 剛好夠遠 → 立即回;
    // 後面 (0,0) dist707 更遠但不試(第一個夠遠即用)。
    const p = pickSpawnPoint(B, PLAYER, 200, scriptedRng([0.7, 0.5, 0, 0]));
    expect(p).toEqual({ x: 700, y: 500 }); // 第一個夠遠,非後面更遠
  });

  it('★ 第一個太近、第二個夠遠 → 回第二個（且第二個非最遠，證明「第一個夠遠」非「最遠」）', () => {
    // minDist=200, player(500,500)。
    // attempt0: rng(0.5,0.5)→(500,500) dist0 太近;
    // attempt1: rng(0.7,0.5)→(700,500) dist200 剛好夠遠(第一個夠遠) → 回它;
    // attempt2: rng(0,0)→(0,0) dist707 更遠——不該被選(只回第一個夠遠,非最遠)。
    const p = pickSpawnPoint(B, PLAYER, 200, scriptedRng([0.5, 0.5, 0.7, 0.5, 0, 0]));
    expect(p).toEqual({ x: 700, y: 500 }); // 第一個夠遠(200),非後面更遠的(0,0)707
  });

  it('★ 回傳點在 bounds 內（x∈[minX,maxX]、y∈[minY,maxY]，不出界）', () => {
    for (const seq of [[0, 0], [1, 1], [0.5, 0.5], [0.3, 0.7]]) {
      const p = pickSpawnPoint(B, PLAYER, 300, scriptedRng(seq));
      expect(p.x).toBeGreaterThanOrEqual(B.minX);
      expect(p.x).toBeLessThanOrEqual(B.maxX);
      expect(p.y).toBeGreaterThanOrEqual(B.minY);
      expect(p.y).toBeLessThanOrEqual(B.maxY);
    }
  });

  it('★ 選中的點離玩家 ≥ minDist（夠遠）', () => {
    const p = pickSpawnPoint(B, PLAYER, 300, scriptedRng([0, 0]));
    expect(Math.hypot(p.x - PLAYER.x, p.y - PLAYER.y)).toBeGreaterThanOrEqual(300);
  });

  it('tries 次都太近 → 回最後一個點（保底不無限迴圈；點仍界內）', () => {
    // rng 恆 0.5 → 每 attempt 都 (500,500) dist0 < minDist → tries 用完回最後 (500,500)。
    const p = pickSpawnPoint(B, PLAYER, 300, scriptedRng([0.5]), 8);
    expect(p).toEqual({ x: 500, y: 500 }); // 保底回最後產生的點
    expect(p.x).toBeGreaterThanOrEqual(B.minX);
    expect(p.x).toBeLessThanOrEqual(B.maxX);
  });

  it('非零原點 bounds：點在該 bounds 內（相對範圍非絕對）', () => {
    const b2 = { minX: 200, maxX: 700, minY: 300, maxY: 800 };
    const p = pickSpawnPoint(b2, { x: 450, y: 550 }, 100, scriptedRng([0, 0]));
    expect(p.x).toBeGreaterThanOrEqual(200);
    expect(p.x).toBeLessThanOrEqual(700);
    expect(p.y).toBeGreaterThanOrEqual(300);
    expect(p.y).toBeLessThanOrEqual(800);
  });
});
