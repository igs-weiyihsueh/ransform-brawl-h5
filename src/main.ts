import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { BootScene } from '@/scenes/BootScene';
import { GameScene } from '@/scenes/GameScene';
import { isPreviewMode, PreviewBridge } from '@/systems/PreviewBridge';

/**
 * 遊戲進入點：建立 Phaser.Game 實例。
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, GameScene],
};

const game = new Phaser.Game(config);

// debug 掛勾：暴露 game 實例供無頭瀏覽器/E2E 抓 textures/場景狀態自查（不影響玩法）。
(window as unknown as { __PHASER_GAME__?: Phaser.Game }).__PHASER_GAME__ = game;

// 試玩模式（?preview=1）：建立編輯器交握橋。一般玩家路徑完全不進這分支。
if (isPreviewMode()) {
  const bridge = new PreviewBridge((levels) => {
    // 收到並雙重驗證通過的關卡 → 以 previewLevels 啟動/重啟 GameScene。
    game.scene.stop('BootScene');
    game.scene.start('GameScene', { previewLevels: levels });
  });
  bridge.start();
}
