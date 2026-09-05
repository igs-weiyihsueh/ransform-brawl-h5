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

  /** 每玩家變身狀態（Map<playerId>）。S3 只有 P1，一筆退化成舊單一 state。 */
  private states = new Map<number, { transformed: boolean; soul: number }>();
  private items: TransformItem[] = [];
  private spawnTimer = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.spawnTimer = ITEM_SPAWN_INTERVAL;
    this.states.clear();
  }

  private stateOf(playerId: number): { transformed: boolean; soul: number } {
    let s = this.states.get(playerId);
    if (!s) {
      s = { transformed: false, soul: 0 };
      this.states.set(playerId, s);
    }
    return s;
  }

  update(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnItem();
      this.spawnTimer = ITEM_SPAWN_INTERVAL;
    }

    // 撿取判定（距離）。S3：只 P1 撿。
    const player = this.ctx.player;
    const playerPos = player.getPosition();
    for (const item of this.items) {
      if (!item.isPicked() && item.isInPickupRange(playerPos)) {
        this.onPickup(item, player);
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

  private onPickup(item: TransformItem, player: GameContext['player']): void {
    item.pickUp();
    const s = this.stateOf(player.playerId);
    if (s.transformed) {
      s.soul = Math.min(MAX_SOUL_POWER, s.soul + RECOVER_SOUL);
    } else {
      this.transform(player);
    }
  }

  /** 變身：凡人 → 悟空。 */
  private transform(player: GameContext['player']): void {
    const s = this.stateOf(player.playerId);
    s.transformed = true;
    s.soul = MAX_SOUL_POWER;
    player.switchCharacter(SUNWUKONG_KEY);
    player.playTransformFlash(TRANSFORM_IFRAME);
    player.setSoulDamageSink((dmg) => this.takeSoulDamage(player, dmg));
  }

  /** 退變：悟空 → 凡人（魂力歸 0 觸發）。 */
  private detransform(player: GameContext['player']): void {
    const s = this.stateOf(player.playerId);
    s.transformed = false;
    s.soul = 0;
    player.setSoulDamageSink(null);
    player.switchCharacter(HUMAN_KEY);
    player.playTransformFlash(TRANSFORM_IFRAME);
  }

  /** 變身中受敵人攻擊：扣魂力；歸 0 → 退變。 */
  private takeSoulDamage(player: GameContext['player'], damage: number): void {
    const s = this.stateOf(player.playerId);
    if (!s.transformed) return;
    s.soul = Math.max(0, s.soul - damage);
    if (s.soul <= 0) {
      this.detransform(player);
    }
  }

  destroy(): void {
    for (const it of this.items) it.destroy();
    this.items = [];
    this.ctx?.player.setSoulDamageSink(null);
  }

  // --- UI / 狀態查詢 ---
  isTransformed(playerId: number): boolean {
    return this.stateOf(playerId).transformed;
  }

  getSoul(playerId: number): number {
    return this.stateOf(playerId).soul;
  }

  /** 魂力顯示比例 0..1（退變時 0）。 */
  getSoulRatio(playerId: number): number {
    const s = this.stateOf(playerId);
    return s.transformed ? s.soul / MAX_SOUL_POWER : 0;
  }
}
