import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { Vec2 } from '@/systems/hitDetection';
import { FIRE_RAIN, pickFireRainPoint, playersInStrike } from '@/systems/fireRainMath';

/** 一道進行中的火雨（預警中 or 已落下待清）。 */
interface Strike {
  pos: Vec2;
  warning: number; // 預警剩餘秒數；<=0 落下
  ring: Phaser.GameObjects.Graphics;
  struck: boolean;
}

/**
 * FireRainSystem — 天降火雨（#10，對應 Unity WaveModifierRunner FireRain）。
 *
 * 啟用條件：目前先掛「守護波進行中」自動觸發（零 schema 改動；待異靈確認掛法）。
 * 循環：每 interval(1.5s) 齊落 burstCount 道 → 每道預警紅圈(warningTime 1s) → 火柱範圍傷害
 * （半徑 100px，**只傷玩家** damage 1、不擊退、不傷敵人/守護雕像）。落點縮邊+不重疊+maxConcurrent 上限。
 * 純視覺/傷害讀取，不改波次邏輯。
 */
export class FireRainSystem implements GameSystem {
  readonly name = 'FireRainSystem';
  private ctx!: GameContext;
  private active = false;
  private spawnCooldown = 0;
  private strikes: Strike[] = [];
  /** 宣告字播放中（Unity FireRainTextUI 序列：演完才落第一道火雨）。 */
  private announcing = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    // 觸發條件：守護波進行中 → 開火雨；出守護波 → 停並清乾淨。
    const guard = this.ctx.wave.getGuardEvent?.();
    const shouldRun = !!guard && !guard.isFinished();
    if (shouldRun && !this.active) this.start();
    else if (!shouldRun && this.active) this.stop();
    if (!this.active) return;

    // 宣告字「天降火雨！」演出中：先不落火雨（Unity 序列：演完才降）。
    if (this.announcing) return;

    // 每 interval 齊落 burstCount 道。
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = FIRE_RAIN.intervalSec;
      for (let i = 0; i < FIRE_RAIN.burstCount; i += 1) this.trySpawnStrike();
    }

    // 推進每道預警 → 落下。
    for (const s of this.strikes) {
      if (s.struck) continue;
      s.warning -= dt;
      if (s.warning <= 0) this.resolveStrike(s);
    }
    // 清掉已落下的（騰出並發額度）。
    this.strikes = this.strikes.filter((s) => !s.struck);
  }

  private start(): void {
    this.active = true;
    this.spawnCooldown = 0; // 立即第一批
    this.strikes = [];
    // 火雨宣告字（只在每場守護波火雨開始這一次）：左滑進→停3s→右滑出，演完才落第一道火雨。
    if (typeof this.ctx.effects.fireRainAnnounce === 'function') {
      this.announcing = true;
      this.ctx.effects.fireRainAnnounce(() => {
        this.announcing = false;
        this.spawnCooldown = 0; // 宣告演完 → 立刻落第一批
      });
    } else {
      this.announcing = false; // 無宣告字 API（後備）→ 直接開始火雨
    }
  }

  private stop(): void {
    this.active = false;
    this.announcing = false;
    for (const s of this.strikes) s.ring.destroy();
    this.strikes = [];
  }

  private activePoints(): Vec2[] {
    return this.strikes.map((s) => s.pos);
  }

  private trySpawnStrike(): void {
    const pos = pickFireRainPoint(this.activePoints(), Math.random);
    if (!pos) return; // 額度滿/太近 → 這道略過
    const ring = this.ctx.effects.fireWarningRing(pos.x, pos.y, FIRE_RAIN.radiusPx);
    this.strikes.push({ pos, warning: FIRE_RAIN.warningSec, ring, struck: false });
  }

  private resolveStrike(s: Strike): void {
    s.struck = true;
    s.ring.destroy();
    this.ctx.effects.fireStrikeFlash(s.pos.x, s.pos.y, FIRE_RAIN.radiusPx);
    // 範圍傷害：只傷圈內玩家（不傷敵人/守護雕像），damage 1、不擊退。
    const players = this.ctx.players;
    const centers = players.map((p) => p.getHitCenter());
    for (const idx of playersInStrike(s.pos, centers, FIRE_RAIN.radiusPx)) {
      players[idx].takeHit?.(FIRE_RAIN.damage, 'fireRain'); // 只傷玩家、不擊退（Player.takeHit 無擊退參數）
    }
  }

  destroy(): void {
    this.stop();
  }
}
