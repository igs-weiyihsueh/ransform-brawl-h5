// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveItemOwner, type ItemSource } from '@/systems/itemGuideMath';

/**
 * resolveItemOwner — 道具 owner 依來源分配（用戶三輪#6 隨機道具全標藍回歸根治，翼騎 202eb0f）。
 * 真因：H5 道具只有週期 timer 隨機刷一種來源，上輪 #7 round-robin 把全部標 owner → 隨機道具全標藍。
 * 修為依 source 語意：random 無主、initial/kill 有主。
 * 簽章(讀 src 202eb0f)：resolveItemOwner(source:'initial'|'kill'|'random', ownerPlayerId?:number) → number|null。
 * 邏輯：random → null；else ownerPlayerId ?? null。
 * 維度3 斷 owner 值(playerId | null)。含壞版必紅（random 無主 / 有主歸屬 / 沒給防呆）。
 * ⚠️ spawnItem 依 owner 是否 null 決定 setOwner/入 queue 屬狀態機接線(需 boot,翼騎量化 hasBorder random=false/kill=true 驗過)、箭頭顯示屬狀態機——不補;此純函式補足。
 */
describe('resolveItemOwner — 道具 owner 依來源（random 無主 / initial·kill 有主）', () => {
  it('★ source="random" → null（週期隨機刷無主，不標色/不箭頭，#6 真因核心）', () => {
    expect(resolveItemOwner('random', 0)).toBeNull(); // 即使誤帶 owner，random 仍無主
    expect(resolveItemOwner('random', 2)).toBeNull();
    expect(resolveItemOwner('random')).toBeNull();
  });

  it('★ source="initial" + ownerPlayerId=0 → 0（登場初始有主；0 是合法 playerId 非 nullish）', () => {
    expect(resolveItemOwner('initial', 0)).toBe(0);
  });

  it('source="kill" + ownerPlayerId=2 → 2（擊落掉落歸擊殺者）', () => {
    expect(resolveItemOwner('kill', 2)).toBe(2);
  });

  it('initial 各 playerId 原樣回傳（1/3）', () => {
    expect(resolveItemOwner('initial', 1)).toBe(1);
    expect(resolveItemOwner('kill', 3)).toBe(3);
  });

  it('★ initial/kill 但沒給 ownerPlayerId → null（防呆，不亂標）', () => {
    expect(resolveItemOwner('initial')).toBeNull();
    expect(resolveItemOwner('kill')).toBeNull();
    expect(resolveItemOwner('initial', undefined)).toBeNull();
  });

  it('值域完整：random 恆 null；initial/kill 帶 owner→該值、缺→null', () => {
    const sources: ItemSource[] = ['initial', 'kill', 'random'];
    for (const s of sources) {
      expect(resolveItemOwner(s)).toBeNull(); // 全都沒給 owner → null
    }
    expect(resolveItemOwner('random', 1)).toBeNull(); // random 忽略 owner
    expect(resolveItemOwner('initial', 1)).toBe(1);
  });

  // ── 階段2/武器變身：新增無主來源 heroDrop / weapon（比照 random，自由撿） ──
  it('★ source="heroDrop" → null（怪掉英雄道具無主，自由撿；即使誤帶 owner 仍 null）', () => {
    expect(resolveItemOwner('heroDrop')).toBeNull();
    expect(resolveItemOwner('heroDrop', 0)).toBeNull(); // 誤帶 owner 仍無主
    expect(resolveItemOwner('heroDrop', 2)).toBeNull();
  });

  it('★ source="weapon" → null（武器指定變身道具無主，比照 heroDrop 自由撿；誤帶 owner 仍 null）', () => {
    // 壞版對照：若 weapon 誤判成有主（漏進 null 分支）→ 帶 owner 會回該值 → 此測紅。
    expect(resolveItemOwner('weapon')).toBeNull();
    expect(resolveItemOwner('weapon', 0)).toBeNull(); // 0 是合法 playerId，若誤有主會回 0 → 鑑別誤判
    expect(resolveItemOwner('weapon', 3)).toBeNull();
  });
});
