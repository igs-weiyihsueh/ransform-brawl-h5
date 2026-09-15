import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config/gameConfig';
import { DOUQI_TOWER_EVENT_CONFIG, DOUQI_LEVEL_CONFIG } from '@/config/douqiConfig';
import { levelScale } from '@/systems/douqiLevelMath';
import { fanGroupCenters, fanHitIndex, telegraphRadiusPx, fillProgress } from '@/systems/douqiTowerFanMath';

/**
 * DouqiTowerEvent — 鬥氣塔事件（第3關，階段 4 commit1）。照 towerRingSkill pattern：
 *   塔為圓心的**形狀區域填滿預警(fillMs)→幾何判定命中→效果(damage+定身 root)**（扇形 sector 取代 annulus 環帶）。
 *
 * ★v45：塔本體(baseHp×wave 成長×teamLevel scale、中心、不被推、可打)+塔生怪(每 800ms 生 2 隻塔周圍)+
 *   四大扇形 fanBlast(count4 arcDeg48 radius520 fillMs2000 damage24 rootMs2000 cycleMs3200、正↔斜十字交替、留 42°縫)。
 * ★打掉塔＝事件完成（塔死走 onEnemyKilled 單一路徑→notifyTowerDead 清預警不誤發，我方單一 takeHit 路徑天然滿足海牛「兩擊殺路徑都清」）。
 * ★只 douqi 事件用；normal 不建（DouqiSpawnSystem 只 douqi 註冊）。玩家無血量→塔傷走既有二段能量倒扣(onPlayerHit)+applyStun 定身。
 */
export class DouqiTowerEvent {
  private readonly ctx: GameContext;
  private readonly cfg = DOUQI_TOWER_EVENT_CONFIG;
  private readonly getTeamLevel: () => number;
  private readonly onPlayerHitEnergy: (playerId: number) => void; // 塔扇形命中→二段能量倒扣（沿用既有）

  private tower: Enemy | null = null;
  private center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private towerMaxHp = 1;
  private active = false;

  // 塔生怪節奏。
  private spawnAccumMs = 0;
  // 扇形循環：cycle 計時 + 當前 group（0 正 / 1 斜交替）+ 是否預警中 + 預警已過 ms + 已 fired 標記。
  private cycleAccumMs = 0;
  private fanGroup = 0;
  private telegraphing = false;
  private telegraphMs = 0;
  private readonly fanGfx: Phaser.GameObjects.Graphics;

  constructor(
    ctx: GameContext,
    getTeamLevel: () => number,
    onPlayerHitEnergy: (playerId: number) => void,
  ) {
    this.ctx = ctx;
    this.getTeamLevel = getTeamLevel;
    this.onPlayerHitEnergy = onPlayerHitEnergy;
    this.fanGfx = ctx.scene.add.graphics().setDepth(60); // 世界層（跟隨場景、非 scrollFactor0）
  }

  /** 事件啟動：場地中心生塔（HP=base×wave 成長×teamLevel scale、不放環狀技）。 */
  start(currentWave: number): void {
    this.center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    const waveMult = 1 + (currentWave - 1) * this.cfg.hpGrowthPerWave;
    const hpScale = levelScale(DOUQI_LEVEL_CONFIG.difficultyLv1.enemyHp, this.getTeamLevel(), DOUQI_LEVEL_CONFIG.cap);
    this.towerMaxHp = Math.max(1, Math.round(this.cfg.baseHp * waveMult * hpScale));
    // 生塔：ringOverride 給 ringCount 0＝不放既有環狀技（塔攻擊全走本事件四扇形）。
    this.tower = this.ctx.spawner.spawnTower(this.center.x, this.center.y, this.towerMaxHp, { ringCount: 0 });
    this.active = true;
    this.spawnAccumMs = 0;
    this.cycleAccumMs = 0;
    this.fanGroup = 0;
    this.telegraphing = false;
    this.telegraphMs = 0;
  }

  /** 事件是否已完成（塔死）。 */
  isComplete(): boolean {
    return this.active && (this.tower == null || this.tower.isDead());
  }

  /** 塔當前 HP / 最大（HUD 血條）。 */
  getTowerHpRatio(): number {
    if (!this.tower || this.tower.isDead()) return 0;
    const hp = (this.tower as unknown as { getHp?: () => number }).getHp?.() ?? 0;
    return Math.max(0, Math.min(1, hp / this.towerMaxHp));
  }

  /** 每幀（DouqiSpawnSystem 於 event=tower 呼）。 */
  update(dt: number): void {
    if (!this.active) return;
    if (!this.tower || this.tower.isDead()) {
      // 塔死＝事件完成：清預警不誤發（★單一 takeHit 路徑＝海牛兩擊殺路徑都清的等價保證）。
      this.clearTelegraph();
      return;
    }
    const dtMs = dt * 1000;
    this.tickSpawn(dtMs);
    this.tickFanBlast(dtMs);
  }

