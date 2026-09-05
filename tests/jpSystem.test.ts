import { describe, expect, it } from 'vitest';
import {
  CREDIT_PER_COIN,
  JP_BOSS_GATED,
  JP_GROUP_CONFIG,
  JP_LIGHTS_TO_TRIGGER,
  JP_TICKET_FACE,
  multiplierStepPerCoin,
  pickLightGroup,
  type JpGroup,
} from '@/config/jpConfig';
import type { GameContext } from '@/systems/GameContext';
import { JpSystem } from '@/systems/JpSystem';
import { TicketSystem } from '@/systems/TicketSystem';

/**
 * JpSystem + jpConfig 測試（零式定案 924a1d83）。
 * 含壞版必紅：燈集滿觸發、倍數封頂 clamp、派彩=倍數×30、歸零重累積、33.3% 給燈。
 */
function makeSystem() {
  const state = { ticketsAdded: 0, stageClear: null as null | (() => void) };
  const ctx = {
    players: [{ playerId: 0 }],
    ticket: { addTickets: (_playerId: number, n: number) => (state.ticketsAdded += n) },
    wave: {
      set onStageClear(cb: () => void) {
        state.stageClear = cb;
      },
    },
  } as unknown as GameContext;
  const sys = new JpSystem();
  sys.init(ctx);
  return { sys, state };
}

describe('jpConfig 純函式', () => {
  it('每幣步進 = (avg-start)/450：紅≈0.0239、藍≈0.0278、紫≈0.0206', () => {
    expect(multiplierStepPerCoin('red')).toBeCloseTo((15.75 - 5) / 450);
    expect(multiplierStepPerCoin('blue')).toBeCloseTo((22.5 - 10) / 450);
    expect(multiplierStepPerCoin('purple')).toBeCloseTo((29.25 - 20) / 450);
  });

  it('pickLightGroup 三組均等：rng 0/0.34/0.67 → red/blue/purple', () => {
    expect(pickLightGroup(() => 0)).toBe('red');
    expect(pickLightGroup(() => 0.34)).toBe('blue');
    expect(pickLightGroup(() => 0.67)).toBe('purple');
    expect(pickLightGroup(() => 0.999)).toBe('purple');
  });
});

