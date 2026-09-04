import Phaser from 'phaser';
import {
  BACKGROUND_COLOR,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '@/config/gameConfig';

/**
 * BootScene — 最小可跑場景。
 *
 * 階段 0 骨架：只顯示純色背景 + 一行置中文字，確認 Phaser 正常運作。
 * 之後會拆成 BootScene（載資源）→ 各遊戲場景。
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
  }
}
