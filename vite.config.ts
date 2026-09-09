import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

/**
 * build 版本識別：git 短 commit hash + build 時間戳（確保每次 build 唯一、內容變即變）。
 * 用於 version.json（線上輪詢比對）+ __BUILD_VERSION__ define（app 記住自己的版本）。
 */
function resolveBuildVersion(): { version: string; commit: string; builtAt: string } {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // 無 git 環境（如某些 CI）→ 用 unknown，靠時間戳仍唯一
  }
  const builtAt = new Date().toISOString();
  // version = commit-時間戳：同 commit 重 build 也唯一，避免漏判新版
  const version = `${commit}-${Date.now()}`;
  return { version, commit, builtAt };
}

const BUILD = resolveBuildVersion();

export default defineConfig({
  base: './',
  // app 啟動時知道自己這份 build 的 version（供 versionCheck 與 version.json 比對）。
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD.version),
  },
  plugins: [
    {
      // build 時產出 version.json（帶 version/commit/builtAt）→ 線上輪詢 fetch 比對。
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify(
            { version: BUILD.version, commit: BUILD.commit, builtAt: BUILD.builtAt },
            null,
            2,
          ),
        });
      },
    },
  ],
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
        dashEditor: fileURLToPath(new URL('./dash-editor/index.html', import.meta.url)),
        eventEditor: fileURLToPath(new URL('./event-editor/index.html', import.meta.url)),
        chestEditor: fileURLToPath(new URL('./chest-editor/index.html', import.meta.url)),
        mapBoundsEditor: fileURLToPath(new URL('./mapbounds-editor/index.html', import.meta.url)),
      },
    },
  },
});