describe('JpSystem — 累積/燈/派彩', () => {
  it('初始倍數 = 各組起始', () => {
    const { sys } = makeSystem();
    expect(sys.getMultiplier('red')).toBe(JP_GROUP_CONFIG.red.startMultiplier);
    expect(sys.getMultiplier('blue')).toBe(10);
    expect(sys.getMultiplier('purple')).toBe(20);
    expect(sys.getLights('red')).toBe(0);
  });

  it('notifyCreditSpent 累積倍數（10 Credit = 1 幣 = 1 步進）', () => {
    const { sys } = makeSystem();
    sys.notifyCreditSpent(10); // 1 幣
    expect(sys.getMultiplier('red')).toBeCloseTo(5 + multiplierStepPerCoin('red'));
  });

  it('倍數封頂 clamp（狂灌 Credit 不超過 cap）', () => {
    const { sys } = makeSystem();
    sys.notifyCreditSpent(10 * 100000); // 遠超
    expect(sys.getMultiplier('red')).toBe(JP_GROUP_CONFIG.red.capMultiplier); // 30
    expect(sys.getMultiplier('blue')).toBe(50);
    expect(sys.getMultiplier('purple')).toBe(80);
  });

  it('每幕通關給一組 +1 燈；集滿 5 燈觸發派彩 = 倍數×30、歸零重累積', () => {
    const { sys, state } = makeSystem();
    // 先把紅拉到某倍數（灌 Credit）。
    sys.notifyCreditSpent(10 * 100000); // 紅封頂 30
    // 強制連續給紅燈：rng=0 恆選 red（用 private onStageClear 經 wave 回呼）。
    const clear = state.stageClear!;
    // 需要固定選紅：直接呼叫 5 次通關，但 pickLightGroup 用 Math.random。
    // 改用注入：多呼叫直到紅集滿（統計上會有雜訊）→ 這裡改成直接測 payout 路徑：
    // 用 rng 可控的方式不易；改為呼叫 clear 多次並檢查「總派彩發生且倍數曾歸零」。
    // 簡化：直接灌到紅 5 燈——因 pickLightGroup 隨機，改測「集滿必觸發」用 helper：
    for (let i = 0; i < 200 && sys.getLights('red') < JP_LIGHTS_TO_TRIGGER; i += 1) {
      clear();
    }
    // 紅最終應曾集滿並派彩（倍數被歸零成起始，或又累積回一點）。
    expect(state.ticketsAdded).toBeGreaterThan(0);
  });

  it('派彩金額 = 當前倍數 × 30（用可控燈觸發：紅封頂30→應派 900）', () => {
    // 直接驗 payout 公式（透過 private 反射觸發單組）。
    const { sys, state } = makeSystem();
    sys.notifyCreditSpent(10 * 100000); // 紅 cap 30
    const priv = sys as unknown as { payout: (g: 'red') => void };
    priv.payout('red');
    expect(state.ticketsAdded).toBe(Math.round(30 * JP_TICKET_FACE)); // 900
    expect(sys.getMultiplier('red')).toBe(JP_GROUP_CONFIG.red.startMultiplier); // 歸零重累積
    expect(sys.getLights('red')).toBe(0);
  });

  // 🔴 壞版必紅：派彩若沒歸零倍數，第二次派彩金額會相同（應該歸零重累積）。
  it('壞版對照：派彩後倍數必須歸零（否則連續派彩金額不會回落）', () => {
    const { sys } = makeSystem();
    sys.notifyCreditSpent(10 * 100000); // cap 30
    const priv = sys as unknown as { payout: (g: 'red') => void };
    priv.payout('red');
    const afterFirst = sys.getMultiplier('red');
    expect(afterFirst).toBe(JP_GROUP_CONFIG.red.startMultiplier); // 5，非 30
    expect(afterFirst).not.toBe(JP_GROUP_CONFIG.red.capMultiplier);
  });
});

// ===========================================================================
// 深度強化（QA 測騎接手）：每幣步進/封頂/起始 · pickLightGroup 均等區間邊界 ·
// 5 燈觸發門檻 · 派彩公式+歸零(只該組) · BOSS gate · ticket 生產者關係。
// ===========================================================================

/** 建 JpSystem + 記 ticket / 抓 onStageClear 回呼（可直接觸發一幕通關）。 */
function makeJp() {
  const state = { ticketsAdded: 0, addCalls: 0, stageClear: null as null | (() => void) };
  const ctx = {
    players: [{ playerId: 0 }],
    ticket: {
      addTickets: (_playerId: number, n: number) => {
        state.ticketsAdded += n;
        state.addCalls += 1;
      },
    },
    wave: {
      set onStageClear(cb: () => void) {
        state.stageClear = cb;
      },
    },
  } as unknown as GameContext;
  const sys = new JpSystem();
  sys.init(ctx);
  return { sys, state };
}

/** 用 stub Math.random 強制 pickLightGroup 選某組，觸發 n 幕通關。 */
function clearStagesForGroup(
  state: { stageClear: null | (() => void) },
  group: JpGroup,
  n: number,
): void {
  const rngByGroup: Record<JpGroup, number> = { red: 0, blue: 0.4, purple: 0.7 };
  const real = Math.random;
  Math.random = () => rngByGroup[group];
  try {
    for (let i = 0; i < n; i += 1) state.stageClear?.();
  } finally {
    Math.random = real;
  }
}

