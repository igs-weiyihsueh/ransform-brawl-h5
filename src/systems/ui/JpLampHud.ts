import Phaser from 'phaser';
import { JP_PANEL_LAYOUT, PANEL_DEPTH, jpLightOffsetsX, resolveJpTransform } from '@/config/uiConfig';
import { JP_GROUPS, JP_LIGHTS_TO_TRIGGER, type JpGroup } from '@/config/jpConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/**
 * JpLampHud — JP 介面（對齊 Unity JPPanel：畫面中央橫幅 + 三組金/橘/紫 + 每組數字框 + 5 燈）。
 *
 * 版面照 Unity 規格（JP_PANEL_LAYOUT）：中央 1600×300 深藍黑橫幅，三組水平排
 * （左金 JP1 / 中橘 JP2 / 右紫 JP3，對應 JP_GROUPS[red,blue,purple]）。每組：
 *  - 主題色外框 + 深黑底的金額框，中央 90px 大字金額（主題色，讀 JpSystem 倍數）。
 *  - 數字下方 5 顆實心圓燈（未點亮=該組暗色，點亮=主題亮色），反映 JpSystem litCount。
 *
 * 整體變換：所有元素放進一個容器，套 resolveJpTransform(scale/位置 override)——
 * 用戶可整體縮小/挪位（內部相對佈局不變）。getNextLampAnchor 透過容器 world matrix
 * 回傳「變換後」的螢幕座標，飛光終點跟著 scale/位置走，不會飛錯位。
 *
 * 純顯示層：只讀 JpSystem（litOf/amountOf），不改數值。scrollFactor 0（固定螢幕）。
 * 公開 API（GameScene 依賴，勿改簽章）：constructor(scene[, transform])、
 * update(litOf[, amountOf])、getNextLampAnchor(group, litCount)。
 */

/** 組色（依 JP_GROUPS 順序對應 JP_PANEL_LAYOUT.groups）。 */
type GroupStyle = { cx: number; cy: number; themeColor: number; dimColor: number };

/** JP 面板整體變換 override（大小/位置，開放編輯器可調）。 */
export interface JpTransformOverride {
  panelScale?: number;
  panelOffsetX?: number;
  panelOffsetY?: number;
}

export class JpLampHud {
  private readonly scene: Phaser.Scene;
  /** 承載全部 JP 元素的容器（整體 scale/位置變換套在此）。 */
  private readonly container: Phaser.GameObjects.Container;
  private readonly styleOf: Record<JpGroup, GroupStyle> = {} as Record<JpGroup, GroupStyle>;
  /** 每組金額文字。 */
  private amountText: Record<JpGroup, Phaser.GameObjects.Text> = {} as Record<JpGroup, Phaser.GameObjects.Text>;
  /** 每組 5 顆燈的 Graphics。 */
  private lamps: Record<JpGroup, Phaser.GameObjects.Graphics[]> = { red: [], blue: [], purple: [] };
  /** 每顆燈的容器內 local 座標（世界座標由容器 transform 換算）。 */
  private lampPos: Record<JpGroup, { x: number; y: number }[]> = { red: [], blue: [], purple: [] };
  private shownLit: Record<JpGroup, number> = { red: -1, blue: -1, purple: -1 };
  private shownAmount: Record<JpGroup, number> = { red: -1, blue: -1, purple: -1 };

