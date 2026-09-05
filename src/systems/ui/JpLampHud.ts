import Phaser from 'phaser';
import { PANEL_DEPTH, UI_ICONS } from '@/config/uiConfig';
import { JP_GROUPS, JP_LIGHTS_TO_TRIGGER, type JpGroup } from '@/config/jpConfig';

/**
 * JpLampHud — JP 燈號 HUD（用戶 #3 收尾，對照 Unity JPLampController 機台 jackpot 三層燈）。
 *
 * 畫面左上顯示 3 組（JP1/JP2/JP3＝紅/藍/紫）× 每組 5 顆燈，反映 JpSystem 各組 litCount：
 * 已亮=該組識別色亮燈、未亮=暗。獎勵飛光飛到「該組下一顆燈」的螢幕位置 → 到達點亮（看得到燈號增加）。
 *
 * 純顯示層：只讀 JpSystem.getLights(group)，不改數值。scrollFactor 0（固定螢幕）、depth 面板層。
 */

/** HUD 版面（螢幕左上，機台三層感）。 */
const HUD = {
  x: 24,
  y: 150,
  rowGap: 46,
  lampGap: 40,
  lampRadius: 13,
  labelWidth: 54,
} as const;

/** 三組識別色（亮燈色）。 */
const GROUP_COLOR: Record<JpGroup, number> = {
  red: 0xff4d4d,
  blue: 0x4d8cff,
  purple: 0xb44dff,
};
const GROUP_LABEL: Record<JpGroup, string> = {
  red: 'JP1',
  blue: 'JP2',
  purple: 'JP3',
};
const LAMP_OFF = 0x2a2a3a;

export class JpLampHud {
  private readonly scene: Phaser.Scene;
  /** 每顆燈的 Graphics（[group][lampIndex]），每幀依 litCount 重畫亮/暗。 */
  private lamps: Record<JpGroup, Phaser.GameObjects.Graphics[]> = {
    red: [],
    blue: [],
    purple: [],
  };
  /** 每顆燈的螢幕中心座標（飛光終點用）。 */
  private lampPos: Record<JpGroup, { x: number; y: number }[]> = {
    red: [],
    blue: [],
    purple: [],
  };
  private shownLit: Record<JpGroup, number> = { red: -1, blue: -1, purple: -1 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  private build(): void {
    // 底板。
    const totalW = HUD.labelWidth + JP_LIGHTS_TO_TRIGGER * HUD.lampGap + 16;
    const totalH = JP_GROUPS.length * HUD.rowGap + 12;
    const bg = this.scene.add.graphics().setScrollFactor(0).setDepth(PANEL_DEPTH);
    bg.fillStyle(0x0d0d1a, 0.6);
    bg.fillRoundedRect(HUD.x - 12, HUD.y - 26, totalW, totalH, 10);
    bg.lineStyle(2, 0xffd24d, 0.5);
    bg.strokeRoundedRect(HUD.x - 12, HUD.y - 26, totalW, totalH, 10);

    JP_GROUPS.forEach((g, row) => {
      const cy = HUD.y + row * HUD.rowGap;
      // 組標籤 JP1/JP2/JP3。
      this.scene.add
        .text(HUD.x, cy, GROUP_LABEL[g], {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: '18px',
          color: '#ffe64d',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH + 1);
      for (let i = 0; i < JP_LIGHTS_TO_TRIGGER; i += 1) {
        const cx = HUD.x + HUD.labelWidth + i * HUD.lampGap + HUD.lampRadius;
        const lamp = this.scene.add.graphics().setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
        this.lamps[g].push(lamp);
        this.lampPos[g].push({ x: cx, y: cy });
      }
    });
  }

  /** 每幀依 JpSystem 各組 litCount 重畫（僅在數值變動時重繪）。 */
  update(litOf: (g: JpGroup) => number): void {
    for (const g of JP_GROUPS) {
      const lit = litOf(g);
      if (lit === this.shownLit[g]) continue;
      this.shownLit[g] = lit;
      this.lamps[g].forEach((lamp, i) => {
        const pos = this.lampPos[g][i];
        lamp.clear();
        const on = i < lit;
        lamp.fillStyle(on ? GROUP_COLOR[g] : LAMP_OFF, 1);
        lamp.fillCircle(pos.x, pos.y, HUD.lampRadius);
        lamp.lineStyle(2, on ? 0xffffff : 0x555566, on ? 0.9 : 0.5);
        lamp.strokeCircle(pos.x, pos.y, HUD.lampRadius);
      });
    }
  }

  /**
   * 該組「下一顆要亮的燈」的螢幕座標（飛光終點）：index = 目前 litCount（0-based 下一顆）。
   * litCount 已滿(≥5)→回該組第 1 顆（循環，Unity 5 全亮→回第1）。取不到→回 undefined。
   */
  getNextLampAnchor(g: JpGroup, litCount: number): { x: number; y: number } | undefined {
    const idx = litCount >= JP_LIGHTS_TO_TRIGGER ? 0 : litCount;
    return this.lampPos[g][idx];
  }
}

/** UI_ICONS.lamp 供未來可換成燈泡貼圖（目前用色圓，保留引用避免 lint 未用）。 */
export const JP_LAMP_ICON_KEY = UI_ICONS.lamp.key;
