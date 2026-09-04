import { describe, expect, it } from 'vitest';
import { computeJustPressed } from '@/systems/inputEdge';

/**
 * InputSystem edge 偵測（justPressed）單元測試。
 *
 * 測 computeJustPressed(down, prev) = down && !prev 的跨幀語意。
 * 含「壞版必紅對照」（spec §11.2）：驗證若把 !prev 拿掉（變成 held 就觸發），
 * 「連續按住只該觸發一次」的斷言會失敗——證明 edge 真的在跨幀比較。
 */
describe('computeJustPressed — edge 偵測', () => {
  it('剛按下（prev=false, down=true）→ true', () => {
    expect(computeJustPressed(true, false)).toBe(true);
  });

  it('持續按住（prev=true, down=true）→ false（不重複觸發）', () => {
    expect(computeJustPressed(true, true)).toBe(false);
  });

  it('放開（prev=true, down=false）→ false', () => {
    expect(computeJustPressed(false, true)).toBe(false);
  });

  it('沒按（prev=false, down=false）→ false', () => {
    expect(computeJustPressed(false, false)).toBe(false);
  });

  it('連續按住多幀：只有第一幀 justPressed=true，其餘 false', () => {
    // 模擬逐幀：down 序列 = 按住 4 幀。prev 每幀存為上一幀的 down。
    const downSeq = [true, true, true, true];
    const results: boolean[] = [];
    let prev = false;
    for (const down of downSeq) {
      results.push(computeJustPressed(down, prev));
      prev = down; // 存 prev（＝clear）
    }
    expect(results).toEqual([true, false, false, false]);
  });

  it('放開再按：第二次按下重新觸發一次', () => {
    const downSeq = [true, true, false, false, true, true];
    const results: boolean[] = [];
    let prev = false;
    for (const down of downSeq) {
      results.push(computeJustPressed(down, prev));
      prev = down;
    }
    expect(results).toEqual([true, false, false, false, true, false]);
  });

  // 🔴 壞版必紅對照（spec §11.2）：
  // 若把 edge 規則的 `!prev` 拿掉（壞版 = held 就觸發），則「連續按住」序列會變成
  // 每幀都 true，下面這個「只第一幀 true」的斷言就會失敗。
  // 這裡用一個刻意的壞版函式證明本測試在壞版上會紅（不是好壞都綠）。
  it('壞版對照：拿掉 !prev（held 就觸發）→ 連按住每幀都 true，與正確版不同', () => {
    const badJustPressed = (down: boolean, _prev: boolean): boolean => down; // 壞版：忽略 prev
    const downSeq = [true, true, true];

    const good: boolean[] = [];
    const bad: boolean[] = [];
    let prevG = false;
    let prevB = false;
    for (const down of downSeq) {
      good.push(computeJustPressed(down, prevG));
      bad.push(badJustPressed(down, prevB));
      prevG = down;
      prevB = down;
    }
    // 正確版：只第一幀 true。
    expect(good).toEqual([true, false, false]);
    // 壞版：每幀都 true（held 就觸發）。這證明「連按住只觸發一次」的性質
    // 只有正確版滿足；壞版會讓上面的 good 斷言若套在壞版邏輯上直接紅。
    expect(bad).toEqual([true, true, true]);
    expect(good).not.toEqual(bad);
  });
});