  constructor(scene: Phaser.Scene, transform?: JpTransformOverride) {
    this.scene = scene;
    // 容器固定螢幕、面板深度；整體變換套 override（大小/位置）。
    // transform 未傳 → 讀 uiLayout override(編輯器存的 layout.jp)，讓用戶調的大小/位置自動生效。
    const t = resolveJpTransform(transform ?? readJpOverride());
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH);
    this.container.setScale(t.scale);
    this.container.setPosition(t.posX, t.posY);
    this.build();
  }

  private build(): void {
    const L = JP_PANEL_LAYOUT;

    // 中央橫幅底板（深藍黑半透明）。
    const bg = this.scene.add.graphics();
    bg.fillStyle(L.panel.bgColor, L.panel.bgAlpha);
    bg.fillRect(L.panel.x, L.panel.y, L.panel.width, L.panel.height);
    this.container.add(bg);

    const offsets = jpLightOffsetsX(L.lights.count, L.lights.gap);

    JP_GROUPS.forEach((g, idx) => {
      const gs = L.groups[idx] ?? L.groups[0];
      this.styleOf[g] = gs;

      // 金額框：外框（主題色）+ 深黑底。
      const a = L.amount;
      const box = this.scene.add.graphics();
      const bx = gs.cx - a.borderWidth / 2;
      const by = gs.cy + a.borderOffsetY - a.borderHeight / 2;
      box.fillStyle(gs.themeColor, a.borderAlpha);
      box.fillRoundedRect(bx, by, a.borderWidth, a.borderHeight, a.cornerRadius);
      const ix = gs.cx - a.bgWidth / 2;
      const iy = gs.cy + a.borderOffsetY - a.bgHeight / 2;
      box.fillStyle(a.bgColor, a.bgAlpha);
      box.fillRoundedRect(ix, iy, a.bgWidth, a.bgHeight, a.cornerRadius);
      this.container.add(box);

      // 金額大字（主題色，置中）。
      this.amountText[g] = this.scene.add
        .text(gs.cx, gs.cy + a.textOffsetY, '0', {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: a.fontSize,
          color: colorHex(gs.themeColor),
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      this.container.add(this.amountText[g]);

      // 5 顆實心圓燈（數字下方一排）。
      this.lamps[g] = [];
      this.lampPos[g] = [];
      for (let i = 0; i < L.lights.count; i += 1) {
        const cx = gs.cx + offsets[i];
        const cy = gs.cy + L.lights.posY;
        const lamp = this.scene.add.graphics();
        this.container.add(lamp);
        this.lamps[g].push(lamp);
        this.lampPos[g].push({ x: cx, y: cy });
      }
    });
  }

  /**
   * 每幀刷新：依 JpSystem 各組 litCount（+ 選配金額）重畫（僅數值變動才重繪）。
   * @param litOf 各組已點亮燈數（0..5）。
   * @param amountOf 各組金額（選配；Unity JPAmount，讀 JpSystem 倍數）。
   */
  update(litOf: (g: JpGroup) => number, amountOf?: (g: JpGroup) => number): void {
    const L = JP_PANEL_LAYOUT;
    for (const g of JP_GROUPS) {
      const gs = this.styleOf[g];
      // 燈。
      const lit = litOf(g);
      if (lit !== this.shownLit[g]) {
        this.shownLit[g] = lit;
        this.lamps[g].forEach((lamp, i) => {
          const pos = this.lampPos[g][i];
          const on = i < lit;
          lamp.clear();
          lamp.fillStyle(on ? gs.themeColor : gs.dimColor, 1);
          lamp.fillCircle(pos.x, pos.y, L.lights.radius);
          lamp.lineStyle(L.lights.strokeWidth, on ? 0xffffff : 0x000000, on ? 0.9 : 0.4);
          lamp.strokeCircle(pos.x, pos.y, L.lights.radius);
        });
      }
      // 金額。
      if (amountOf) {
        const amt = Math.max(0, Math.floor(amountOf(g)));
        if (amt !== this.shownAmount[g]) {
          this.shownAmount[g] = amt;
          this.amountText[g].setText(`${amt}`);
        }
      }
    }
  }

  /**
   * 該組「下一顆要亮的燈」的螢幕座標（飛光終點）：index = 目前 litCount（0-based 下一顆）。
   * 透過容器 world matrix 換算 → 回傳「變換後（含 scale/位置）」的螢幕座標，飛光終點跟著走。
   * litCount 已滿(≥5)→回第 1 顆（循環）。取不到→回 undefined。
   */
  getNextLampAnchor(g: JpGroup, litCount: number): { x: number; y: number } | undefined {
    const idx = litCount >= JP_LIGHTS_TO_TRIGGER ? 0 : litCount;
    const local = this.lampPos[g]?.[idx];
    if (!local) return undefined;
    const p = this.container
      .getWorldTransformMatrix()
      .transformPoint(local.x, local.y);
    return { x: p.x, y: p.y };
  }
}

/** 0xRRGGBB → '#rrggbb'（Phaser Text color 用）。 */
function colorHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/**
 * 讀 uiLayout override（編輯器存的）裡的 JP 整體變換（layout.jp，additive 附掛）。
 * 沒有 override / 沒 jp 欄 → 回 undefined（resolveJpTransform 用打包預設，行為不變）。
 */
function readJpOverride(): JpTransformOverride | undefined {
  const raw = loadOverride(EDITOR_STORE_KEYS.uiLayout);
  if (!raw || typeof raw !== 'object') return undefined;
  const jp = (raw as { jp?: unknown }).jp;
  if (!jp || typeof jp !== 'object') return undefined;
  const o = jp as JpTransformOverride;
  return {
    panelScale: typeof o.panelScale === 'number' ? o.panelScale : undefined,
    panelOffsetX: typeof o.panelOffsetX === 'number' ? o.panelOffsetX : undefined,
    panelOffsetY: typeof o.panelOffsetY === 'number' ? o.panelOffsetY : undefined,
  };
}
