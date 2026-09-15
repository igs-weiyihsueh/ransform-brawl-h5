import type Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import type { DouqiItemSkill } from '@/config/douqiItemConfig';
import { DOUQI_ITEM_CONFIG } from '@/config/douqiItemConfig';
import { lightningStrikeAngles, orbitPoint, circleAoeHit, pathSamplePoints, hasVulnerableInRange, pickComboTargets, orbitLandingPoint, comboStepMs } from '@/systems/douqiItemEffectMath';
import { pointInOrientedRect } from '@/systems/comboSkillMath';
import { effectivePlayerBounds } from '@/config/mapConfig';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config/gameConfig';

/** 對敵人套 AOE 傷害（複用 PlayerControlSystem.applyDouqiAoeHit）。 */
type ApplyAoeHit = (player: GameContext['player'], enemy: Enemy, damage: number, knockback: number, fromPos: { x: number; y: number }) => void;

/**
 * DouqiItemEffects — 鬥氣道具效果執行器（2a：E 震爆/A 旋風 DOT/B 雷擊；2b：C 居合貫穿/F 噴火）。H 補血已移除。
 *
 * ★由 GameScene 建、綁 DouqiItemSystem.onPickup → trigger(skill,pid)。★不碰 DouqiControlStrategy：
 *   E/A/B/F 傷害走既有 public applyDouqiAoeHit；★C 位移走既有 Player.setPosition + ctx.scriptedControl flag
 *   （GuardEvent/TowerIntro 同機制、DouqiControlStrategy+PlayerControlSystem 已 respect scriptedControl）。只 douqi。
 * ★A/F DOT 用 scene.time.addEvent(repeat)、B/C 用 delayedCall/addEvent——非一次性；★所有 timer handle 存起來 destroy 清。
 * ★★C scriptedControl 保證所有結束路徑還原（正常結束/打斷/destroy）＝不鎖死操作。T 時停留 2c（log 佔位）。
 */
export class DouqiItemEffects {
  private readonly ctx: GameContext;
  private readonly applyAoeHit: ApplyAoeHit;
  private readonly cfg = DOUQI_ITEM_CONFIG.effect;
  /** 進行中的 timer（DOT/雷擊/跳砸/居合步進），destroy 時全清（避免撿了 timer 還跑/場景關洩漏）。 */
  private timers: Phaser.Time.TimerEvent[] = [];
  /** ★居合位移中旗標（防重入 + destroy 保證解鎖 scriptedControl）。 */
  private iaiActive = false;
  /** ★時停連斬中旗標（同 iai：防重入 + destroy 保證解鎖 scriptedControl）。 */
  private timestopActive = false;
  /** 時停暗罩 handle（destroy 清）。 */
  private dimOverlay: Phaser.GameObjects.Rectangle | null = null;

  constructor(ctx: GameContext, applyAoeHit: ApplyAoeHit) {
    this.ctx = ctx;
    this.applyAoeHit = applyAoeHit;
  }

  /**
   * 撿到道具觸發（DouqiItemSystem.onPickup 綁）。★回 boolean＝是否消耗道具。
   *   A/B/C/E/F 恆消耗(true)；T 時停 spreadRadius 內無敵空放→不消耗(false)、道具留著。
   */
  trigger(skill: DouqiItemSkill, playerId: number): boolean {
    const player = this.playerOf(playerId);
    if (!player) return true;
    switch (skill) {
      case 'E': this.doBurst(player); return true;
      case 'A': this.doWhirl(player); return true;
      case 'B': this.doThunder(player); return true;
      case 'C': this.doIai(player); return true;
      case 'F': this.doFlame(player); return true;
      case 'T': return this.doTimestop(player); // ★空放回 false（不消耗）
      default:
        return true; // 未知（H 已移除、不該進來）→消耗
    }
  }


