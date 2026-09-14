import Phaser from 'phaser';
import { GAME_WIDTH } from '@/config/gameConfig';
import { PANEL_TOP_Y } from '@/config/mapConfig';
import { DOUQI_COMBO_CONFIG } from '@/config/douqiConfig';
import { playerColor } from '@/config/playerConfig';
import {
  comboFillRatio,
  comboNodeX,
  comboNodeState,
  empowerCountdownLabel,
} from '@/systems/comboHudMath';

/** 每幀餵給 HUD 的 per-pid 連段資料（DouqiControlStrategy.getComboHudData 提供）。 */
export interface ComboHudData {
  combo: number;
  comboMax: number;
  teamLevel: number;
  empowerRemainMs: number;
}

/** 招式節點靜態描述（門檻/解鎖等級讀 DOUQI_COMBO_CONFIG 單一真源；icon 佔位待素材）。 */
interface SkillNodeDesc {
  key: 'circle' | 'line' | 'burst' | 'empower';
  threshold: number;
  unlockLevel: number;
  activeColor: number;
  /** ★素材佔位：現用短字（斬/波/爆/強）；專屬小圖示待補（TODO：比照 shielder/bomber fallback）。 */
  placeholderChar: string;
}

const NODE_COLOR_LOCKED = 0x555555; // 未解鎖（teamLevel 未達 unlockLevel）
const NODE_COLOR_UNLOCKED = 0xaaaaaa; // 已解鎖但 combo 未達門檻
const BAR_FILL_COLOR = 0xc8b6ff; // 紫色系填充
const BAR_BG_COLOR = 0x000000; // 黑底
const NODE_RADIUS = 11;

/** 單一 pid 的 HUD 物件集合。 */
interface PidRow {
  label: Phaser.GameObjects.Text;
  barGfx: Phaser.GameObjects.Graphics;
  nodeGfx: Phaser.GameObjects.Graphics;
  nodeTexts: Phaser.GameObjects.Text[];
  empowerText: Phaser.GameObjects.Text;
  barX: number;
  barY: number;
  barWidth: number;
  barHeight: number;
}

/**
 * DouqiComboHud — 鬥氣模式連段介面 HUD（用戶實玩後要，照《鬥氣割草》v45 連段條，我方素材重寫）。
 *
 * ★只鬥氣模式建立/更新（GameScene 依 gameMode==='douqi' gate）；normal 完全不建、不受影響（byte 安全，md5 0a96e5）。
 * ★純顯示層：只讀 combo/teamLevel/empowerRemainMs 畫 UI，不碰連段邏輯/命中/body/位移。定位/三態/填充比例抽 comboHudMath 交測騎。
 *
 * 版面：★下方面板(PANEL_TOP_Y=944)的上方，每個 pid(P1~P4)各一條水平進度條，向上堆疊（不互擋、不擋下方面板）。
 * 一條＝進度條(combo/10 填充，紫 0xc8b6ff 黑底) + 條上 4 招式節點(combo 3/6/9/10 門檻按比例定位)。
 * 節點三態色＝「待會放什麼招」預告（非文字）：未解鎖灰 / 已解鎖未達淡灰 / 已解鎖且 combo≥門檻高亮 activeColor(ready)。
 * 強化倒數：empowerRemainMs>0 條右側「強化 X.Xs」，否則隱藏。
 */
