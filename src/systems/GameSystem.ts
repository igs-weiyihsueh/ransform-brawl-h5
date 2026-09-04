import type { GameContext } from '@/systems/GameContext';

/**
 * GameSystem — 遊戲系統的共用介面（見 docs/h5_collab_spec.md §4）。
 *
 * GameScene 維護一個 GameSystem[] registry，create() 時依序 init、
 * update() 時依序 update。新系統只要 implement 此介面、在 registry 加一行，
 * 完全不用改 GameScene 主迴圈邏輯本體。
 *
 * 生命週期：
 *  - init(ctx)：場景 create 後呼叫一次，拿共用 context、建立自身狀態/UI/監聽。
 *  - update(dt)：每幀呼叫，dt 為秒。
 *  - destroy?()：場景結束時呼叫（可選），釋放資源/解除監聽。
 *
 * registry 順序即執行順序：需要「先輸入/移動、再敵人、再清理/繪製」的依賴，
 * 靠在 registry 中的排列順序表達（見 GameScene 的註冊順序註解）。
 */
export interface GameSystem {
  /** 系統名稱（debug/log 用）。 */
  readonly name: string;
  /** 場景建立後初始化，取得共用 context。 */
  init(ctx: GameContext): void;
  /** 每幀更新。dt 為秒。 */
  update(dt: number): void;
  /** 場景結束清理（可選）。 */
  destroy?(): void;
}
