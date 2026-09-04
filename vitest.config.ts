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
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
