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

// 環繞/推擠 A/B 開關掛勾（征騎 ContactSolver 階段①）：用戶可在 console 執行期切換比較，無需重編譯。
//   window.__SURROUND__.setOverlapSolver('legacy'|'contactSolver')  ← 新 solver ↔ 舊推擠一鍵回退
//   window.__SURROUND__.setSurroundMode('slots'|'emergent')         ← 槽位法 ↔ 純湧現法 A/B
//   window.__SURROUND__.setPlayerSolver('legacy'|'contactSolver')   ← 階段②玩家推擠 solver（預設 legacy 不動手感）
//   window.__SURROUND__.get()                                        ← 看目前設定
void (async () => {
  const cfg = await import('@/config/surroundConfig');
  (window as unknown as { __SURROUND__?: unknown }).__SURROUND__ = {
    setOverlapSolver: cfg.setOverlapSolver,
    setSurroundMode: cfg.setSurroundMode,
    setPlayerSolver: cfg.setPlayerSolver,
    set: cfg.setSurroundRuntimeConfig,
    reset: cfg.resetSurroundRuntimeConfig,
    get: cfg.getSurroundRuntimeConfig,
  };
})();

// 試玩模式（?preview=1）：建立編輯器交握橋。一般玩家路徑完全不進這分支。
if (isPreviewMode()) {
  const bridge = new PreviewBridge((levels) => {
    // 收到並雙重驗證通過的關卡 → 以 previewLevels 啟動/重啟 GameScene。
    game.scene.stop('BootScene');
    game.scene.start('GameScene', { previewLevels: levels });
  });
  bridge.start();
} else {
  // 版本自動更新檢查（部署/體驗改善）：正式遊戲頁啟動時輪詢 version.json，偵測新版部署→提示用戶更新，
  //   根治 GitHub Pages index.html HTTP 快取導致「更新後載到舊版」（無 SW、http-equiv meta 無法覆蓋 server header）。
  void (async () => {
    const { startVersionCheck } = await import('@/systems/versionCheck');
    startVersionCheck();
  })();

  // 遊戲內展開編輯器（方案 A'）：非試玩模式才掛 overlay（右下浮動鈕→展開編輯器面板）。
  // 動態 import 殼（遊戲主 bundle 不含編輯器 code，點開浮動鈕/tab 才 lazy 載各編輯器）。
  void (async () => {
    const { EditorOverlay } = await import('@/systems/editorOverlay/EditorOverlay');
    const { EDITOR_TABS } = await import('@/systems/editorOverlay/editorTabs');
    // 收合 overlay 時 soft-reload（三決策②用戶定：收合 reload 讀新 override 生效）。
    const overlay = new EditorOverlay(EDITOR_TABS, () => window.location.reload());
    overlay.attach();
  })();
}
