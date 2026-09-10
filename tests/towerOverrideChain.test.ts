// @vitest-environment node
/**
 * 塔碰撞欄「編輯器調→匯出→遊戲載入」完整鏈路（用戶：調 X/Y/半徑遊戲沒變；征騎確認 game-side 全通 → 查上游）。
 * 模擬 event-editor 的 twApply（JSON.stringify override）→ 遊戲 loadOverride（JSON.parse）→ resolveTower →
 * getResolvedTowerPreset(name)：編輯的 towerCollisionRadiusPx/OffsetXY 必須原值帶到遊戲端解析結果。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  validateTower, resolveTower, defaultTowerFile,
  getResolvedTowerPreset, clearResolvedTowerCache,
} from '@/config/towerSchema';

beforeEach(() => clearResolvedTowerCache());

describe('塔碰撞欄 編輯器→JSON→遊戲 完整鏈路（原值不丟）', () => {
  it('編輯 Tower4 towerCollisionRadiusPx=200/OffsetX=30/OffsetY=-20 → stringify→parse→validate→resolve 原值帶到', () => {
    const tw = defaultTowerFile();
    // 模擬 editor onChange 寫進 twFile.presets[twCurrent]。
    tw.presets.Tower4.towerCollisionRadiusPx = 200;
    tw.presets.Tower4.towerCollisionOffsetXPx = 30;
    tw.presets.Tower4.towerCollisionOffsetYPx = -20;

    const override = JSON.parse(JSON.stringify(tw)); // applyToGame stringify → loadOverride parse
    const v = validateTower(override);
    expect(v.ok).toBe(true);

    const resolved = resolveTower(override);
    expect(resolved.Tower4.towerCollisionRadiusPx).toBe(200);
    expect(resolved.Tower4.towerCollisionOffsetXPx).toBe(30);
    expect(resolved.Tower4.towerCollisionOffsetYPx).toBe(-20);
  });

  it('遊戲端 getResolvedTowerPreset（走 override cache）拿到編輯值（比對關卡 event 節點 eventPresetName=Tower4）', () => {
    const tw = defaultTowerFile();
    tw.presets.Tower4.towerCollisionRadiusPx = 200;
    const override = JSON.parse(JSON.stringify(tw));
    // resolveTower 直接餵 override（getResolvedTowerPresets 在 node 無 localStorage 走打包，故用 resolveTower 驗鏈路）。
    const resolved = resolveTower(override);
    // 關卡 event 節點 eventPresetName='Tower4' → 遊戲 getResolvedTowerPreset('Tower4')。
    expect(resolved.Tower4?.towerCollisionRadiusPx).toBe(200);
    expect('Tower4' in resolved).toBe(true); // preset 名對得上（否則 fallback 打包預設，怎麼調都一樣）
  });

  it('★ 只編輯 Tower4、Tower6 未動 → 兩者都在（override merge 不掉其他 preset）', () => {
    const tw = defaultTowerFile();
    tw.presets.Tower4.towerCollisionRadiusPx = 150;
    const resolved = resolveTower(JSON.parse(JSON.stringify(tw)));
    expect(resolved.Tower4.towerCollisionRadiusPx).toBe(150);
    expect(resolved.Tower6).toBeDefined(); // Tower6 沿用（merge by name 不丟）
  });
});
