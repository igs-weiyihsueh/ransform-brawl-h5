/**
 * inputEdge.ts — 輸入 edge 偵測純函式（零依賴，方便單元測試，不 import Phaser）。
 */

/**
 * edge 偵測：justPressed = 本幀按下且上一幀沒按下。
 * 抽成獨立零依賴模組，讓單元測試在純 node 環境（不載 Phaser）就能驗跨幀 edge。
 */
export function computeJustPressed(down: boolean, prev: boolean): boolean {
  return down && !prev;
}
