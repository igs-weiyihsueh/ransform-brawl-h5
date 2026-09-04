import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * vitest 設定 — 由 QA（測騎）維護。
 *
 * 目標：跑純邏輯層單元測試（src/config、src/systems 中零 Phaser 的模組）。
 * - environment: 'node'（不需 DOM；純函式驗證）。
 * - alias '@' 對齊 tsconfig/vite，之後測試若 import 用 '@/...' 也能解析。
 * - 只收 *.test.ts；排除 node_modules / dist。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // boot smoke：強制用 Phaser 預打包的 dist bundle（UMD dist/phaser.js），而非 src 進入點。
      // 理由：node_modules/phaser 的 main 指向 ./src/phaser.js（給 bundler 用），
      // vitest/vite SSR 會去 require WebGL 除錯依賴 phaser3spectorjs（未安裝）而爆；
      // 且 dist ESM 只有 named export、無 default，src 的 `import Phaser from 'phaser'` 會拿到 undefined。
      // UMD dist/phaser.js 的 default interop 正確，也是瀏覽器實際跑的同一份 bundle（instrument-validity）。
      phaser: fileURLToPath(new URL('./node_modules/phaser/dist/phaser.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // boot smoke 用 @vitest-environment jsdom（檔案頂註解切換）。此 setup 在任何
    // Phaser import 前補上 canvas 2D getContext 墊片（見 tests/setup/phaserHeadless.ts）；
    // 在純 node 的邏輯測試中因無 HTMLCanvasElement 而自動 no-op。
    setupFiles: ['./tests/setup/phaserHeadless.ts'],
  },
});
