import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // 多頁：遊戲主頁 + 獨立波次編輯器頁（各自打包，遊戲 bundle 不含編輯器）。
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor/index.html', import.meta.url)),
        uiEditor: fileURLToPath(new URL('./ui-editor/index.html', import.meta.url)),
        enemyEditor: fileURLToPath(new URL('./enemy-editor/index.html', import.meta.url)),
        skillEditor: fileURLToPath(new URL('./skill-editor/index.html', import.meta.url)),
        hitfeelEditor: fileURLToPath(new URL('./hitfeel-editor/index.html', import.meta.url)),
      },
    },
  },
});
