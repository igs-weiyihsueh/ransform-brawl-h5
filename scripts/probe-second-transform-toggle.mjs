// 二段變身開關 toggle UI 驗證（用戶要自己開/關二段變身）：
// 編輯器 overlay 頂列有「二段變身」toggle，預設關；點一下→開(applyToGame enabled:true)、狀態提示重開生效；
// 再點→關(clearOverride)。驗 override localStorage 實際寫入/清除 + toggle 文字切換。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/'||u==='')u='/index.html'; let fp=path.join(distDir,u); if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory())fp=path.join(fp,'index.html'); if(!fp.startsWith(distDir)||!fs.existsSync(fp)){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'networkidle' });
await page.waitForTimeout(2500);

const KEY = 'transformbrawl:secondTransform';
const readStore = () => page.evaluate((k)=>window.localStorage.getItem(k), KEY);
const toggleState = () => page.evaluate(() => {
  const b = document.querySelector('.tb-editor-second');
  return b ? { text: b.textContent, on: b.classList.contains('on') } : null;
});

// 開編輯器 overlay（⚙ 編輯器 浮動鈕）。
await page.click('.tb-editor-entry-btn');
await page.waitForTimeout(500);

// ① 預設狀態：toggle 存在、關、localStorage 無 override。
const s0 = { toggle: await toggleState(), store: await readStore() };
await page.screenshot({ path:'/tmp/second-toggle-off.png' });

// ② 點一下 → 開。
await page.click('.tb-editor-second');
await page.waitForTimeout(300);
const s1 = { toggle: await toggleState(), store: await readStore(), status: await page.$eval('.tb-editor-status', (e)=>e.textContent).catch(()=>null) };
await page.screenshot({ path:'/tmp/second-toggle-on.png' });

// ③ 再點一下 → 關（clearOverride，localStorage 清掉）。
await page.click('.tb-editor-second');
await page.waitForTimeout(300);
const s2 = { toggle: await toggleState(), store: await readStore(), status: await page.$eval('.tb-editor-status', (e)=>e.textContent).catch(()=>null) };

const pass = (b)=>b?'PASS':'★FAIL';
console.log('[二段變身開關 toggle UI 驗證]');
console.log('  ① 預設:', JSON.stringify(s0));
console.log('     - toggle 存在且關:', pass(s0.toggle && s0.toggle.on===false), '/ 無 override:', pass(s0.store===null));
console.log('  ② 點→開:', JSON.stringify(s1));
console.log('     - toggle 顯開:', pass(s1.toggle && s1.toggle.on===true), '/ override enabled:true 寫入:', pass(!!s1.store && s1.store.includes('"enabled":true')), '/ 提示重開:', pass(!!s1.status && s1.status.includes('重開')));
console.log('  ③ 再點→關:', JSON.stringify(s2));
console.log('     - toggle 顯關:', pass(s2.toggle && s2.toggle.on===false), '/ override 清除:', pass(s2.store===null), '/ 提示重開:', pass(!!s2.status && s2.status.includes('重開')));
console.log('  截圖: /tmp/second-toggle-off.png(關) /tmp/second-toggle-on.png(開)');
await browser.close(); server.close();
console.log('DONE');