  /** E 震爆：跳→砸→落地 radius 圓形一次性衝擊（複用 applyAoeHit + 擴張環 + hitstop + shake）。 */
  private doBurst(player: GameContext['player']): void {
    const c = this.cfg.burst;
    // 跳→砸排序（純視覺延遲；落地才判定）。
    this.after(c.jumpMs + c.slamMs, () => {
      const pos = player.getPosition();
      this.aoeCircle(player, pos.x, pos.y, c.radiusPx, c.damage, c.knockback);
      this.ctx.effects?.spawnExpandingRing?.(pos.x, pos.y, c.radiusPx, c.color, c.visualMs);
      this.ctx.effects?.triggerHitstop?.(60);
      this.ctx.effects?.shakeOnce?.(0.012, 180); // 最強擊退招→較明顯震
    });
  }

  /** A 旋風斬：以角色為心 radius 持續 DOT 圓場（★跟角色移動、每跳重讀位置）。time.addEvent repeat（非一次性）。 */
  private doWhirl(player: GameContext['player']): void {
    const c = this.cfg.whirl;
    const total = Math.floor(c.durationMs / c.tickMs); // 15 跳
    const ev = this.ctx.scene.time.addEvent({
      delay: c.tickMs,
      repeat: total - 1,
      callback: () => {
        const pos = player.getPosition(); // ★每跳重讀角色位置（DOT 場跟角色）
        this.aoeCircle(player, pos.x, pos.y, c.radiusPx, c.damagePerHit, c.knockback);
        this.ctx.effects?.spawnExpandingRing?.(pos.x, pos.y, c.radiusPx, c.color, c.tickMs); // 每跳青場閃
      },
    });
    this.timers.push(ev);
  }

  /** B 天降雷擊：蓄力→角色周圍 orbit 圈上順時針 strikes 道依序落雷（★6 道 delayedCall 依序、非一次性）。 */
  private doThunder(player: GameContext['player']): void {
    const c = this.cfg.thunder;
    const center = player.getPosition(); // 蓄力瞬間鎖角色中心（落雷點固定，不追移動＝可預期）
    const angles = lightningStrikeAngles(c.strikes, -90); // 從正上方順時針
    angles.forEach((deg, i) => {
      this.after(c.chargeMs + i * c.strikeDelayMs, () => {
        const p = orbitPoint(center.x, center.y, c.orbitRadiusPx, deg);
        this.aoeCircle(player, p.x, p.y, c.strikeRadiusPx, c.damage, c.knockback);
        this.ctx.effects?.spawnExpandingRing?.(p.x, p.y, c.strikeRadiusPx, c.color, 240); // 金落雷爆
        this.ctx.effects?.triggerHitstop?.(45);
        this.ctx.effects?.shakeOnce?.(0.007, 90);
      }); // after() 已 push 到 timers
    });
  }

