import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { Vec2 } from '@/systems/hitDetection';
import type { FireRainPreset } from '@/config/fireRainConfig';
import { pickFireRainPoint, playersInStrike } from '@/systems/fireRainMath';

/** 一道進行中的火雨（預警中 or 已落下待清）。 */
interface Strike {
  pos: Vec2;
  warning: number; // 預警剩餘秒數；<=0 落下
  ring: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  struck: boolean;
}

/**
 * FireRainSystem — 天降火雨（#10 + #4 事件驅動）。
 *
 * 觸發：讀 WaveSystem.getActiveFireRainPreset()（用戶#4 由 Event 節點 preset 驅動）：
 *  - 純火雨 Event 節點 → 該火雨 preset；守護波+attachFireRain → 標準 FireRain；否則不降。
 * 循環：每 interval 齊落 burstCount 道 → 預警圈(warningTime) → 火柱範圍傷害
 * （只傷玩家、不擊退、不傷敵人/守護雕像）。落點縮邊+不重疊+maxConcurrent 上限。純視覺/傷害讀取。
 */
export class FireRainSystem implements GameSystem {
  readonly name = 'FireRainSystem';
  private ctx!: GameContext;
  private active = false;
  private spawnCooldown = 0;
  private strikes: Strike[] = [];
  /** 宣告字播放中（Unity FireRainTextUI 序列：演完才落第一道火雨）。 */
  private announcing = false;
  /** 目前這場火雨用的參數 preset（由 WaveSystem 節點 preset 決定）。 */
  private preset: FireRainPreset | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    // 觸發條件：讀節點 preset（#4 事件驅動）→ 有 preset 開火雨、無則停並清乾淨。
    const preset = this.ctx.wave.getActiveFireRainPreset?.() ?? null;
    const shouldRun = preset !== null;
    if (shouldRun && !this.active) this.start(preset!);
    else if (!shouldRun && this.active) this.stop();
    if (!this.active || !this.preset) return;

    // 宣告字「天降火雨！」演出中：先不落火雨（Unity 序列：演完才降）。
    if (this.announcing) return;

    // 每 interval 齊落 burstCount 道。
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = this.preset.intervalSec;
      for (let i = 0; i < this.preset.burstCount; i += 1) this.trySpawnStrike();
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

  private start(preset: FireRainPreset): void {
    this.active = true;
    this.preset = preset;
    this.spawnCooldown = 0; // 立即第一批
    this.strikes = [];
    // 火雨宣告字（只在每場火雨開始這一次）：左滑進→停3s→右滑出，演完才落第一道火雨。
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
    this.preset = null;
    for (const s of this.strikes) s.ring.destroy();
    this.strikes = [];
  }

  private activePoints(): Vec2[] {
    return this.strikes.map((s) => s.pos);
  }

  private trySpawnStrike(): void {
    const p = this.preset!;
    const pos = pickFireRainPoint(
      this.activePoints(),
      Math.random,
      p.radiusPx,
      p.edgeMarginPx,
      p.maxConcurrent,
    );
    if (!pos) return; // 額度滿/太近 → 這道略過
    const ring = this.ctx.effects.fireWarningRing(pos.x, pos.y, p.radiusPx);
    this.strikes.push({ pos, warning: p.warningSec, ring, struck: false });
  }

  private resolveStrike(s: Strike): void {
    const p = this.preset!;
    s.struck = true;
    s.ring.destroy();
    this.ctx.effects.fireStrikeFlash(s.pos.x, s.pos.y, p.radiusPx);
    // 範圍傷害：只傷圈內玩家（不傷敵人/守護雕像），不擊退。
    const players = this.ctx.players;
    const centers = players.map((pl) => pl.getHitCenter());
    for (const idx of playersInStrike(s.pos, centers, p.radiusPx)) {
      players[idx].takeHit?.(p.damage, 'fireRain'); // 只傷玩家、不擊退（Player.takeHit 無擊退參數）
    }
  }

  destroy(): void {
    this.stop();
  }
}
