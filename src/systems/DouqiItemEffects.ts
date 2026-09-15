import type Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import type { DouqiItemSkill } from '@/config/douqiItemConfig';
import { DOUQI_ITEM_CONFIG } from '@/config/douqiItemConfig';
import { SECOND_TRANSFORM_CONFIG } from '@/config/combatConfig';
import { lightningStrikeAngles, orbitPoint, circleAoeHit } from '@/systems/douqiItemEffectMath';

/** 對敵人套 AOE 傷害（複用 PlayerControlSystem.applyDouqiAoeHit）。 */
type ApplyAoeHit = (player: GameContext['player'], enemy: Enemy, damage: number, knockback: number, fromPos: { x: number; y: number }) => void;

/**
 * DouqiItemEffects — 鬥氣道具效果執行器（階段2a：H 補能量 / E 震爆 / A 旋風 DOT / B 雷擊）。
 *
 * ★由 GameScene 建、綁 DouqiItemSystem.onPickup → trigger(skill,pid)。★不碰 DouqiControlStrategy
 *   （applyDouqiAoeHit 已 public、補能量走 transform.accumulateSecondTransform）。只 douqi。
 * ★A DOT 用 scene.time.addEvent(repeat)、B 6 道 delayedCall 依序——★非一次性；所有 timer handle 存起來 destroy 清（道具撿了 timer 還在跑/場景關）。
 * C/F/T 留 2b/2c（trigger 時 log 佔位）。
 */
export class DouqiItemEffects {
  private readonly ctx: GameContext;
  private readonly applyAoeHit: ApplyAoeHit;
  private readonly cfg = DOUQI_ITEM_CONFIG.effect;
  /** 進行中的 timer（DOT/雷擊/跳砸），destroy 時全清（避免撿了 timer 還跑/場景關洩漏）。 */
  private timers: Phaser.Time.TimerEvent[] = [];

  constructor(ctx: GameContext, applyAoeHit: ApplyAoeHit) {
    this.ctx = ctx;
    this.applyAoeHit = applyAoeHit;
  }

  /** 撿到道具觸發（DouqiItemSystem.onPickup 綁）。依 skill 分派；C/F/T 留後階段。 */
  trigger(skill: DouqiItemSkill, playerId: number): void {
    const player = this.playerOf(playerId);
    if (!player) return;
    switch (skill) {
      case 'H': this.doHeal(playerId, player); break;
      case 'E': this.doBurst(player); break;
      case 'A': this.doWhirl(player); break;
      case 'B': this.doThunder(player); break;
      default:
        // C 居合(2b)/F 噴火(2b)/T 時停(2c)：佔位 log。
        // eslint-disable-next-line no-console
        console.log(`[DouqiItemEffect] ${skill} 效果待後續階段（2b/2c）`);
    }
  }

  /** H 補血＝回二段變身能量（我方無血量、能量＝生命資源）；+ 綠光圈 + 「+N」跳字。 */
  private doHeal(playerId: number, player: GameContext['player']): void {
    const amount = SECOND_TRANSFORM_CONFIG.fillThreshold * this.cfg.healEnergyRatio;
    this.ctx.transform.accumulateSecondTransform?.(playerId, amount); // clamp 到 fillThreshold 內建
    const pos = player.getPosition();
    this.ctx.effects?.spawnExpandingRing?.(pos.x, pos.y, 44, 0x2ecc71, 420); // 綠光圈
    this.floatText(pos.x, pos.y - 20, `+${Math.round(amount * 100)}`, '#5ef08a'); // +N 跳字（能量%）
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
      const ev = this.after(c.chargeMs + i * c.strikeDelayMs, () => {
        const p = orbitPoint(center.x, center.y, c.orbitRadiusPx, deg);
        this.aoeCircle(player, p.x, p.y, c.strikeRadiusPx, c.damage, c.knockback);
        this.ctx.effects?.spawnExpandingRing?.(p.x, p.y, c.strikeRadiusPx, c.color, 240); // 金落雷爆
        this.ctx.effects?.triggerHitstop?.(45);
        this.ctx.effects?.shakeOnce?.(0.007, 90);
      });
      this.timers.push(ev);
    });
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

  /** 綠色「+N」上飄跳字（純視覺）。 */
  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.ctx.scene.add.text(x, y, text, { fontFamily: 'Arial, sans-serif', fontSize: '22px', color, fontStyle: 'bold' }).setOrigin(0.5, 0.5).setDepth(2100);
    this.ctx.scene.tweens.add({ targets: t, y: y - 48, alpha: 0, duration: 620, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private after(ms: number, cb: () => void): Phaser.Time.TimerEvent {
    return this.ctx.scene.time.delayedCall(ms, cb);
  }

  private playerOf(pid: number): GameContext['player'] | null {
    return this.ctx.players.find((p) => p.playerId === pid) ?? null;
  }

  /** ★清所有進行中 timer（DOT/雷擊/跳砸未觸發者），場景關/系統 destroy 呼。 */
  destroy(): void {
    for (const ev of this.timers) ev.remove(false);
    this.timers = [];
  }
}
