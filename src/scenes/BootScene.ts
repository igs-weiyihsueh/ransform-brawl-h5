import Phaser from 'phaser';
import {
  BACKGROUND_COLOR,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '@/config/gameConfig';

/**
 * BootScene — 開場/載入場景。
 *
 * 目前無資源可載，顯示標題後短暫停留即切到 GameScene。
 * 之後 preload() 會在這裡載美術/音效/JSON。
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

    // 短暫停留後進入遊戲場景。
    this.time.delayedCall(600, () => {
      this.scene.start('GameScene');
    });
  }
}
