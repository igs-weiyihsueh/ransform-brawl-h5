import { describe, expect, it, afterEach } from 'vitest';
import {
  MAP_BOUNDS, PLAYER_BOUNDS, clampToBounds,
  effectivePlayerBounds, setPlayerLeftBoundOverride, getPlayerLeftBoundOverride,
  getLevelOffsetX, advanceLevelOffsetX, setLevelOffsetX,
} from '@/config/mapConfig';

/**
 * 地圖邊界夾限測試（項目 1）。含壞版必紅：超界修正、界內不動(changed=false)、四邊都夾。
 * 進場旁路(isJumping)在系統層(PlayerControlSystem)判斷、非純函式，這裡只測夾限本身。
 */
describe('clampToBounds — 地圖邊界夾限', () => {
  it('邊界值：畫面中央 1600×800（160~1760, 140~940）', () => {
    expect(MAP_BOUNDS.minX).toBe(160);
    expect(MAP_BOUNDS.maxX).toBe(1760);
    expect(MAP_BOUNDS.minY).toBe(140);
    expect(MAP_BOUNDS.maxY).toBe(940);
  });

  it('界內不夾（changed=false、座標不變）', () => {
    const c = clampToBounds(960, 540);
    expect(c.x).toBe(960);
    expect(c.y).toBe(540);
    expect(c.changed).toBe(false);
  });

  it('超左界 → 夾到 minX、changed=true', () => {
    const c = clampToBounds(0, 540);
    expect(c.x).toBe(160);
    expect(c.changed).toBe(true);
  });

  it('超右界 → 夾到 maxX', () => {
    expect(clampToBounds(5000, 540).x).toBe(1760);
  });

  it('超上界 → 夾到 minY', () => {
    expect(clampToBounds(960, -100).y).toBe(140);
  });

  it('超下界 → 夾到 maxY', () => {
    expect(clampToBounds(960, 5000).y).toBe(940);
  });

  it('對角超界 → x/y 各自夾、changed=true', () => {
    const c = clampToBounds(-50, 2000);
    expect(c.x).toBe(160);
    expect(c.y).toBe(940);
    expect(c.changed).toBe(true);
  });

  it('剛好在邊界上 → 不算超界（changed=false）', () => {
    expect(clampToBounds(160, 140).changed).toBe(false);
    expect(clampToBounds(1760, 940).changed).toBe(false);
  });

  // 🔴 壞版對照：若沒夾限（回傳原值），超界點的座標不會被修正。
  it('壞版對照：超界點確實被修正（非原值）', () => {
    const c = clampToBounds(9999, 540);
    expect(c.x).not.toBe(9999);
    expect(c.x).toBe(1760);
  });

  // 🔴 壞版對照：界內點的 changed 必為 false（避免每幀強設位置跟物理打架）。
  it('壞版對照：界內 changed 必 false（不觸發寫回）', () => {
    expect(clampToBounds(500, 500).changed).toBe(false);
  });
});

/**
 * ★關卡推進 step2 過場重做 ⑤「進新地圖邊界還原框住」佐證測（翼騎補，異靈定案 A）：
 * 用戶抓的第 5 點＝過關進新區塊後、玩家往左走會被【新地圖左界】擋住（走不出新地圖）。
 * 機制：commitAdvance 遞進 offset(-STRIDE) 後 setPlayerLeftBoundOverride(null) 還原 override，
 *   effectivePlayerBounds() 的左界改回「PLAYER_BOUNDS.minX + 當前 offset」＝新區塊左界，玩家 clamp 停此。
 *
 * headed 為何驗不出這點：player.move 持續往左走會不斷「清關→openPortal 解界→過關」連鎖（探針假象），
 *   隔離不出單關內玩家撞新界——非功能失效（診斷已證 isAwaiting 反覆 true＝又開通道解界）。
 * 故用結構化單元測直接斷言 offset 後正常界＝新區塊界 + clamp 停此（跟 code 明確 + 變身-leader PR review
 *   override 三路徑全還原/順序對，三方交叉佐證⑤）。BLOCK_STRIDE_PX=700（LevelProgressSystem 定值）。
 */
