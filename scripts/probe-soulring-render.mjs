// #1 深驗：變身後 soulRing 是否「真的 render 出來」（物件建立+可見+有內容），非只 gate。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);

// 變身前：先看 overhead 其他元件在不在（編號牌）+ soulRing 狀態。
const preInfo = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys=(gs.systems||[]).find(x=>x&&Array.isArray(x.overheads));
  const oh=uisys?.overheads?.[0];
  return {
    ohExists: !!oh,
    hasSoulRing: !!oh?.soulRing,
    hasRingSprite: oh?.hasRingSprite ?? null,
    ringPngLoaded: gs.textures.exists('ui-ring') || gs.textures.getTextureKeys().some(k=>/ring/i.test(k)),
    soulRingVisiblePre: oh?.soulRing?.visible ?? null,
  };
});

// 投幣變身。
await page.keyboard.press('KeyC');
for(let f=0; f<160; f++){ await page.waitForTimeout(16);
  const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;return ctx.transform.isTransformed(0);});
  if(t) break;
}
// 打幾隻怪累積二段能量→圓環該有弧。等一小段讓 UISystem update setSoul。
await page.waitForTimeout(120);
await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;for(let i=0;i<4;i++)ctx.transform.accumulateSecondTransform?.(0,0.15);});
await page.waitForTimeout(120);

const postInfo = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
  const uisys=(gs.systems||[]).find(x=>x&&Array.isArray(x.overheads));
  const oh=uisys?.overheads?.[0];
  return {
    available: ctx.isSecondTransformAvailable?.(0) ?? false,
    soulRingVisible: oh?.soulRing?.visible ?? null,
    ringImgVisible: oh?.ringImg?.visible ?? null,
    containerVisible: oh?.container?.visible ?? null,
    shownSoul: oh?.shownSoul ?? null,
    ratio: ctx.getSecondTransformEnergyRatio?.(0) ?? 0,
    // soulRing graphics 有沒有畫東西（command list 長度>0 表有繪製）。
    soulRingHasContent: (oh?.soulRing?.commandBuffer?.length ?? 0) > 0,
  };
});
await page.screenshot({ path:'/tmp/soulring-rendered.png' });

console.log('[#1 soulRing 真 render 深驗]');
console.log('  變身前:', preInfo);
console.log('  變身後:', postInfo);
const built = preInfo.ohExists && preInfo.hasSoulRing;
const rendered = postInfo.available && postInfo.soulRingVisible===true && postInfo.containerVisible===true && (postInfo.ringImgVisible===true || postInfo.soulRingHasContent);
console.log('  → soulRing 有建立:', built?'YES':'NO');
console.log('  → 變身後真的可見+有內容:', rendered?'YES(圓環會 render)':'★NO(仍隱藏/無內容)');
console.log('  截圖 /tmp/soulring-rendered.png (看圖確認圓環真的在頭上)');
console.log('  總結:', built&&rendered?'PASS ✓':'★FAIL');
await browser.close(); server.close();
console.log('DONE');