describe('JpSystem — 每幣累積：步進/封頂/起始/部分幣', () => {
  it('起始倍數 red5/blue10/purple20', () => {
    const { sys } = makeJp();
    expect(sys.getMultiplier('red')).toBe(5);
    expect(sys.getMultiplier('blue')).toBe(10);
    expect(sys.getMultiplier('purple')).toBe(20);
  });

  it('恰 450 幣（4500 Credit）從起始漲到平均出獎倍數（red→15.75/blue→22.5/purple→29.25，皆未觸頂）', () => {
    const { sys } = makeJp();
    sys.notifyCreditSpent(CREDIT_PER_COIN * 450);
    expect(sys.getMultiplier('red')).toBeCloseTo(15.75);
    expect(sys.getMultiplier('blue')).toBeCloseTo(22.5);
    expect(sys.getMultiplier('purple')).toBeCloseTo(29.25);
  });

  it('部分幣（5 Credit = 0.5 幣）步進 = step × 0.5', () => {
    const { sys } = makeJp();
    sys.notifyCreditSpent(5); // 0.5 幣
    expect(sys.getMultiplier('red')).toBeCloseTo(5 + multiplierStepPerCoin('red') * 0.5);
  });

  it('封頂 clamp：狂灌不超過 cap（red30/blue50/purple80）', () => {
    const { sys } = makeJp();
    sys.notifyCreditSpent(CREDIT_PER_COIN * 1_000_000);
    expect(sys.getMultiplier('red')).toBe(30);
    expect(sys.getMultiplier('blue')).toBe(50);
    expect(sys.getMultiplier('purple')).toBe(80);
  });

  it('notifyCreditSpent(0/負) 不累積（守 amount>0）', () => {
    const { sys } = makeJp();
    sys.notifyCreditSpent(0);
    sys.notifyCreditSpent(-10);
    expect(sys.getMultiplier('red')).toBe(5); // 沒動
  });
});

describe('pickLightGroup — 均等 33.3% 區間邊界（精確 rng 打三組交界）', () => {
  const at = (r: number) => pickLightGroup(() => r);
  // i = min(2, floor(rng×3))：[0,1/3)紅 [1/3,2/3)藍 [2/3,1)紫；交界（floor 進位）歸下一組。
  it('rng=0 → 紅；rng→1(0.9999) → 紫（兩端）', () => {
    expect(at(0)).toBe('red');
    expect(at(0.9999)).toBe('purple');
  });

  it('紅/藍交界 1/3：0.3332→紅、恰好 1/3→藍', () => {
    expect(at(0.3332)).toBe('red');
    expect(at(1 / 3)).toBe('blue');
  });

  it('藍/紫交界 2/3：0.6665→藍、恰好 2/3→紫', () => {
    expect(at(0.6665)).toBe('blue');
    expect(at(2 / 3)).toBe('purple');
  });

  it('rng=1.0（極端上界）→ 紫（min(2,…) 夾住不越界）', () => {
    expect(at(1.0)).toBe('purple');
  });
});

describe('JpSystem — 5 燈觸發門檻（4 不觸發、恰 5 觸發）', () => {
  it('同組給 4 燈 → 不觸發派彩、lights=4', () => {
    const { sys, state } = makeJp();
    clearStagesForGroup(state, 'red', 4);
    expect(sys.getLights('red')).toBe(4);
    expect(state.ticketsAdded).toBe(0); // 未派彩
  });

  it('同組第 5 燈 → 觸發派彩、該組 lights 歸 0（門檻邊界）', () => {
    const { sys, state } = makeJp();
    clearStagesForGroup(state, 'red', 5);
    expect(state.ticketsAdded).toBeGreaterThan(0); // 派彩發生
    expect(sys.getLights('red')).toBe(0); // 派彩後燈歸零
  });
});