describe('關卡推進 ⑤ override 還原：進新地圖後玩家被新區塊左界框住', () => {
  const STRIDE = 700; // LevelProgressSystem BLOCK_STRIDE_PX

  // 測試間清 offset + override，避免互相污染（offset 是模組級累加狀態）。
  afterEach(() => {
    setPlayerLeftBoundOverride(null);
    setLevelOffsetX(0);
  });

  it('過場中 override 放寬左界＝可走進通道（新區塊左界 = 原左界 - STRIDE）', () => {
    // openPortal 態：offset 還沒遞進(=0)、override 放寬到新區塊左界，玩家可自由往左走進通道。
    const openLeft = PLAYER_BOUNDS.minX + 0 - STRIDE; // 160 - 700 = -540
    setPlayerLeftBoundOverride(openLeft);
    expect(getPlayerLeftBoundOverride()).toBe(openLeft);
    expect(effectivePlayerBounds().minX).toBe(openLeft); // 過場中左界＝放寬後(-540)，玩家可越原分界 160 往左
  });

  it('★commitAdvance 後（offset=-STRIDE + override 還原 null）：正常左界＝新區塊左界 -540', () => {
    // 模擬 commitAdvance：先遞進 offset、再還原 override（順序＝先 advance 後 null，變身-leader 背書無夾回舊塊空窗）。
    advanceLevelOffsetX(-STRIDE); // offset: 0 → -700
    setPlayerLeftBoundOverride(null); // 還原 override
    expect(getLevelOffsetX()).toBe(-STRIDE);
    expect(getPlayerLeftBoundOverride()).toBeNull(); // ★override 已還原
    // ★正常左界＝PLAYER_BOUNDS.minX + offset ＝ 160 + (-700) ＝ -540（新區塊左界，非舊區塊 160、非放寬態）。
    expect(effectivePlayerBounds().minX).toBe(PLAYER_BOUNDS.minX - STRIDE); // -540
    expect(effectivePlayerBounds().minX).toBe(-540);
    // 右界也隨 offset 平移（新區塊＝[-540, maxX-700]）。
    expect(effectivePlayerBounds().maxX).toBe(PLAYER_BOUNDS.maxX - STRIDE);
  });

  it('★玩家在新地圖往左走出新界 → 被 clamp 停在新區塊左界 -540（走不出新地圖）', () => {
    advanceLevelOffsetX(-STRIDE); // 進新區塊 offset=-700
    setPlayerLeftBoundOverride(null); // 還原＝正常界回新區塊
    const b = effectivePlayerBounds();
    // 玩家試圖往左走到 -1000（超出新地圖左界 -540）→ clamp 夾回 -540（＝被新地圖左界擋住）。
    const c = clampToBounds(-1000, b.minY + 10, b);
    expect(c.x).toBe(-540); // ★停在新界，走不過去
    expect(c.changed).toBe(true);
    // 新界內的點不夾（能在新區塊自由走）。
    expect(clampToBounds(-200, b.minY + 10, b).changed).toBe(false);
  });

  it('🔴 壞版對照：若 commitAdvance 沒還原 override（漏 setPlayerLeftBoundOverride(null)）→ 新界會停在放寬值而非 -540', () => {
    advanceLevelOffsetX(-STRIDE);
    // 模擬「漏還原」：override 仍是開場放寬的更左值（-540-700=-1240），玩家會被允許走更左＝bug。
    setPlayerLeftBoundOverride(PLAYER_BOUNDS.minX + 0 - STRIDE * 2); // -1240（漏還原的殘留放寬）
    // 漏還原時 effective 左界＝-1240（≠正確新界 -540）＝玩家能走出新區塊（用戶抱怨的沒框住）。
    expect(effectivePlayerBounds().minX).toBe(-1240);
    expect(effectivePlayerBounds().minX).not.toBe(-540); // 對照：正確還原應是 -540
  });
});
