// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { initialItemPos } from '@/systems/itemGuideMath';

/**
 * initialItemPos — 角色進場發初始變身道具的位置（用戶五輪#1，翼騎 752ace8）。
 * 落地後在落點正上方 offsetPx 發一個有主初始道具（source='initial'→owner，resolveItemOwner 已測）。
 * 簽章(讀 src 6c3d296)：initialItemPos(landing:Vec2, bounds{minX,maxX,minY,maxY}, offsetPx=180) → {x,y}。
 * 邏輯：y = clamp(landing.y − offsetPx, minY, maxY)；x = clamp(landing.x, minX, maxX)。
 * 維度3 斷 x/y 座標值。含壞版必紅（上方 offset 方向 / 上界 clamp / x clamp）。
 * ⚠️ giveInitialItem 進場落地當幀呼 spawnItem 屬狀態機接線(需 boot,翼騎 headless 驗前0後1、hasBorder、subagent 看圖)——不補;
 *    spawnItem source='initial' 的 resolveItemOwner 已測;initialItemPos 純函式補足。
 */
const B = { minX: 160, maxX: 1760, minY: 140, maxY: 868.4 };

describe('initialItemPos — 落點正上方 offsetPx、clamp 界內', () => {
  it('★ 落點上方 offsetPx：場中央落點 → y = landing.y − 90（道具在正上方，H5 Y 下為正→上方 −y）', () => {
    const p = initialItemPos({ x: 900, y: 500 }, B, 90);
    expect(p.y).toBe(410); // 500 − 90
    expect(p.x).toBe(900); // x 同落點（界內不夾）
    expect(p.y).toBeLessThan(500); // 確在落點上方
  });

  it('offsetPx 預設 180：不傳 offsetPx → y = landing.y − 180（七輪#10：初始道具離角色遠一點，90→180）', () => {
    expect(initialItemPos({ x: 900, y: 500 }, B).y).toBe(320); // 500 − 180
  });

  it('★ 上界 clamp：落點靠上邊（y=180，−90=90<minY140）→ y clamp 到 minY(140)、不出上界', () => {
    const p = initialItemPos({ x: 900, y: 180 }, B, 90);
    expect(p.y).toBe(B.minY); // 90 被夾到 140
    expect(p.y).toBeGreaterThanOrEqual(B.minY);
  });

  it('★ x clamp 左界：落點越左（x=100<minX160）→ x clamp 到 minX(160)', () => {
    expect(initialItemPos({ x: 100, y: 500 }, B, 90).x).toBe(B.minX);
  });

  it('★ x clamp 右界：落點越右（x=1900>maxX1760）→ x clamp 到 maxX(1760)', () => {
    expect(initialItemPos({ x: 1900, y: 500 }, B, 90).x).toBe(B.maxX);
  });

  it('下界不會被觸及（道具在上方，y 恆 <= landing.y）但仍 clamp maxY 保險', () => {
    // 落點在下界附近，上方 offset 後仍在界內。
    const p = initialItemPos({ x: 900, y: 860 }, B, 90);
    expect(p.y).toBe(770); // 860−90，界內
    expect(p.y).toBeLessThanOrEqual(B.maxY);
  });

  it('自訂 offsetPx 生效（offsetPx=200 → 更高）', () => {
    expect(initialItemPos({ x: 900, y: 500 }, B, 200).y).toBe(300); // 500−200
  });

  it('界內落點：x/y 皆不夾（原樣上方偏移）', () => {
    const p = initialItemPos({ x: 500, y: 600 }, B, 90);
    expect(p).toEqual({ x: 500, y: 510 });
  });
});