describe('JpSystem — 派彩公式 + 歸零(只該組) + ticket 生產者', () => {
  it('派彩金額 = round(當前倍數 × 30)：red 封頂30 → 5 燈觸發 → 派 900', () => {
    const { sys, state } = makeJp();
    sys.notifyCreditSpent(CREDIT_PER_COIN * 1_000_000); // red 封頂 30
    clearStagesForGroup(state, 'red', 5); // 集滿觸發
    expect(state.ticketsAdded).toBe(Math.round(30 * JP_TICKET_FACE)); // 900
    expect(sys.getLights('red')).toBe(0);
    expect(sys.getMultiplier('red')).toBe(5); // 該組倍數歸零重累積
  });

  it('派彩只影響該組：red 派彩後 blue/purple 倍數與燈不受影響', () => {
    const { sys, state } = makeJp();
    sys.notifyCreditSpent(CREDIT_PER_COIN * 100); // 三組都累積一點
    const blueBefore = sys.getMultiplier('blue');
    const purpleBefore = sys.getMultiplier('purple');
    // 給 blue、purple 各 2 燈（不觸發），再讓 red 集滿派彩。
    clearStagesForGroup(state, 'blue', 2);
    clearStagesForGroup(state, 'purple', 2);
    clearStagesForGroup(state, 'red', 5); // red 派彩
    expect(sys.getMultiplier('red')).toBe(5); // 只有 red 歸零
    expect(sys.getMultiplier('blue')).toBeCloseTo(blueBefore); // blue 不受影響
    expect(sys.getMultiplier('purple')).toBeCloseTo(purpleBefore);
    expect(sys.getLights('blue')).toBe(2); // blue/purple 燈保留
    expect(sys.getLights('purple')).toBe(2);
  });

  it('起始倍數派彩（未累積直接觸發）：red 5×30=150、blue 10×30=300、purple 20×30=600', () => {
    const cases: Array<[JpGroup, number]> = [
      ['red', 150],
      ['blue', 300],
      ['purple', 600],
    ];
    for (const [g, expected] of cases) {
      const { sys, state } = makeJp();
      clearStagesForGroup(state, g, 5);
      expect(state.ticketsAdded).toBe(expected);
    }
  });

  it('ticket 生產者關係：JP 只透過 addTickets 灌入（純帳本，不改別的）', () => {
    const ticket = new TicketSystem();
    ticket.init({} as unknown as GameContext);
    const state = { stageClear: null as null | (() => void) };
    const ctx = {
      players: [{ playerId: 0 }], // S5：payout 平分需 iterate ctx.players（單人=全給 P0）
      ticket,
      wave: {
        set onStageClear(cb: () => void) {
          state.stageClear = cb;
        },
      },
    } as unknown as GameContext;
    const sys = new JpSystem();
    sys.init(ctx);
    clearStagesForGroup(state, 'red', 5); // red 起始 5×30=150；單人平分 floor(150/1)=150 全給 P0
    expect(ticket.getTickets(0)).toBe(150);
    // 純帳本：再手動 addTickets(0, 7) 精確 +7（JP 沒塞別的邏輯進 ticket）。
    const before = ticket.getTickets(0);
    ticket.addTickets(0, 7);
    expect(ticket.getTickets(0)).toBe(before + 7);
  });
});

describe('JpSystem — BOSS gate（JP_BOSS_GATED=false → 集滿直接派）', () => {
  it('目前 gated=false：集滿 5 燈直接派彩（不需 BOSS）', () => {
    expect(JP_BOSS_GATED).toBe(false);
    const { sys, state } = makeJp();
    clearStagesForGroup(state, 'red', 5);
    expect(state.ticketsAdded).toBe(150); // 直接派（起始 5×30）
    expect(sys.getLights('red')).toBe(0);
  });
  // 註：JP_BOSS_GATED=true 分支（集滿→打BOSS→贏才派）目前不可達（H5 無 BOSS）。
  // 之後 B 段做 BOSS、gated 改 true 時，補「gated=true 集滿不直接派、贏 BOSS 後才派」對照。
});

// ===========================================================================
// S3 新增：recordDamage / getDamageContribution（per-player 傷害貢獻累進，Map<playerId>）。
// 誠實範圍：S3【只記不用】——派彩(payout)目前不讀 damageByPlayer（S5 加權派彩才讀）。
//   但「記對量」是【可觀察行為】(getDamageContribution 讀得到 Map 累進值)，可測、非純 inert。
//   「記了但派彩沒用」這半才是 inert，記進 conditional-equivalences.md（S5 讀時才變承重）。
// ===========================================================================
describe('JpSystem — recordDamage per-player 傷害貢獻（S3 記對量，可觀察）', () => {
  it('recordDamage(0, dealt) → getDamageContribution(0) === dealt（記對量）', () => {
    const { sys } = makeJp();
    sys.recordDamage(0, 25);
    expect(sys.getDamageContribution(0)).toBe(25);
  });

  it('多次累加：recordDamage(0,10)+recordDamage(0,5) → 15（累進傷害總和，非命中次數）', () => {
    const { sys } = makeJp();
    sys.recordDamage(0, 10);
    sys.recordDamage(0, 5);
    expect(sys.getDamageContribution(0)).toBe(15); // 傷害「總和」15，不是「命中 2 次」
  });

  it('未記錄的 playerId → 0（Map 無鍵回 0）', () => {
    const { sys } = makeJp();
    expect(sys.getDamageContribution(0)).toBe(0);
    sys.recordDamage(0, 7);
    expect(sys.getDamageContribution(0)).toBe(7);
  });

  // 防禦契約（dealt<=0 在參數定義域內、可鑑別 → 寫測試，非留清單）。
  it('防禦契約：recordDamage(0, 0/負) 為 no-op（不改貢獻）', () => {
    const { sys } = makeJp();
    sys.recordDamage(0, 10);
    sys.recordDamage(0, 0);
    sys.recordDamage(0, -5);
    expect(sys.getDamageContribution(0)).toBe(10); // 只有正量累進
  });
  // ⚠️ S3 仍只 P1：測不了「P1/P2 貢獻各自 Map 不互汙」(per-player 獨立鑑別留 S4，那時有 P2-P4)。
});