  /**
   * ★T 時停（2c）：全場敵 applyStun(2s) 凍結（進度天然不流失、玩家豁免）+ 微暗罩 + 單目標連斬 9 下。
   *   ★spreadRadius 內無敵→不觸發、回 false（不消耗、道具留著）。連斬位移走既有 setPosition+scriptedControl（同 C）。
   * @returns 是否消耗道具（true=消耗、false=空放留著）。
   */
  private doTimestop(player: GameContext['player']): boolean {
    if (this.timestopActive) return true; // 進行中重撿→消耗（防重入）
    const c = this.cfg.timestop;
    const pos = player.getPosition();
    const enemies = this.ctx.getEnemies().filter((e) => !e.isDead());
    const inRange = enemies.map((e) => ({ x: e.getHitCenter().x, y: e.getHitCenter().y }));
    if (!hasVulnerableInRange(inRange, pos.x, pos.y, c.spreadRadiusPx)) return false; // ★空放不消耗
    // ① 凍全場敵（applyStun 2 秒，進度天然不流失、玩家不受影響）。
    for (const e of enemies) (e as unknown as { applyStun?: (s: number) => void }).applyStun?.(c.durationMs / 1000);
    // 微暗罩（全屏、depth15、2 秒後淡出）。
    this.dimOverlay = this.ctx.scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, c.dimColor, c.dimAlpha).setScrollFactor(0).setDepth(15);
    this.after(c.durationMs, () => this.endTimestop()); // 保險：時間到清暗罩+解鎖
    // ③ 單目標連斬 9 下（凍結同時；走既有 setPosition+scriptedControl）。
    this.timestopActive = true;
    this.ctx.scriptedControl = true;
    this.runComboDashes(player, 0);
    return true; // 消耗
  }

  /** 連斬單下（idx 0..dashes-1）：選目標→setPosition 到目標旁交替落點→hitRadius 圓命中→下一下 stepMs 後。 */
  private runComboDashes(player: GameContext['player'], idx: number): void {
    if (!this.timestopActive) return;
    const c = this.cfg.timestop;
    if (idx >= c.dashes) { this.endTimestop(); return; } // 全 9 下完→解鎖
    const pos = player.getPosition();
    const alive = this.ctx.getEnemies().filter((e) => !e.isDead());
    const withId = alive.map((e, i) => ({ x: e.getHitCenter().x, y: e.getHitCenter().y, id: i }));
    const targets = pickComboTargets(withId, pos.x, pos.y, c.dashes, c.spreadRadiusPx);
    if (targets.length === 0) { this.endTimestop(); return; } // 目標全清→提早結束解鎖
    const t = alive[targets[idx % targets.length]];
    const tc = t.getHitCenter();
    const land = orbitLandingPoint(tc.x, tc.y, c.orbitOffsetPx, idx); // 左右交替
    const b = effectivePlayerBounds();
    player.setPosition(Math.max(b.minX, Math.min(b.maxX, land.x)), Math.max(b.minY, Math.min(b.maxY, land.y))); // ★既有位移
    // hitRadius 圓命中（傷 damage×命中次數＝這裡每下一次；多下累積＝多次呼）。
    for (const e of alive) {
      const hc = e.getHitCenter();
      const tr = (e as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 0;
      if (circleAoeHit(land.x, land.y, hc.x, hc.y, c.hitRadiusPx, tr)) {
        this.applyAoeHit(player, e, c.damage, c.knockback, { x: land.x, y: land.y });
        (e as unknown as { flashWhite?: (col?: number, s?: number) => void }).flashWhite?.(0xffffff, 0.08);
      }
    }
    this.ctx.effects?.douqiSlashSwing?.(land.x, land.y, Math.atan2(tc.y - land.y, tc.x - land.x), 1.4, this.cfg.iai.color);
    this.ctx.effects?.triggerHitstop?.(40);
    this.after(comboStepMs(c.durationMs, c.dashes), () => this.runComboDashes(player, idx + 1));
  }

  /** 時停收尾：解鎖 scriptedControl + 清暗罩 + 旗標。★所有結束路徑（正常/提早/destroy）都經此＝不鎖死。 */
  private endTimestop(): void {
    if (this.dimOverlay) { const d = this.dimOverlay; this.dimOverlay = null; this.ctx.scene.tweens.add({ targets: d, alpha: 0, duration: 200, onComplete: () => d.destroy() }); }
    if (!this.timestopActive) return;
    this.timestopActive = false;
    this.ctx.scriptedControl = false; // ★保證還原
  }

  /**
   * ★C 居合貫穿（2b）：位移直線來回兩趟、沿路徑取樣圓命中。★走既有 setPosition + ctx.scriptedControl（不碰操控策略）。
   *   windup→鎖 scriptedControl→朝最近敵(無敵朝面向)高速 setPosition 推進到 distance→折返→...passes 趟→解鎖。
   *   ★★scriptedControl 保證所有結束路徑還原（正常/打斷/destroy）＝不鎖死。
   */
  private doIai(player: GameContext['player']): void {
    if (this.iaiActive) return; // 防重入
    const c = this.cfg.iai;
    const dir = this.aimDir(player); // 朝最近敵、無敵朝面向
    this.iaiActive = true;
    this.ctx.scriptedControl = true; // ★鎖操作（DouqiControlStrategy/PlayerControlSystem 已 respect→不搶位移）
    this.after(c.windupMs, () => {
      if (!this.iaiActive) return; // 期間被 destroy → 已解鎖，跳出
      this.runIaiPasses(player, dir, 0);
    });
  }

  /** 居合單趟推進（pass 0=去、1=回…）：以 timer 步進 setPosition、沿路徑取樣命中；到端點換下一趟或收尾解鎖。 */
  private runIaiPasses(player: GameContext['player'], baseDir: { x: number; y: number }, pass: number): void {
    const c = this.cfg.iai;
    if (!this.iaiActive) return;
    if (pass >= c.passes) { this.endIai(); return; } // 全趟完→解鎖
    const dir = pass % 2 === 0 ? baseDir : { x: -baseDir.x, y: -baseDir.y }; // 偶趟去、奇趟回
    const start = player.getPosition();
    const b = effectivePlayerBounds();
    const target = {
      x: Math.max(b.minX, Math.min(b.maxX, start.x + dir.x * c.distancePx)),
      y: Math.max(b.minY, Math.min(b.maxY, start.y + dir.y * c.distancePx)),
    };
    const dist = Math.hypot(target.x - start.x, target.y - start.y);
    const stepMs = 16; // ~每幀步進
    const totalMs = Math.max(stepMs, (dist / c.speedPxPerSec) * 1000);
    const steps = Math.max(1, Math.ceil(totalMs / stepMs));
    let step = 0;
    const hitThisPass = new Set<Enemy>(); // ★每趟去重
    const prevPos = { x: start.x, y: start.y };
    const ev = this.ctx.scene.time.addEvent({
      delay: stepMs,
      repeat: steps - 1,
      callback: () => {
        if (!this.iaiActive) return;
        step += 1;
        const t = step / steps;
        const nx = start.x + (target.x - start.x) * t;
        const ny = start.y + (target.y - start.y) * t;
        // 沿「上一位置→這位置」路徑取樣圓命中（膠囊近似）。
        for (const p of pathSamplePoints(prevPos.x, prevPos.y, nx, ny, c.sampleStepPx)) {
          this.lineHit(player, p.x, p.y, c.hitRadiusPx, c.damage, c.knockback, hitThisPass);
        }
        prevPos.x = nx; prevPos.y = ny;
        player.setPosition(nx, ny); // ★既有位移 API（含 footGlow 同步）
        this.ctx.effects?.douqiSlashSwing?.(nx, ny, Math.atan2(dir.y, dir.x), 1.3, c.color); // 紅斬痕
        if (step >= steps) {
          this.ctx.effects?.triggerHitstop?.(40);
          this.runIaiPasses(player, baseDir, pass + 1); // 下一趟（折返）
        }
      },
    });
    this.timers.push(ev);
  }

  /** 居合收尾：解鎖 scriptedControl + 清旗標。★所有結束路徑（正常/destroy）都經此。 */
  private endIai(): void {
    if (!this.iaiActive) return;
    this.iaiActive = false;
    this.ctx.scriptedControl = false; // ★保證還原（不鎖死操作）
  }

  /** 直線取樣點命中（每趟去重）：圓內敵 applyAoeHit。 */
  private lineHit(player: GameContext['player'], cx: number, cy: number, radius: number, dmg: number, kb: number, hitSet: Set<Enemy>): void {
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead() || hitSet.has(e)) continue;
      const hc = e.getHitCenter();
      const tr = (e as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 0;
      if (circleAoeHit(cx, cy, hc.x, hc.y, radius, tr)) {
        this.applyAoeHit(player, e, dmg, kb, { x: cx - (hc.x - cx), y: cy - (hc.y - cy) }); // 沿突進方向推
        (e as unknown as { flashWhite?: (c?: number, s?: number) => void }).flashWhite?.(0xffffff, 0.08);
        hitSet.add(e);
      }
    }
  }

  /**
   * ★F 噴火（2b）：矩形火道即時傷 + 地面燒灼 DOT 矩形（複用既有 pointInOrientedRect＝非扇形）。地面矩形固定放不跟角色。
   */
  private doFlame(player: GameContext['player']): void {
    const c = this.cfg.flame;
    const origin = player.getPosition();
    const dir = this.aimDir(player);
    const angle = Math.atan2(dir.y, dir.x);
    this.after(c.windupMs, () => {
      // ① 噴出瞬間火道（長方形 flameLength×flameWidth 即時傷）。
      this.rectHit(player, origin.x, origin.y, angle, c.flameLengthPx, c.flameWidthPx, c.burstDamage, c.burstKnockback);
      this.ctx.effects?.douqiLineWave?.(origin.x, origin.y, angle, c.flameLengthPx, c.flameWidthPx, c.color, c.sprayMs); // 橙紅火道
      this.ctx.effects?.shakeOnce?.(0.006, 90);
      // ② 地面燒灼 DOT 矩形（固定放；近端 burnStart 起、burnLength×burnWidth）。
      const bx = origin.x + Math.cos(angle) * c.burnStartPx;
      const by = origin.y + Math.sin(angle) * c.burnStartPx;
      const ev = this.ctx.scene.time.addEvent({
        delay: c.burnTickMs,
        repeat: Math.floor(c.burnDurationMs / c.burnTickMs) - 1, // 5 跳
        callback: () => {
          this.rectHit(player, bx, by, angle, c.burnLengthPx, c.burnWidthPx, c.burnTickDamage, 0);
          this.ctx.effects?.douqiLineWave?.(bx, by, angle, c.burnLengthPx, c.burnWidthPx, c.color, c.burnTickMs); // 燒灼閃
        },
      });
      this.timers.push(ev);
    });
  }

  /** 有向矩形命中（複用既有 pointInOrientedRect；origin 底邊中心、朝 angle 前向 length、半寬 width/2）。 */
  private rectHit(player: GameContext['player'], ox: number, oy: number, angle: number, length: number, width: number, dmg: number, kb: number): void {
    const halfW = width / 2;
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead()) continue;
      const hc = e.getHitCenter();
      const tr = (e as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 0;
      if (pointInOrientedRect(hc.x, hc.y, ox, oy, angle, length + tr, halfW + tr)) {
        this.applyAoeHit(player, e, dmg, kb, { x: ox, y: oy });
        (e as unknown as { flashWhite?: (c?: number, s?: number) => void }).flashWhite?.(0xffffff, 0.08);
      }
    }
  }

  /** 朝最近敵方向（單位向量）；無敵→朝角色面向（fallback）。 */
  private aimDir(player: GameContext['player']): { x: number; y: number } {
    const pos = player.getPosition();
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead()) continue;
      const hc = e.getHitCenter();
      const d = Math.hypot(hc.x - pos.x, hc.y - pos.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      const hc = best.getHitCenter();
      const len = Math.hypot(hc.x - pos.x, hc.y - pos.y) || 1;
      return { x: (hc.x - pos.x) / len, y: (hc.y - pos.y) / len };
    }
    // 無敵 fallback：朝角色面向（facing ±1 → 水平）。
    const facing = (player as unknown as { facing?: number }).facing ?? 1;
    return { x: facing >= 0 ? 1 : -1, y: 0 };
  }

  /** 圓形 AOE：對圈內可傷敵各套 applyAoeHit（fromPos=圓心→向外推）。 */
  private aoeCircle(player: GameContext['player'], cx: number, cy: number, radius: number, dmg: number, kb: number): void {
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead()) continue;
      const hc = e.getHitCenter();
      const tr = (e as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 0;
      if (circleAoeHit(cx, cy, hc.x, hc.y, radius, tr)) {
        this.applyAoeHit(player, e, dmg, kb, { x: cx, y: cy });
        (e as unknown as { flashWhite?: (c?: number, s?: number) => void }).flashWhite?.(0xffffff, 0.08);
      }
    }
  }

  private after(ms: number, cb: () => void): Phaser.Time.TimerEvent {
    const ev = this.ctx.scene.time.delayedCall(ms, cb);
    this.timers.push(ev);
    return ev;
  }

  private playerOf(pid: number): GameContext['player'] | null {
    return this.ctx.players.find((p) => p.playerId === pid) ?? null;
  }

  /** ★清所有進行中 timer（DOT/雷擊/跳砸/居合步進未觸發者）+ ★保證解鎖 scriptedControl（居合位移中場景關→不鎖死）。 */
  destroy(): void {
    for (const ev of this.timers) ev.remove(false);
    this.timers = [];
    this.endIai(); // ★保證還原 scriptedControl（不鎖死操作）
    this.endTimestop(); // ★時停中場景關→解鎖 scriptedControl+清暗罩（不鎖死）
  }
}