export class DouqiComboHud {
  private readonly scene: Phaser.Scene;
  private readonly rows = new Map<number, PidRow>();
  private readonly nodes: SkillNodeDesc[];
  private readonly barWidth = 360;
  private readonly barHeight = 16;
  private readonly rowSpacing = 30; // 每條間距（含 label）
  private readonly depth = 2000;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const c = DOUQI_COMBO_CONFIG;
    // 4 招節點：門檻/解鎖等級讀 config 單一真源（圓形斬3/氣波6/爆發9/強化10；圓Lv2/波Lv4/爆Lv6/強Lv1）。
    this.nodes = [
      { key: 'circle', threshold: c.thresholds.circle, unlockLevel: c.unlockLevel.circle, activeColor: c.circle.ringColor, placeholderChar: '斬' },
      { key: 'line', threshold: c.thresholds.line, unlockLevel: c.unlockLevel.line, activeColor: c.line.beamColor, placeholderChar: '波' },
      { key: 'burst', threshold: c.thresholds.burst, unlockLevel: c.unlockLevel.burst, activeColor: 0xffa500, placeholderChar: '爆' },
      { key: 'empower', threshold: c.thresholds.empower, unlockLevel: c.unlockLevel.empower, activeColor: 0xffd24d, placeholderChar: '強' },
    ];
  }

  /**
   * 每幀更新（GameScene.update 於 douqi 呼）。
   * @param entries 各 active pid 的連段資料（pid → data；null data 跳過）。
   */
  update(entries: Array<{ pid: number; data: ComboHudData | null }>): void {
    const activePids = new Set<number>();
    // 依 pid 排序決定堆疊順序（P1 最上）。
    const sorted = entries
      .filter((e) => e.data != null)
      .sort((a, b) => a.pid - b.pid);
    sorted.forEach((e, idx) => {
      activePids.add(e.pid);
      const row = this.ensureRow(e.pid, idx);
      this.drawRow(row, e.pid, e.data as ComboHudData);
    });
    // 已離場 pid 的 row 隱藏（不 destroy，玩家可能重進場）。
    for (const [pid, row] of this.rows) {
      if (!activePids.has(pid)) this.setRowVisible(row, false);
    }
  }

  /** 取（或建）某 pid 的 row，並依堆疊序放好 y（★向上堆疊於下方面板之上）。 */
  private ensureRow(pid: number, stackIndex: number): PidRow {
    const barX = GAME_WIDTH / 2 - this.barWidth / 2;
    // 最底一條貼近面板上緣，往上堆疊（stackIndex 越大越上；但我們用 P1 最上→反過來：P1 stackIndex0 在最上）。
    // 4 條總高 = 4×rowSpacing；最上一條頂在 PANEL_TOP_Y - 4×rowSpacing - 8。
    const topY = PANEL_TOP_Y - 4 * this.rowSpacing - 8;
    const barY = topY + stackIndex * this.rowSpacing;
    let row = this.rows.get(pid);
    if (row) {
      row.barX = barX;
      row.barY = barY;
      this.repositionRow(row);
      this.setRowVisible(row, true);
      return row;
    }
    const label = this.scene.add
      .text(barX - 34, barY, `P${pid + 1}`, { fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(this.depth + 2);
    const barGfx = this.scene.add.graphics().setScrollFactor(0).setDepth(this.depth);
    const nodeGfx = this.scene.add.graphics().setScrollFactor(0).setDepth(this.depth + 1);
    const nodeTexts = this.nodes.map(() =>
      this.scene.add.text(0, 0, '', { fontFamily: 'Arial, "Microsoft JhengHei", sans-serif', fontSize: '12px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(this.depth + 2),
    );
    const empowerText = this.scene.add
      .text(barX + this.barWidth + 8, barY, '', { fontFamily: 'Arial, "Microsoft JhengHei", sans-serif', fontSize: '14px', color: '#ffd24d', fontStyle: 'bold' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(this.depth + 2);
    row = { label, barGfx, nodeGfx, nodeTexts, empowerText, barX, barY, barWidth: this.barWidth, barHeight: this.barHeight };
    this.rows.set(pid, row);
    return row;
  }

  private repositionRow(row: PidRow): void {
    row.label.setPosition(row.barX - 34, row.barY);
    row.empowerText.setPosition(row.barX + row.barWidth + 8, row.barY);
  }

  private setRowVisible(row: PidRow, v: boolean): void {
    row.label.setVisible(v);
    row.barGfx.setVisible(v);
    row.nodeGfx.setVisible(v);
    row.nodeTexts.forEach((t) => t.setVisible(v));
    row.empowerText.setVisible(v && row.empowerText.text.length > 0);
  }

  /** 畫一條 row：進度條(填充) + 4 節點(三態色 + 佔位字) + 強化倒數。 */
  private drawRow(row: PidRow, pid: number, data: ComboHudData): void {
    this.setRowVisible(row, true);
    const { barX, barY, barWidth, barHeight } = row;
    const ratio = comboFillRatio(data.combo, data.comboMax);
    // 進度條：黑底 + 紫填充（帶一點 pid 識別色描邊）。
    row.barGfx.clear();
    row.barGfx.fillStyle(BAR_BG_COLOR, 0.55).fillRect(barX, barY, barWidth, barHeight);
    row.barGfx.fillStyle(BAR_FILL_COLOR, 0.95).fillRect(barX, barY, barWidth * ratio, barHeight);
    row.barGfx.lineStyle(2, playerColor(pid), 0.85).strokeRect(barX, barY, barWidth, barHeight);

    // 4 節點：按門檻比例定位 + 三態色。
    row.nodeGfx.clear();
    this.nodes.forEach((node, i) => {
      const nx = comboNodeX(barX, barWidth, node.threshold, data.comboMax);
      const ny = barY + barHeight / 2;
      const state = comboNodeState(data.teamLevel, data.combo, node.threshold, node.unlockLevel);
      let color = NODE_COLOR_LOCKED;
      let alpha = 0.9;
      if (state === 'unlocked') color = NODE_COLOR_UNLOCKED;
      else if (state === 'ready') { color = node.activeColor; alpha = 1; }
      // 節點圓（素材佔位：待專屬小圖示，先幾何圓 + 短字 TODO）。
      row.nodeGfx.fillStyle(color, alpha).fillCircle(nx, ny, NODE_RADIUS);
      row.nodeGfx.lineStyle(2, 0xffffff, state === 'ready' ? 0.95 : 0.4).strokeCircle(nx, ny, NODE_RADIUS);
      // ready 時外圈高亮（預告下次觸發）。
      if (state === 'ready') row.nodeGfx.lineStyle(2, node.activeColor, 0.7).strokeCircle(nx, ny, NODE_RADIUS + 4);
      const t = row.nodeTexts[i];
      t.setPosition(nx, ny).setText(node.placeholderChar);
      t.setColor(state === 'locked' ? '#888888' : '#ffffff');
      t.setVisible(true);
    });

    // 強化倒數。
    const lbl = empowerCountdownLabel(data.empowerRemainMs);
    row.empowerText.setText(lbl).setVisible(lbl.length > 0);
  }

  destroy(): void {
    for (const row of this.rows.values()) {
      row.label.destroy();
      row.barGfx.destroy();
      row.nodeGfx.destroy();
      row.nodeTexts.forEach((t) => t.destroy());
      row.empowerText.destroy();
    }
    this.rows.clear();
  }
}
