// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { TransformItem, INITIAL_ITEM_PICKUP_IMMUNITY_SEC } from '@/entities/TransformItem';

/**
 * TransformItem 撿取免疫 — 初始道具引導去撿（用戶七輪#9 乙，翼騎 8b4b828）。
 * 初始道具進場後短暫不可撿(INITIAL_ITEM_PICKUP_IMMUNITY_SEC=1.5s)，給玩家看箭頭走過去的時間、不被秒撿。
 * isInPickupRange/tickImmunity/setPickupImmunity 是 TransformItem 實例方法(依賴 this.pickupImmunitySec + this.container 座標)
 *   → 需 Phaser scene(jsdom HEADLESS boot,同 hitFeelEnemy 範式)構造真實例來斷「免疫中不可撿」的可觀察行為。
 * 維度3 斷 isInPickupRange bool(免疫中 false、免疫結束恢復正常距離判定)。含壞版必紅(免疫沒擋)。
 * ⚠️ TransformSystem 每幀 tickImmunity + 撿取接線屬狀態機(翼騎 headless 驗初始道具存活 13s)——不重測整條;此處補免疫閘的實例行為。
 */
let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() {
        super('Boot');
      }
      create(): void {
        scene = this;
        resolve();
      }
    }
    game = new Phaser.Game({ type: Phaser.HEADLESS, width: 1920, height: 1080, scene: [Boot], audio: { noAudio: true } });
  });
});
afterAll(() => {
  game?.destroy(true);
});

/** 建一個初始道具在原點。 */
function makeInitialItem(): TransformItem {
  return new TransformItem(scene, 0, 0, 1, 'initial');
}
const AT_ITEM = { x: 0, y: 0 }; // 玩家在道具正上（距離 0，必在撿取半徑內）

describe('TransformItem 撿取免疫（#9 乙：初始道具進場短暫不可撿）', () => {
  it('常數：INITIAL_ITEM_PICKUP_IMMUNITY_SEC = 1.5', () => {
    expect(INITIAL_ITEM_PICKUP_IMMUNITY_SEC).toBe(1.5);
  });

  it('無免疫時：玩家在撿取半徑內 → isInPickupRange true（正常判定）', () => {
    const item = makeInitialItem();
    expect(item.isInPickupRange(AT_ITEM)).toBe(true); // 未設免疫,距離 0 內
  });

  it('★ 免疫中（setPickupImmunity 1.5）→ isInPickupRange false（免疫期間不可撿,即使在半徑內）', () => {
    const item = makeInitialItem();
    item.setPickupImmunity(INITIAL_ITEM_PICKUP_IMMUNITY_SEC);
    expect(item.isInPickupRange(AT_ITEM)).toBe(false); // 免疫擋,不被秒撿
  });

  it('★ tickImmunity 遞減、過 1.5s 後可撿（免疫結束恢復正常距離判定）', () => {
    const item = makeInitialItem();
    item.setPickupImmunity(1.5);
    item.tickImmunity(1.0); // 剩 0.5s 仍免疫
    expect(item.isInPickupRange(AT_ITEM)).toBe(false);
    item.tickImmunity(0.6); // 累計 1.6 > 1.5 → 免疫結束
    expect(item.isInPickupRange(AT_ITEM)).toBe(true); // 恢復正常判定,可撿
  });

  it('免疫結束後 距離外仍 false（免疫解除不等於一律可撿,仍看距離）', () => {
    const item = makeInitialItem();
    item.setPickupImmunity(1.5);
    item.tickImmunity(2.0); // 免疫結束
    expect(item.isInPickupRange({ x: 9999, y: 9999 })).toBe(false); // 太遠 → false
  });

  it('tickImmunity 不會扣成負（clamp 0）→ 免疫結束後不會又變免疫', () => {
    const item = makeInitialItem();
    item.setPickupImmunity(0.1);
    item.tickImmunity(5); // 大幅超扣
    expect(item.isInPickupRange(AT_ITEM)).toBe(true); // 免疫已 0,可撿
  });
});