  /** 塔生怪：每 spawnIntervalMs 生 spawnBatch 隻於塔周圍 spawnAroundPx（無視波次配額，塔死即停）。 */
  private tickSpawn(dtMs: number): void {
    this.spawnAccumMs += dtMs;
    if (this.spawnAccumMs < this.cfg.spawnIntervalMs) return;
    this.spawnAccumMs = 0;
    const b = this.ctx.worldBounds;
    for (let i = 0; i < this.cfg.spawnBatch; i += 1) {
      const ang = Math.random() * Math.PI * 2;
      const r = this.cfg.spawnAroundPx * (0.5 + Math.random() * 0.5);
      const x = Math.max(b.x + 40, Math.min(b.x + b.width - 40, this.center.x + Math.cos(ang) * r));
      const y = Math.max(b.y + 40, Math.min(b.y + b.height - 40, this.center.y + Math.sin(ang) * r));
      this.ctx.spawner.spawn('Enemy_Rush', x, y); // 一般近戰；事件怪不計 quota（notifyKill 塔關不推進）
    }
  }

  /** 四扇形：cycle 計時→開預警(填滿 fillMs 漸長)→填滿瞬間發射判定(damage+root)→清→下 cycle 換 group。 */
  private tickFanBlast(dtMs: number): void {
    if (!this.telegraphing) {
      this.cycleAccumMs += dtMs;
      if (this.cycleAccumMs >= this.cfg.fanCycleMs) {
        this.cycleAccumMs = 0;
        this.telegraphing = true;
        this.telegraphMs = 0;
      } else {
        this.clearTelegraph();
        return;
      }
    }
    // 預警中：漸長畫扇形。
    this.telegraphMs += dtMs;
    this.drawTelegraph();
    if (fillProgress(this.telegraphMs, this.cfg.fanFillMs) >= 1) {
      // 填滿瞬間發射判定 + 定身 + 二段能量倒扣。
      this.fire();
      this.telegraphing = false;
      this.telegraphMs = 0;
      this.fanGroup = (this.fanGroup + 1) % 2; // 正↔斜交替
      this.clearTelegraph();
    }
  }

  /** 畫當前組四扇形預警（半徑漸長 telegraphRadiusPx，越接近填滿越紅/顯）。 */
  private drawTelegraph(): void {
    const g = this.fanGfx;
    g.clear();
    const p = fillProgress(this.telegraphMs, this.cfg.fanFillMs);
    const rad = telegraphRadiusPx(this.telegraphMs, this.cfg.fanFillMs, this.cfg.fanRadiusPx);
    const centers = fanGroupCenters(this.fanGroup, this.cfg.fanCount);
    const half = (this.cfg.fanArcDeg / 2) * (Math.PI / 180);
    const alpha = 0.18 + 0.32 * p; // 越滿越顯
    const color = p > 0.85 ? 0xff5555 : 0xffaa33; // 快填滿轉紅
    g.fillStyle(color, alpha);
    for (const cDeg of centers) {
      const cRad = (cDeg * Math.PI) / 180;
      g.beginPath();
      g.moveTo(this.center.x, this.center.y);
      g.arc(this.center.x, this.center.y, rad, cRad - half, cRad + half, false);
      g.closePath();
      g.fillPath();
    }
    // ★選配：2px 薄外框（更精緻輪廓；填滿越滿越顯）。
    g.lineStyle(2, color, 0.5 + 0.1 * p);
    for (const cDeg of centers) {
      const cRad = (cDeg * Math.PI) / 180;
      g.beginPath();
      g.moveTo(this.center.x, this.center.y);
      g.arc(this.center.x, this.center.y, rad, cRad - half, cRad + half, false);
      g.closePath();
      g.strokePath();
    }
  }

  private clearTelegraph(): void {
    this.fanGfx.clear();
  }

  /** 填滿瞬間發射：對每個玩家判定（距塔≤radius+玩家半徑 且 角度落扇形±arcDeg/2）→命中定身+二段能量倒扣。 */
  private fire(): void {
    if (!this.tower || this.tower.isDead()) return; // ★死了不放環/不判定（釋放前檢查 active）
    const centers = fanGroupCenters(this.fanGroup, this.cfg.fanCount);
    for (const player of this.ctx.players) {
      const pos = player.getPosition();
      const pr = (player as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 20;
      const hit = fanHitIndex(this.center, { x: pos.x, y: pos.y }, pr, centers, this.cfg.fanArcDeg, this.cfg.fanRadiusPx);
      if (hit >= 0) {
        (player as unknown as { applyStun?: (s: number) => void }).applyStun?.(this.cfg.fanRootMs / 1000);
        this.onPlayerHitEnergy(player.playerId); // 塔傷＝二段能量倒扣（角色無血量，沿用既有 onPlayerHit 語意）
      }
    }
    // ★telegraph 強化：釋放瞬間擴張環（塔中心炸開到扇形範圍）+ 震動（塔原本沒震動）。純視覺，只 douqi 塔釋放呼。
    this.ctx.effects?.spawnExpandingRing?.(this.center.x, this.center.y, this.cfg.fanRadiusPx, 0xff5555, 260);
    this.ctx.effects?.shakeOnce?.(0.009, 130);
  }

  /** 清理（事件結束/場景關）。塔本身由 spawner registry 管（清場一併清）。 */
  destroy(): void {
    this.active = false;
    this.fanGfx.destroy();
    this.tower = null;
  }
}
