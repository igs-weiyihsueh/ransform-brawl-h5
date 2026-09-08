import { describe, expect, it } from 'vitest';
import {
  GRAB_HINT_LAYOUT,
  resolveGrabHintDisplay,
} from '@/config/uiConfig';

/**
 * resolveGrabHintDisplay — 被抓「攻擊倒數提示」位置偏移（用戶要編輯器可調）。
 * 基準頭頂偏移 (0,-90)（GRAB_HINT_LAYOUT）+ editorStore override（layout.grabHint offset）。
 * 純函式：GrabSystem 定位讀此（純顯示定位，不碰抓人邏輯/倒數秒數）。含壞版對照。
 */
describe('resolveGrabHintDisplay — 被抓提示位置偏移', () => {
  it('無 override → 用基準偏移 (0,-90)（行為不變）', () => {
    const r = resolveGrabHintDisplay(undefined);
    expect(r.offsetX).toBe(GRAB_HINT_LAYOUT.baseOffsetX);
    expect(r.offsetY).toBe(GRAB_HINT_LAYOUT.baseOffsetY);
    expect(r.offsetX).toBe(0);
    expect(r.offsetY).toBe(-90);
  });

  it('override offset → 基準 + override（平移）', () => {
    const r = resolveGrabHintDisplay({ grabHintOffsetX: 30, grabHintOffsetY: 20 });
    expect(r.offsetX).toBe(0 + 30);
    expect(r.offsetY).toBe(-90 + 20);
  });

  it('負 override（往上/往左更多）', () => {
    const r = resolveGrabHintDisplay({ grabHintOffsetX: -15, grabHintOffsetY: -40 });
    expect(r.offsetX).toBe(-15);
    expect(r.offsetY).toBe(-130);
  });

  it('部分 override（只給 X）→ Y 用基準', () => {
    const r = resolveGrabHintDisplay({ grabHintOffsetX: 12 });
    expect(r.offsetX).toBe(12);
    expect(r.offsetY).toBe(-90);
  });

  it('★壞版對照：override 加總錯（如忘了加基準）會被抓到', () => {
    // 正確 = 基準(-90) + override(20) = -70；若日後誤成只回 override(20) 會紅。
    expect(resolveGrabHintDisplay({ grabHintOffsetY: 20 }).offsetY).toBe(-70);
  });
});
