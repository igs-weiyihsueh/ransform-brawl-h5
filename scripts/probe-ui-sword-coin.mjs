// #5/#6 驗: credit 旁是劍 icon(sword texture 有載+用在 overhead)、下方面板不再畫 coin。
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
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500); // 進場顯示 credit
const info = await page.evaluate(()=>{
  const g=window.__PHASER_GAME__;
  const gs=g.scene.getScene('GameScene');
  const swordLoaded = g.textures.exists('ui-sword');
  const coinLoaded = g.textures.exists('ui-coin');
  // 統計場上用 ui-sword / ui-coin 貼圖的 image 數。
  const all = [];
  gs.children.list.forEach((o)=>{ if(o.type==='Image'&&o.texture) all.push(o.texture.key); });
  // overhead UI 在容器裡, 遞迴撈。
  function walk(list, acc){ list.forEach((o)=>{ if(o.texture&&o.texture.key) acc.push(o.texture.key); if(o.list) walk(o.list, acc); }); }
  const deep=[]; walk(gs.children.list, deep);
  const count=(k)=>deep.filter((x)=>x===k).length;
  return { swordLoaded, coinLoaded, swordUsed: count('ui-sword'), coinUsed: count('ui-coin') };
});
console.log('[#5/#6 驗]', JSON.stringify(info));
console.log('  #5 credit 用劍 icon:', info.swordLoaded && info.swordUsed>0 ? 'PASS (sword 有載且被使用)' : 'FAIL');
console.log('  #6 下方面板不畫金幣:', info.coinUsed===0 ? 'PASS (場上無 ui-coin 使用)' : `注意: 仍有 ${info.coinUsed} 個 ui-coin`);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-ui56.png') });
await browser.close(); server.close();
console.log('DONE');
