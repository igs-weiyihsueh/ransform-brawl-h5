// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateEnemies, defaultEnemyFile } from '@/config/enemySchema';

/**
 * enemySchema validateEnemy scale 驗證（用戶第十輪#3 怪物大小可調，翼騎 4e5d96c，additive）。
 * enemy 加 optional scale?:number(體型倍率 override，遊戲 scaleFactor = cfg.scale ?? getPerCharScale)。
 * 讀 src 4e5d96c line~129-131：`if (e.scale !== undefined) checkNum(e,'scale',...,{min:0.01})`
 *   → scale 存在時須 >0（min0.01）；缺省=不檢（走 getPerCharScale fallback）。
 * validateEnemy 是 module-private → 透過公開入口 validateEnemies 餵合法基準(defaultEnemyFile)改壞測。
 * ★鑑別點：scale 是「必須>0 的倍率」(0/負=怪不見了不合法)，跟 0-nullish 系列(能量/門檻 0 合法)語意相反——別混。
 * 維度3 斷 validate ok/errors。含壞版必紅(沒驗 scale / min 設 0)。
 * ⚠️ 遊戲端 scaleFactor 套用(setScale)接線屬狀態機(需 boot)——不補;validateEnemy scale 純驗證補足。
 */

/** 合法基準檔改某隻敵人的 scale（回整份 file + 該 key）。scale=undefined 代表刪掉該欄。 */
function fileWithScale(scale: number | string | undefined): unknown {
  const file = defaultEnemyFile();
  const key = Object.keys(file.enemies)[0];
  const e = file.enemies[key] as Record<string, unknown>;
  if (scale === undefined) delete e.scale;
  else e.scale = scale;
  return file;
}

describe('validateEnemy scale — 體型倍率驗證（必須 >0，跟能量/門檻 0 合法相反）', () => {
  it('前提：合法基準檔(defaultEnemyFile)本身 valid', () => {
    expect(validateEnemies(defaultEnemyFile()).ok).toBe(true);
  });

  it('scale 省略(undefined) → valid（不檢，走 getPerCharScale fallback）', () => {
    expect(validateEnemies(fileWithScale(undefined)).ok).toBe(true);
  });

  it('scale=1.5（正常倍率）→ valid', () => {
    expect(validateEnemies(fileWithScale(1.5)).ok).toBe(true);
  });

  it('scale=0.5 / 3.0（邊界內）→ valid', () => {
    expect(validateEnemies(fileWithScale(0.5)).ok).toBe(true);
    expect(validateEnemies(fileWithScale(3.0)).ok).toBe(true);
  });

  it('★ scale=0 → 擋（min0.01，0=怪不見了不合法；跟能量/門檻 0 合法相反）', () => {
    const r = validateEnemies(fileWithScale(0));
    expect(r.ok).toBe(false); // ★ 0 不合法(min0.01)
  });

  it('scale=-1（負）→ 擋', () => {
    expect(validateEnemies(fileWithScale(-1)).ok).toBe(false);
  });

  it('scale="big"（非數字）→ 擋', () => {
    expect(validateEnemies(fileWithScale('big')).ok).toBe(false);
  });

  it('★ scale=0.01（剛好邊界下限）→ valid（min 含等於）', () => {
    expect(validateEnemies(fileWithScale(0.01)).ok).toBe(true);
  });
});
