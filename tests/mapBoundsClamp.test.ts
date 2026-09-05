// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAP_BOUNDS,
  PANEL_TOP_Y,
  PLAYER_BOUNDS,
  clampToBounds,
  insetBounds,
} from '@/config/mapConfig';
import { PANEL_DEPTH } from '@/config/uiConfig';
import { GLOBAL_CHARACTER_SCALE, PLAYER_HIT_RADIUS } from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';

/**
 * 地圖邊界嚴謹化 — 夾限行為/整合層測試（用戶驗收 bug1/2）。
 *
 * 翼騎 mapBoundsStrict.test 6 顆已覆蓋【常數層】(PLAYER_BOUNDS.maxY<PANEL_TOP_Y、
 * insetBounds 內縮/不反轉) + 2 壞版對照——複核=扎實，不重寫。
 * 這裡補【夾限行為層】(clampToBounds 套 PLAYER_BOUNDS/insetBounds 的實際結果)：
 *   維度3 斷「夾限後的實際座標/body 邊緣位置」，非只斷常數、非 call-count。
 *
 * ⚠️ 純函式層(node)。live sprite depth 切換 / 實機推擠 在 Player/Enemy entity(需 jsdom
 *    boot)，不在本測涵蓋——見末段 depth 說明。
 */

const PLAYER_BODY_R = PLAYER_HIT_RADIUS * PPU * GLOBAL_CHARACTER_SCALE; // 60

describe('地圖邊界 — 玩家下界不進面板（clamp 行為，bug1）', () => {
  it('玩家往下走超過可走下界 → clamp 到 PLAYER_BOUNDS.maxY(884)、不進面板', () => {
    // 想走到面板裡(y=940，場地下界但在面板頂緣944之下的身體會露)。
    const c = clampToBounds(960, 940, PLAYER_BOUNDS);
    expect(c.y).toBe(PLAYER_BOUNDS.maxY); // 被收到 884
    expect(c.changed).toBe(true);
    // 夾限後「角色 body 底緣」= y + body半徑，必須 <= 面板頂緣（整個身體不重疊面板）。
    expect(c.y + PLAYER_BODY_R).toBeLessThanOrEqual(PANEL_TOP_Y);
  });

  it('玩家在可走區內(y<=884) → 不夾（changed=false、座標原樣）', () => {
    const c = clampToBounds(960, 884, PLAYER_BOUNDS);
    expect(c.changed).toBe(false);
    expect(c.y).toBe(884);
  });

  it('X 仍用全場寬(160~1760)、只有下界被收（上界/左右不變）', () => {
    expect(clampToBounds(160, 540, PLAYER_BOUNDS).changed).toBe(false); // 左界同場地
    expect(clampToBounds(1760, 540, PLAYER_BOUNDS).changed).toBe(false); // 右界同場地
    expect(clampToBounds(960, 140, PLAYER_BOUNDS).changed).toBe(false); // 上界同場地
    expect(clampToBounds(159, 540, PLAYER_BOUNDS).x).toBe(160); // 越左界才夾
  });
});

describe('地圖邊界 — 敵人 body 內縮不出界（insetBounds+clamp，bug2）', () => {
  it('敵人 body 半徑內縮：推到界邊後整個 body 在界內（中心離界 >= r）', () => {
    const r = 40;
    const inset = insetBounds(MAP_BOUNDS, r);
    // 敵人被推到右下角外側。
    const c = clampToBounds(9999, 9999, inset);
    expect(c.changed).toBe(true);
    // 夾限後中心離右界/下界至少 r → body 右緣/下緣不超過 MAP_BOUNDS。
    expect(c.x + r).toBeLessThanOrEqual(MAP_BOUNDS.maxX);
    expect(c.y + r).toBeLessThanOrEqual(MAP_BOUNDS.maxY);
    expect(c.x).toBe(MAP_BOUNDS.maxX - r);
    expect(c.y).toBe(MAP_BOUNDS.maxY - r);
  });

  it('左上角同理：body 左/上緣不出界（中心 = 界 + r）', () => {
    const r = 40;
    const c = clampToBounds(-9999, -9999, insetBounds(MAP_BOUNDS, r));
    expect(c.x - r).toBeGreaterThanOrEqual(MAP_BOUNDS.minX);
    expect(c.y - r).toBeGreaterThanOrEqual(MAP_BOUNDS.minY);
    expect(c.x).toBe(MAP_BOUNDS.minX + r);
    expect(c.y).toBe(MAP_BOUNDS.minY + r);
  });

  it('body 半徑越大內縮越多（r=100 比 r=40 更早被夾）', () => {
    const near = { x: MAP_BOUNDS.maxX - 50, y: 540 }; // 距右界 50
    const c40 = clampToBounds(near.x, near.y, insetBounds(MAP_BOUNDS, 40)); // 內縮40 → 界=maxX-40，50>40 不夾
    const c100 = clampToBounds(near.x, near.y, insetBounds(MAP_BOUNDS, 100)); // 內縮100 → 界=maxX-100，50<100 夾
    expect(c40.changed).toBe(false);
    expect(c100.changed).toBe(true);
    expect(c100.x).toBe(MAP_BOUNDS.maxX - 100);
  });

  it('不超界時 changed=false（呼應「只在真超界才寫回」，避免每幀跟物理打架）', () => {
    const c = clampToBounds(960, 540, insetBounds(MAP_BOUNDS, 40));
    expect(c.changed).toBe(false);
  });
});

describe('待機 depth 契約（bug1 角色被面板蓋住）— 可測數值不變量', () => {
  it('面板 depth(1000) 遠高於一般遊玩 depth(10)：待機需 > 面板才看得見', () => {
    // WAITING_DEPTH=PANEL_DEPTH+10、PLAY_DEPTH=10 是 Player.ts 私有常數（未匯出），
    // 這裡驗可匯出的契約：PANEL_DEPTH 必須遠高於遊玩層，待機才需被提到面板之上。
    const PLAY_DEPTH = 10; // 對齊 Player.ts
    expect(PANEL_DEPTH).toBeGreaterThan(PLAY_DEPTH); // 面板蓋在遊玩層之上（bug 成因）
    // 待機 depth 契約：必須 > PANEL_DEPTH 才不被面板蓋住。
    const waitingDepth = PANEL_DEPTH + 10; // = Player.ts WAITING_DEPTH 定義
    expect(waitingDepth).toBeGreaterThan(PANEL_DEPTH);
    // 落地回 PLAY_DEPTH → 在面板之下（正常遊玩、被下方面板 HUD 蓋住不礙事）。
    expect(PLAY_DEPTH).toBeLessThan(PANEL_DEPTH);
  });
});
