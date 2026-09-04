import {
  BUFF_DURATION,
  HELMET_ABILITIES,
  type BuffId,
} from '@/config/buffConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * HelmetSystem — 頭盔道具能力（對照 Unity）。
 *
 * H5 現況：用 debug H 鍵「撿一個隨機能力頭盔」= EquipHelmet → 套一個計時能力（預設 8s，
 * 用 BuffSystem 框架；重撿覆蓋＝重置計時）。頭部 sprite 換裝視覺先簡化（先做能力生效 + 提示）。
 * 能力效果整合點：
 *  - MoveSpeed / Dash：PlayerControl 讀 buff.isActive 套倍率。
 *  - Shield：Player.takeHit 讀 buff.isActive 免疫。
 *  - Lightning / Freeze：PlayerControl 命中時套敵人定身/連鎖（見 PlayerControlSystem）。
 */
export class HelmetSystem implements GameSystem {
  readonly name = 'HelmetSystem';
  private ctx!: GameContext;
  private lastEquipped: BuffId | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(_dt: number): void {
    // debug：H 鍵撿一個隨機能力頭盔。
    if (this.ctx.input.justPressedHelmet()) {
      this.equipRandom();
    }
  }

  /** 撿隨機能力頭盔（debug）。 */
  equipRandom(): void {
    const ability =
      HELMET_ABILITIES[Math.floor(Math.random() * HELMET_ABILITIES.length)];
    this.equip(ability);
  }

  /** 裝備某能力頭盔：套計時 buff（預設 8s；重裝覆蓋重置計時）。 */
  equip(ability: BuffId): void {
    this.lastEquipped = ability;
    this.ctx.buff.apply({
      id: ability,
      duration: BUFF_DURATION[ability],
      onApply: () => console.info(`[Helmet] 裝備能力 ${ability}（${BUFF_DURATION[ability]}s）`),
      onExpire: () => console.info(`[Helmet] 能力 ${ability} 到期`),
    });
  }

  /** debug：最近裝備的能力。 */
  getLastEquipped(): BuffId | null {
    return this.lastEquipped;
  }
}
