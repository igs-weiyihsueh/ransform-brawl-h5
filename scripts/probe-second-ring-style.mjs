// 二段能量圓環視覺樣式驗證（翼騎 10edfbc 接口：available gate + ratio 填充）：
//  圓環填充改二段能量識別色——charging=金橘(secondBarFill #ff9800)、active=亮金(secondBarActive #ffe082)。
// gate=isSecondTransformAvailable；monkey-patch 接口讓 UISystem 餵 available/ratio/active 觀察上色。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
await page.evaluate(()=>{ localStorage.setItem('transformbrawl:secondTransform', JSON.stringify({version:1,enabled:true,energyPerKill:0.3})); });
await page.reload({waitUntil:'networkidle'});
await page.waitForTimeout(4000);
const pass=(b)=>b?'PASS':'★FAIL';

// 投幣進場變英雄（讓 overhead 顯示）。
await page.click('canvas'); await page.keyboard.press('KeyC');
const readT = async () => page.evaluate(()=>{ const gs=window.__PHASER_GAME__?.scene?.getScene('GameScene'); const ctx=(gs?.systems||[]).find((x)=>x&&x.ctx)?.ctx; return ctx?.transform?.isTransformed?.(0) ?? null; });
for(let f=0; f<400; f++){ await page.waitForTimeout(16); if(await readT()) break; }
await page.waitForTimeout(300);

// charging：available + ratio 0.7 + active=false → 金橘。
await page.evaluate(()=>{ const gs=window.__PHASER_GAME__?.scene?.getScene('GameScene'); const ctx=(gs?.systems||[]).find((x)=>x&&x.ctx)?.ctx; ctx.isSecondTransformAvailable=()=>true; ctx.getSecondTransformEnergyRatio=()=>0.7; ctx.isSecondTransformActive=()=>false; });
await page.waitForTimeout(300);
await page.screenshot({ path:'/tmp/second-ring-charging.png' });

// active：ratio 1 + active=true → 亮金滿環。
await page.evaluate(()=>{ const gs=window.__PHASER_GAME__?.scene?.getScene('GameScene'); const ctx=(gs?.systems||[]).find((x)=>x&&x.ctx)?.ctx; ctx.getSecondTransformEnergyRatio=()=>1; ctx.isSecondTransformActive=()=>true; });
await page.waitForTimeout(300);
await page.screenshot({ path:'/tmp/second-ring-active.png' });

const st = await page.evaluate(()=>{ const gs=window.__PHASER_GAME__?.scene?.getScene('GameScene'); const uisys=(gs?.systems||[]).find((x)=>x&&Array.isArray(x.overheads)); const oh=uisys?.overheads?.[0]; return { soulVisible: oh?.soulRing?.visible ?? null, hasSetSoul2Arg: oh?.setSoul?.length >= 1, hasBarField: oh? ('secondEnergyBar' in oh):null }; });
console.log('[二段能量圓環視覺]');
console.log('  soulRing 可見(available gate):', pass(st.soulVisible===true));
console.log('  無 secondEnergyBar 欄位(翼騎已移除):', pass(st.hasBarField===false));
console.log('  截圖 charging:/tmp/second-ring-charging.png active:/tmp/second-ring-active.png');
await browser.close(); server.close();
console.log('DONE');
