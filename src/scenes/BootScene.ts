import Phaser from 'phaser';
import {
  BACKGROUND_COLOR,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '@/config/gameConfig';
import { isPreviewMode } from '@/systems/PreviewBridge';

/**
 * BootScene — 開場/載入場景。
 *
 * 一般模式：顯示標題後短暫停留即切到 GameScene（GameScene 內 WaveSystem 自行 fetch JSON）。
 * 試玩模式（?preview=1）：不自動前進，顯示「等待編輯器送關卡」，
 *   由 main.ts 的 PreviewBridge 收到關卡後才 scene.start('GameScene', {previewLevels})。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '變身大亂鬥 H5', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '64px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    if (isPreviewMode()) {
      // 試玩模式：等編輯器送關卡（由 main.ts 的 PreviewBridge 觸發 GameScene 啟動）。
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, '試玩模式：等待編輯器送出關卡…', {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: '28px',
          color: '#8fd3ff',
        })
        .setOrigin(0.5);
      return; // 不自動前進
    }

    // 一般模式：短暫停留後進入遊戲場景。
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene');
    });
  }
}