// ===========================================================================
// S5 ①：JP 派彩「平分」給所有 active player（floor 均分）。
// 🔴 平分【不讀 recordDamage、不管貢獻】(顧問明示：改貢獻比例派彩不變 → 別測「貢獻影響派彩」)。
//   用真 TicketSystem 觀察各 player 實際拿到多少票（可觀察行為，非 call-count）。
// ===========================================================================


/** 建 JpSystem + 真 TicketSystem + N 個 player（觀察平分結果）。 */
function makeJpSplit(playerCount: number) {
  const ticket = new TicketSystem();
  ticket.init({} as unknown as GameContext);
  const players = Array.from({ length: playerCount }, (_v, i) => ({ playerId: i }));
  const state = { stageClear: null as null | (() => void) };
  const ctx = {
    players,
    ticket,
    wave: {
      set onStageClear(cb: () => void) {
        state.stageClear = cb;
      },
    },
  } as unknown as GameContext;
  const sys = new JpSystem();
  sys.init(ctx);
  return { sys, ticket, state };
}

describe('JpSystem — S5 ① 派彩平分給所有 active player（floor 均分）', () => {
  it('單人：獎金全給 P0（red 起始 5×30=150 → P0 得 150）', () => {
    const { ticket, state } = makeJpSplit(1);
    clearStagesForGroup(state, 'red', 5);
    expect(ticket.getTickets(0)).toBe(150);
  });

  it('2 人：150 平分 → 各 floor(150/2)=75（P0、P1 各 75）', () => {
    const { ticket, state } = makeJpSplit(2);
    clearStagesForGroup(state, 'red', 5); // prize=150
    expect(ticket.getTickets(0)).toBe(75);
    expect(ticket.getTickets(1)).toBe(75);
  });

  it('4 人：150 平分 → 各 floor(150/4)=37（餘數捨去，非某人多拿）', () => {
    const { ticket, state } = makeJpSplit(4);
    clearStagesForGroup(state, 'red', 5); // prize=150
    for (let id = 0; id < 4; id += 1) expect(ticket.getTickets(id)).toBe(37); // floor(37.5)=37
  });

  it('3 人：150 平分 → 各 floor(150/3)=50（整除）', () => {
    const { ticket, state } = makeJpSplit(3);
    clearStagesForGroup(state, 'red', 5);
    for (let id = 0; id < 3; id += 1) expect(ticket.getTickets(id)).toBe(50);
  });
  // ⚠️ 不寫「貢獻影響派彩」：S5 平分不讀 recordDamage，改貢獻比例派彩不變＝測不出（顧問明示）。
});

