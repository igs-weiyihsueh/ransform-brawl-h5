import { describe, expect, it } from 'vitest';
import {
  resolveGrabIdleTriggerSec,
  GRAB_SCHEMA_VERSION,
  defaultGrabFile,
} from '@/config/grabSchema';
import { GRAB } from '@/systems/grabMath';

/**
 * grabSchema — 抓人「閒置觸發秒數」override 解析（用戶要編輯器可調閒置多久被抓）。
 * resolveGrabIdleTriggerSec(override, packaged=GRAB.idleTriggerSeconds)：
 *   合法 {version:1, idleTriggerSec:有限正數}→override；否則→packaged。含壞版對照必紅。
 */
const PKG = 8; // 測試用固定 packaged，不依賴 config 值

describe('resolveGrabIdleTriggerSec — override 優先、fallback 打包預設', () => {
  it('override 沒設（null/undefined/非物件）→ 回 packaged', () => {
    expect(resolveGrabIdleTriggerSec(null, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec(undefined, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec('nope' as unknown, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec(123 as unknown, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec([8] as unknown, PKG)).toBe(PKG); // 陣列(過 typeof object 但缺 version)
  });

  it('合法 override → 採用 idleTriggerSec（用戶調小=更快被抓）', () => {
    expect(resolveGrabIdleTriggerSec({ version: 1, idleTriggerSec: 3 }, PKG)).toBe(3);
    expect(resolveGrabIdleTriggerSec({ version: 1, idleTriggerSec: 15 }, PKG)).toBe(15);
  });

  it('★version 錯 → 不採用、回 packaged', () => {
    expect(resolveGrabIdleTriggerSec({ version: 2, idleTriggerSec: 3 }, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec({ idleTriggerSec: 3 }, PKG)).toBe(PKG); // 缺 version
  });

  it('★壞值：idleTriggerSec 非有限正數（0/負/NaN/字串/缺）→ 回 packaged', () => {
    expect(resolveGrabIdleTriggerSec({ version: 1, idleTriggerSec: 0 }, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec({ version: 1, idleTriggerSec: -3 }, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec({ version: 1, idleTriggerSec: NaN }, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec({ version: 1, idleTriggerSec: '5' }, PKG)).toBe(PKG);
    expect(resolveGrabIdleTriggerSec({ version: 1 }, PKG)).toBe(PKG); // 缺欄
  });

  it('★物件守衛：function-with-props（typeof≠object）→ 回 packaged', () => {
    const fn = Object.assign(function () {}, { version: 1, idleTriggerSec: 3 });
    expect(resolveGrabIdleTriggerSec(fn as unknown, PKG)).toBe(PKG);
  });

  it('packaged 參數可覆寫 fallback', () => {
    expect(resolveGrabIdleTriggerSec(null, 12)).toBe(12);
  });

  it('SCHEMA_VERSION=1、defaultGrabFile={version:1, idleTriggerSec:GRAB.idleTriggerSeconds}', () => {
    expect(GRAB_SCHEMA_VERSION).toBe(1);
    const f = defaultGrabFile();
    expect(f.version).toBe(1);
    expect(f.idleTriggerSec).toBe(GRAB.idleTriggerSeconds);
  });
});
