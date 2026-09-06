// #6 診斷: 怪沒清完就進獎勵? 跑第一個 Spawn 節點, 玩家不打怪, 量 kills vs killQuota vs nodeIndex 是否推進。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1000); // 進場但不攻擊
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  window.__wave=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
  window.__ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  return !!window.__wave;
});
console.log('wave 可達?', ready);
function snap(){ return page.evaluate(()=>{
  const w=window.__wave; const ctx=window.__ctx;
  const node = w.levels ? w.levels[w.levelIndex]?.nodes[w.nodeIndex] : null;
  const scale = 1; // 單人
  const quota = node&&node.nodeType==='Spawn' ? Math.round(node.killQuota*scale) : null;
  return {
    nodeIndex: w.getNodeIndex(), nodeType: node?node.nodeType:'?',
    kills: w.kills, tracked: w.tracked?w.tracked.length:null, pending: w.pendingSpawns,
    killQuota: quota, aliveOnField: ctx?ctx.getEnemies().length:null,
  };
});}
// 直接程式擊殺場上敵人(模擬玩家清怪), 對比 wave.kills 增量 vs 實際擊殺數。
let bugSeen=false, firstBug=null;
let totalKilledByProbe=0;
for(let i=0;i<200;i++){
  await page.waitForTimeout(150);
  // 每輪殺掉場上 1 隻(用大傷 takeHit, 來源在遠處避免無敵), 記實際擊殺。
  const killedNow = await page.evaluate(()=>{
    const ctx=window.__ctx;
    const es=ctx.getEnemies().filter((e)=>!e.isDead()&&!(e.isGrabber&&e.isGrabber()));
    if(es.length===0) return 0;
    const e=es[0]; const c=e.getHitCenter();
    e.takeHit(9999, 0, {x:c.x-500,y:c.y}); // 大傷擊殺
    return 1;
  });
  totalKilledByProbe += killedNow;
  const s = await snap();
  if(i%10===0) console.log(`  t=${(i*0.15).toFixed(1)}s node#${s.nodeIndex}(${s.nodeType}) kills=${s.kills}/${s.killQuota} tracked=${s.tracked} pending=${s.pending} alive=${s.aliveOnField} 探針實殺=${totalKilledByProbe}`);
  if(s.nodeIndex>0 && s.nodeType!=='Spawn'){
    console.log(`  ★ 進到 node#${s.nodeIndex}(${s.nodeType}) 當下 wave.kills=${s.kills} 探針實際擊殺=${totalKilledByProbe} 場上活怪=${s.aliveOnField}`);
    if(s.aliveOnField>0 || s.kills>totalKilledByProbe) { bugSeen=true; firstBug={...s, probeKilled:totalKilledByProbe}; }
    break;
  }
}
console.log('[#6 診斷] wave.kills 是否 > 探針實際擊殺(過度計數) or 進獎勵時還有活怪?', bugSeen?'是! '+JSON.stringify(firstBug):'否(kills 準確、清完才進)');
await browser.close(); server.close();
console.log('DONE');
