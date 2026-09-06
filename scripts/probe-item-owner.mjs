// 三輪#5 驗: #6 隨機道具無主(無框無箭頭) vs 擊落道具有主(玩家色框+箭頭); #7 箭頭現在會顯。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
const r = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const ts=(gs.systems||[]).find((x)=>x&&x.name==='TransformSystem');
  window.__gs=gs; window.__ctx=ctx; window.__ts=ts;
  // 清掉自然刷的道具, 乾淨測。
  ts.items.forEach((it)=>it.destroy&&it.destroy()); ts.items=[]; ts.ownerQueues=new Map(); ts.arrowElapsed=new Map();
  // 隨機刷一個(預設 random) + 擊落 owner=P1 一個(遠處讓箭頭顯)。
  ts.spawnItem('random');
  ts.spawnItem('kill', 0);
  const items=ts.items;
  return { count: items.length, owners: items.map((it)=>it.getOwner?it.getOwner():undefined) };
});
console.log('[spawn]', JSON.stringify(r), '(owners: 一個undefined=隨機無主, 一個0=擊落歸P1)');
await page.waitForTimeout(200);
const draw = await page.evaluate(()=>{
  const gs=window.__gs; const list=gs.children.list;
  // guideGfx(depth25) 有沒有畫東西? 用 commandBuffer/其 __dirty 難讀; 改數 owner border(item container 內 graphics)。
  const ts=window.__ts;
  const info=ts.items.map((it)=>{
    // ownerBorder 是 container 內的 graphics; getOwner 判有無主。
    return { owner: it.getOwner?it.getOwner():undefined, hasBorder: !!it.ownerBorder };
  });
  // guideGfx 是否存在且有繪製(commandBuffer 長度>0 表有畫箭頭)。
  const guide = gs.children.list.find((o)=>o.type==='Graphics'&&o.depth===25);
  const guideCmds = guide && guide.commandBuffer ? guide.commandBuffer.length : -1;
  const tether = gs.children.list.find((o)=>o.type==='Graphics'&&o.depth===-3);
  const tetherCmds = tether && tether.commandBuffer ? tether.commandBuffer.length : -1;
  return { items: info, guideCmds, tetherCmds };
});
console.log('[繪製]', JSON.stringify(draw));
console.log('  隨機道具無框:', draw.items.find((i)=>i.owner===undefined)?.hasBorder===false?'PASS':'FAIL',
  '| 擊落道具有框:', draw.items.find((i)=>i.owner===0)?.hasBorder===true?'PASS':'FAIL',
  '| 指引箭頭有畫(guideCmds>0):', draw.guideCmds>0?'PASS':'FAIL('+draw.guideCmds+')');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-owner.png') });
await browser.close(); server.close();
console.log('DONE');
