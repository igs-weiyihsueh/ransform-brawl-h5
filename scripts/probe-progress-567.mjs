// 六輪#5#6#7 驗: #5 Spawn→Spawn 場面不空 / #6 已過節點黃當前白 / #7 下一顆(cur+1)脈動。
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
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
// #6#7: 強制 wave 到 node 1(node0=past黃, node1=current白, node2+=future暗); 給高 segRatio 觸發 cur+1 脈動。
const r67 = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const wave=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
  if(typeof wave.enterNode==='function') wave.enterNode(1);
  // getNodeProgress 撐高(讓 cur+1=node2 脈動): 直接壓 kills 逼近 quota。
  // 用 monkeypatch getNodeProgress 回 0.9。
  wave.getNodeProgress = ()=>0.9;
  await new Promise((r)=>setTimeout(r,600));
  return { nodeIndex: wave.getNodeIndex&&wave.getNodeIndex(), nodeCount: wave.getNodeCount&&wave.getNodeCount(), types: wave.getNodeTypes&&wave.getNodeTypes() };
});
console.log('[#6#7] nodeIndex/count/types:', JSON.stringify(r67));
// #7 脈動確認: 取樣 node2(cur+1) 的 icon displaySize 隨時間變化(脈動)、node1(current)不變。
const pulse = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ps=(gs.systems||[]).find((x)=>x&&x.name==='ProgressBarSystem');
  const icons = ps && ps.nodeIcons;
  if(!icons || icons.length<3) return { err:'no icons', n: icons?icons.length:0 };
  const samp = { node1:[], node2:[] };
  for(let f=0; f<20; f++){
    await new Promise((r)=>setTimeout(r,50));
    samp.node1.push(Math.round(icons[1].displayWidth));
    samp.node2.push(Math.round(icons[2].displayWidth));
  }
  const range = (a)=> Math.max(...a)-Math.min(...a);
  return { node1Range: range(samp.node1), node2Range: range(samp.node2), node1: samp.node1.slice(0,6), node2: samp.node2.slice(0,6) };
});
console.log('[#7 脈動取樣]', JSON.stringify(pulse));
if(!pulse.err){
  console.log('  node2(cur+1) 有脈動(size 變化>3px)?', pulse.node2Range>3 ? 'PASS(range='+pulse.node2Range+')' : 'FAIL(range='+pulse.node2Range+')');
  console.log('  node1(current) 不脈動(size 幾乎不變)?', pulse.node1Range<=2 ? 'PASS(range='+pulse.node1Range+')' : 'FAIL(range='+pulse.node1Range+')');
}
// 抓 node2 放大的一刻截圖。
for(let f=0; f<20; f++){
  const big = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ps=(gs.systems||[]).find((x)=>x&&x.name==='ProgressBarSystem');
    const ic=ps&&ps.nodeIcons; return ic&&ic.length>2 ? ic[2].displayWidth > (ic[1].displayWidth+4) : false;
  });
  if(big) break;
  await page.waitForTimeout(30);
}
await page.screenshot({ path:'/tmp/progress-567.png' });
console.log('  截圖 /tmp/progress-567.png (node2 放大一刻)');
await browser.close(); server.close();
console.log('DONE');
