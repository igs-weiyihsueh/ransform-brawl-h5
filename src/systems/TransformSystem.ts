import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import {
  HUMAN_KEY,
  ITEM_SPAWN_INTERVAL,
  MAX_ITEMS_ON_FIELD,
  MAX_SOUL_POWER,
  RECOVER_SOUL,
  SUNWUKONG_KEY,
  TRANSFORM_IFRAME,
} from '@/config/transformConfig';
import { TransformItem } from '@/entities/TransformItem';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * TransformSystem — 變身系統（凡人 ↔ 悟空，決策 15fec2a4）。
 *
 * 道具：週期生成 TransformItem（場上最多 MAX_ITEMS_ON_FIELD）+ debug 鍵手動生。
 *   每幀距離判定撿取：未變身撿到 → 變身；已變身撿到 → 回復魂力 +RECOVER_SOUL。
 * 變身：換悟空 visual（Player.switchCharacter）→ EnergySystem 自動吃 Full 模式 + 倍率 1.0
 *   （EnergySystem 依 player.getCharacterKey() 決定模式/倍率，換角即換）；金光閃 + 1s iframe。
 * 持續＝魂力（非計時器）：變身時滿 100；變身中受敵人攻擊改扣魂力（掛 Player 的 soulDamageSink）；
 *   魂力歸 0 → Detransform（換回凡人 visual、EnergySystem 回 HumanSimple、藏魂力環）。
 *
 * UI：提供 isTransformed()/getSoulRatio() 給魂力環（fill=soul/max，變身顯示、退變藏）。
 */
export class TransformSystem implements GameSystem {
  readonly name = 'TransformSystem';
  private ctx!: GameContext;

  private transformed = false;
  private soul = 0;
  private items: TransformItem[] = [];
  private spawnTimer = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.spawnTimer = ITEM_SPAWN_INTERVAL;
  }

  update(dt: number): void {
    // debug 鍵：手動生一個道具（沿用 InputSystem 的切敵人鍵之外，這裡用 respawn? 不行——用專屬 API）。
    // 為不佔用既有 debug 鍵，週期生成為主；DebugSystem 之後可加鍵呼叫 spawnItem()。
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnItem();
      this.spawnTimer = ITEM_SPAWN_INTERVAL;
    }

    // 撿取判定（距離）。
    const playerPos = this.ctx.player.getPosition();
    for (const item of this.items) {
      if (!item.isPicked() && item.isInPickupRange(playerPos)) {
        this.onPickup(item);
      }
    }
    this.items = this.items.filter((it) => !it.isPicked());
  }

  /** 生成一個變身道具（場上未達上限才生）。可被 debug 呼叫。 */
  spawnItem(): void {
    if (this.items.length >= MAX_ITEMS_ON_FIELD) return;
    const margin = 120;
    const x = Phaser.Math.Between(margin, GAME_WIDTH - margin);
    const y = Phaser.Math.Between(margin, GAME_HEIGHT - margin);
    this.items.push(new TransformItem(this.ctx.scene, x, y));
  }

  private onPickup(item: TransformItem): void {
    item.pickUp();
    if (this.transformed) {
      // 已變身：回復魂力（clamp）。
      this.soul = Math.min(MAX_SOUL_POWER, this.soul + RECOVER_SOUL);
    } else {
      this.transform();
    }
  }

  /** 變身：凡人 → 悟空。 */
  private transform(): void {
    this.transformed = true;
    this.soul = MAX_SOUL_POWER;
    const player = this.ctx.player;
    player.switchCharacter(SUNWUKONG_KEY); // EnergySystem 自動切 Full + 倍率 1.0
    player.playTransformFlash(TRANSFORM_IFRAME);
    // 掛受擊扣魂力鉤子：變身中被打改扣魂力。
    player.setSoulDamageSink((dmg) => this.takeSoulDamage(dmg));
  }

  /** 退變：悟空 → 凡人（魂力歸 0 觸發）。 */
  private detransform(): void {
    this.transformed = false;
    this.soul = 0;
    const player = this.ctx.player;
    player.setSoulDamageSink(null); // 清鉤子
    player.switchCharacter(HUMAN_KEY); // EnergySystem 自動回 HumanSimple + 倍率 0.5
    player.playTransformFlash(TRANSFORM_IFRAME);
  }

  /** 變身中受敵人攻擊：扣魂力；歸 0 → 退變。 */
  private takeSoulDamage(damage: number): void {
    if (!this.transformed) return;
    this.soul = Math.max(0, this.soul - damage);
    if (this.soul <= 0) {
      this.detransform();
    }
  }

  destroy(): void {
    for (const it of this.items) it.destroy();
    this.items = [];
    this.ctx?.player.setSoulDamageSink(null);
  }

  // --- UI / 狀態查詢 ---
  isTransformed(): boolean {
    return this.transformed;
  }

  getSoul(): number {
    return this.soul;
  }

  /** 魂力顯示比例 0..1（退變時 0）。 */
  getSoulRatio(): number {
    return this.transformed ? this.soul / MAX_SOUL_POWER : 0;
  }
}
