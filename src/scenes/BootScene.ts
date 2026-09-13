import Phaser from 'phaser';
import {
  BACKGROUND_COLOR,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '@/config/gameConfig';
import { isPreviewMode } from '@/systems/PreviewBridge';
import type { GameMode } from '@/config/gameMode';

/**
 * BootScene — 開場/載入場景。
 *
 * 一般模式：顯示標題 + 兩顆模式按鈕（普通模式 / 鬥氣模式）；點按 → scene.start('GameScene', { gameMode })。
 * 試玩模式（?preview=1）：不顯選單、不自動前進，顯示「等待編輯器送關卡」，
 *   由 main.ts 的 PreviewBridge 收到關卡後才 scene.start('GameScene', {previewLevels, gameMode:'normal'})。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '3C大亂鬥 H5', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '64px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    if (isPreviewMode()) {
      // 試玩模式：不顯選單，等編輯器送關卡（由 main.ts 的 PreviewBridge 觸發 GameScene 啟動）。
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, '試玩模式：等待編輯器送出關卡…', {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: '28px',
          color: '#8fd3ff',
        })
        .setOrigin(0.5);
      return; // 不自動前進、不顯模式選單
    }

    // 一般模式：兩顆模式按鈕取代舊 auto-start。點按 → 帶對應 gameMode 進 GameScene。
    this.createModeButton(GAME_WIDTH / 2 - 170, GAME_HEIGHT / 2 + 80, '普通模式', 'normal');
    this.createModeButton(GAME_WIDTH / 2 + 170, GAME_HEIGHT / 2 + 80, '鬥氣模式', 'douqi');
  }

  /** 建一顆模式選擇按鈕（矩形底 + 文字）；點按 → scene.start('GameScene', { gameMode })。 */
  private createModeButton(x: number, y: number, label: string, gameMode: GameMode): void {
    const w = 260;
    const h = 84;
    const bg = this.add
      .rectangle(x, y, w, h, 0x1b2b4a, 1)
      .setStrokeStyle(3, 0x8fd3ff)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '34px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    // probe/測試用：把 gameMode 標在物件上，方便 headed 讀取。
    bg.setData('gameMode', gameMode);
    const enter = () => bg.setFillStyle(0x27406e, 1);
    const leave = () => bg.setFillStyle(0x1b2b4a, 1);
    bg.on('pointerover', enter);
    bg.on('pointerout', leave);
    bg.on('pointerup', () => this.scene.start('GameScene', { gameMode }));
    void text;
  }
}
