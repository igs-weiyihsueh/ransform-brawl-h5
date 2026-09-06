// 四輪#2 診斷: 每種敵人蓄氣的 charge key + y + depth vs body 中心 (找哪種沒到腳底)。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
const loaded = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  const tex=gs.textures;
  return { chargeDisk: tex.exists('vfx-enemy-charge-disk'), charge2: tex.exists('vfx-enemy-charge2'), charge: tex.exists('vfx-enemy-charge') };
});
console.log('[texture 載入]', JSON.stringify(loaded), '(chargeDisk 應 true)');
// 逐一測每種近戰敵人。
async function testType(type){
  await page.evaluate((t)=>{
    const ctx=window.__ctx;
    ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy());
    const pp=ctx.players[0].getPosition();
    ctx.spawner.spawn(t, pp.x+70, pp.y); // 貼玩家旁立刻蓄力
  }, type);
  await page.waitForTimeout(350); // 蓄力峰值
  return page.evaluate((t)=>{
    const gs=window.__gs; const ctx=window.__ctx;
    const e=ctx.getEnemies()[0];
    const bc = e? Math.round(e.getHitCenter().y): null;
    const list=gs.children.list;
    const charged=list.filter((o)=>o.type==='Image'&&o.texture&&['vfx-enemy-charge','vfx-enemy-charge2','vfx-enemy-charge-disk'].includes(o.texture.key));
    return { type:t, bodyCenterY: bc, charge: charged.map((o)=>({key:o.texture.key.replace('vfx-enemy-',''), y:Math.round(o.y), depth:o.depth, dw:Math.round(o.displayWidth), dh:Math.round(o.displayHeight)})) };
  }, type);
}
for(const t of ['Enemy_Rush','Enemy_Elite']){
  const r = await testType(t);
  const c = r.charge[0];
  const verdict = c? (c.key==='charge-disk' && c.y>r.bodyCenterY && c.depth===-4 ? '✓腳底貼地盤' : '★'+(c.key!=='charge-disk'?'key='+c.key:'')+(c.y<=r.bodyCenterY?' y未過腳底':'')+(c.depth!==-4?' depth'+c.depth:'')) : '(無 charge sprite)';
  console.log('['+t+']', JSON.stringify(r), '→', verdict);
}
// 截一張衝鋒兵蓄力中(開闊處、遠離玩家、不重疊)給視覺看 disk 位置。
await page.evaluate(()=>{ const ctx=window.__ctx; ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy()); });
await page.waitForTimeout(50);
// 生一隻在開闊處, 用 scriptedControl 把玩家移遠? 簡化: 生在右上開闊區, 讓它蓄力(但它會追玩家)。
// 改用: 直接呼 enemyCharge 在固定開闊點畫 disk(驗視覺位置), 不靠 AI。
await page.evaluate(()=>{
  const ctx=window.__ctx; const fx=ctx.effects;
  // 模擬一隻 body 中心在 (900,300), radiusPx=45 → footY=300+45*1.7=376.5, diskPx=45*2.8=126。
  window.__testDisk = fx.enemyCharge(900, 376.5, 700, 126);
  // 畫一個參考點標 body 中心(900,300) 與腳底範圍。
  const g=ctx.scene.add.graphics().setDepth(9999);
  g.lineStyle(2,0x00ff00,1); g.strokeCircle(900,300,45); // body 圈(綠)
  g.fillStyle(0xff00ff,1); g.fillCircle(900,300,3);      // body 中心(洋紅點)
});
await page.waitForTimeout(650);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-charge.png') });
await browser.close(); server.close();
console.log('DONE');