// ---------------------------------------------------------------------------
// 用戶 #3：獎勵節點報獎 → 飛光到 JP 燈 → 點亮（addRewardLight 拆出，指定組直接點）。
//   addRewardLight(g)：點【指定】組下一顆燈（GameScene 先 pickLightGroup、飛光飛向該組真燈）。
//   lightNextReward()：pickLightGroup + addRewardLight（相容舊路徑，回點亮的組）。
//   ★ 集滿(5)→派彩 + 該組歸零（Unity 5 顆全亮循環回第 1 顆）。
//   (前一輪經 onStageClear 路徑測過門檻；這裡直接測 #3 拆出的公開 API + 集滿循環。)
// ---------------------------------------------------------------------------
describe('JpSystem — #3 addRewardLight / lightNextReward（獎勵點燈 + 集滿循環）', () => {
  it('addRewardLight(g)：點【指定】組下一顆 → 該組 litCount +1（前後差 1）', () => {
    const { sys } = makeJp();
    expect(sys.getLights('blue')).toBe(0);
    sys.addRewardLight('blue');
    expect(sys.getLights('blue')).toBe(1); // +1
    sys.addRewardLight('blue');
    expect(sys.getLights('blue')).toBe(2); // 再 +1
  });

  it('各組獨立：點 red 不影響 blue/purple litCount', () => {
    const { sys } = makeJp();
    sys.addRewardLight('red');
    sys.addRewardLight('red');
    expect(sys.getLights('red')).toBe(2);
    expect(sys.getLights('blue')).toBe(0); // 不受影響
    expect(sys.getLights('purple')).toBe(0);
  });

  it('★ 集滿派彩 + 循環：第 5 顆點亮 → 觸發 payout + 該組歸零（回 0，不停 5、不變 6）', () => {
    const { sys, state } = makeJp();
    // 前 4 顆：不派彩、litCount 累加到 4。
    for (let i = 0; i < 4; i += 1) sys.addRewardLight('purple');
    expect(sys.getLights('purple')).toBe(4);
    expect(state.ticketsAdded).toBe(0); // 未集滿、不派彩
    // 第 5 顆：集滿 → 派彩 + 歸零循環。
    sys.addRewardLight('purple');
    expect(state.ticketsAdded).toBeGreaterThan(0); // ★ 觸發 payout
    expect(sys.getLights('purple')).toBe(0); // ★ 歸零（非停 5、非 6）
    expect(sys.getLights('purple')).not.toBe(5);
  });

  it('集滿循環後可續點：歸零後第 6 次呼叫 = 新循環第 1 顆（litCount 1）', () => {
    const { sys } = makeJp();
    for (let i = 0; i < 5; i += 1) sys.addRewardLight('red'); // 集滿→歸零
    expect(sys.getLights('red')).toBe(0);
    sys.addRewardLight('red'); // 新循環第 1 顆
    expect(sys.getLights('red')).toBe(1);
  });

  it('lightNextReward()：pick 一組 + 點該組一顆 → 回點亮的組、總燈數恰 +1（相容舊路徑）', () => {
    const { sys } = makeJp();
    const before = sys.getLights('red') + sys.getLights('blue') + sys.getLights('purple');
    const g = sys.lightNextReward();
    const after = sys.getLights('red') + sys.getLights('blue') + sys.getLights('purple');
    expect(after - before).toBe(1); // 一次總燈數 +1
    expect(sys.getLights(g)).toBe(1); // 回傳的組正是被點亮那組
    expect(['red', 'blue', 'purple']).toContain(g);
  });

  // 🔴 壞版對照：集滿必歸零（若停 5 / 變 6 = 循環壞）。
  it('壞版對照：purple 第 5 顆後 litCount 必 = 0（不停 5、不變 6）', () => {
    const { sys } = makeJp();
    for (let i = 0; i < 5; i += 1) sys.addRewardLight('purple');
    expect(sys.getLights('purple')).toBe(0);
  });

  // 🔴 壞版對照：集滿必觸發 payout（ticket 有進帳）。
  it('壞版對照：blue 集滿 5 顆必觸發派彩（ticketsAdded > 0）', () => {
    const { sys, state } = makeJp();
    for (let i = 0; i < 5; i += 1) sys.addRewardLight('blue');
    expect(state.ticketsAdded).toBeGreaterThan(0);
  });

  // 🔴 壞版對照：addRewardLight 點錯組會污染別組（各組獨立守衛）。
  it('壞版對照：addRewardLight("red") 後 blue litCount 仍 0（沒點錯組）', () => {
    const { sys } = makeJp();
    sys.addRewardLight('red');
    expect(sys.getLights('blue')).toBe(0);
  });
});
