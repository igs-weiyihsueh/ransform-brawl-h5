/**
 * 版本自動更新檢查——執行期（fetch version.json + 輪詢比對 + 有新版提示/reload）。
 *
 * 根治 GitHub Pages 更新後載舊版：app 啟動記住自己 build version（build 時 vite define 注入），
 * 定期 fetch version.json（cache-bust、no-store）比對，偵測到新版→顯示「有新版本，點此更新」bar（點了 reload）。
 * 純體驗/部署改善，不碰 gameplay。
 */
import { buildVersionUrl, isNewVersion, parseVersionInfo } from '@/systems/versionCheckMath';

/** build 時由 Vite define 注入的當前 build version（見 vite.config.ts）。dev 未注入時為 'dev'。 */
declare const __BUILD_VERSION__: string;

const CURRENT_VERSION: string = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';
/** version.json 路徑（相對，配合 Vite base './'）。 */
const VERSION_URL = './version.json';
/** 輪詢間隔（ms）。 */
const POLL_INTERVAL_MS = 60_000;

let started = false;
let notified = false;

/** fetch version.json（cache-bust + no-store），失敗回 null（不炸、不打擾）。 */
async function fetchRemoteVersion(): Promise<string | null> {
  try {
    const res = await fetch(buildVersionUrl(VERSION_URL), { cache: 'no-store' });
    if (!res.ok) return null;
    const info = parseVersionInfo(await res.json());
    return info?.version ?? null;
  } catch {
    return null; // 離線/404/JSON 壞 → 靜默略過，不影響遊戲
  }
}

/** 顯示「有新版本」提示 bar（非侵入，右下；點更新→reload）。只顯示一次。 */
function showUpdateBanner(): void {
  if (notified || typeof document === 'undefined') return;
  notified = true;

  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
    'background:rgba(26,26,46,0.96)', 'color:#fff', 'padding:12px 16px',
    'border-radius:10px', 'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
    'font:14px/1.4 system-ui,-apple-system,"Noto Sans TC",sans-serif',
    'display:flex', 'align-items:center', 'gap:12px', 'max-width:90vw',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = '有新版本可用';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '立即更新';
  btn.style.cssText = [
    'background:#ffb400', 'color:#1a1a2e', 'border:0', 'padding:6px 14px',
    'border-radius:6px', 'font-weight:700', 'cursor:pointer', 'white-space:nowrap',
  ].join(';');
  btn.addEventListener('click', () => {
    // 強制繞快取重載（reload(true) 已非標準，改用 no-store 已在 fetch；location.reload 拿最新 index）。
    window.location.reload();
  });

  bar.appendChild(text);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

/** 檢查一次：fetch 遠端 version → 與當前 build 比對 → 有新版顯示 bar。 */
async function checkOnce(): Promise<void> {
  const remote = await fetchRemoteVersion();
  if (isNewVersion(CURRENT_VERSION, remote)) showUpdateBanner();
}

/**
 * 啟動版本自動更新檢查：啟動先檢查一次 + 每 60s 輪詢 + 視窗重新可見（focus）時再查。
 * 只在正式遊戲頁呼叫（preview/editor 不需要）。dev（未注入 build version）自動略過。
 */
export function startVersionCheck(): void {
  if (started) return;
  started = true;
  if (CURRENT_VERSION === 'dev') return; // dev 模式不檢查（無 version.json、避免噪音）

  void checkOnce();
  window.setInterval(() => void checkOnce(), POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkOnce();
  });
}
