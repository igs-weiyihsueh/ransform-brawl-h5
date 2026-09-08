// 衝刺圖示編輯歸屬驗證（用戶指定）：衝刺「衝」圖示編輯 handle 應「移到下方面板編輯器(panel 區塊)」，
// 不再在全螢幕(screen)區塊。驗：panel 區塊有 dash.icon box、screen 區塊無 dash.icon box。
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
await page.goto(`http://127.0.0.1:${port}/ui-editor/`, { waitUntil:'networkidle' });
await page.waitForTimeout(600);

const dashBox = () => page.$$eval('.ui-box', (bs)=>bs.map((b)=>b.dataset.key)).then((keys)=>({ keys, hasDash: keys.includes('dash.icon') }));

// ① 下方面板(panel)區塊 → 應有 dash.icon。
await page.click('#tab-panel');
await page.waitForTimeout(400);
const panel = await dashBox();
await page.screenshot({ path:'/tmp/dash-editor-panel.png' });

// ② 全螢幕(screen)區塊 → 不應有 dash.icon。
await page.click('#tab-screen');
await page.waitForTimeout(400);
const screen = await dashBox();
await page.screenshot({ path:'/tmp/dash-editor-screen.png' });

const pass = (b)=>b?'PASS':'★FAIL';
console.log('[衝刺圖示編輯歸屬驗證]');
console.log('  ① panel 區塊 keys:', JSON.stringify(panel.keys));
console.log('     - 下方面板有 dash.icon:', pass(panel.hasDash===true));
console.log('  ② screen 區塊 keys:', JSON.stringify(screen.keys));
console.log('     - 全螢幕無 dash.icon(已移走):', pass(screen.hasDash===false));
console.log('  截圖: /tmp/dash-editor-panel.png(面板區塊含衝刺 handle) /tmp/dash-editor-screen.png(全螢幕區塊無)');
await browser.close(); server.close();
console.log('DONE');
