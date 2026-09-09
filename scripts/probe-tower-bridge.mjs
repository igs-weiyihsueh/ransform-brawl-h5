// 尖塔怪+守護波橋接驗：onTowerWave→生 N 座尖塔→打掉→onTowerDestroyed→notifyTowerDestroyed 累計→過關。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url));const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const v404=[];
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){if(/fx_tower_ring/.test(u))v404.push(u);s.statusCode=404;s.end('404');return;}s.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(s);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const b=await chromium.launch();const page=await b.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>console.log('[err]',String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(3200);
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(150);

// 觸發 onTowerWave（模擬進 TowerWave 節點）：生 3 座尖塔。
const spawned = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
  if(ctx.spawner.clearAllEnemies)ctx.spawner.clearAllEnemies();
  const wave=(gs.systems||[]).find(x=>x&&x.name==='WaveSystem');
  let destroyedCount=0;
  wave.notifyTowerDestroyed = ((orig)=>function(){destroyedCount++;return orig?.call(this);})(wave.notifyTowerDestroyed?.bind(wave));
  window.__towerDestroyed=()=>destroyedCount;
  // 直接呼 onTowerWave 橋接（GameScene wire 的）：
  wave.onTowerWave?.({nodeType:'TowerWave', towerCount:3, timeLimitSec:30, towerHp:12, ringSkill:{intervalSec:2,expandPxPerRing:160,energyCost:2}});
  return {aliveTowers: window.__TOWER__?.aliveCount?.() ?? -1};
});
await page.waitForTimeout(100);
// 逐一打掉尖塔（killFirst 猛打致死）→ 每死一座 onTowerDestroyed→notifyTowerDestroyed。
let kills=[];
for(let i=0;i<3;i++){
  const k=await page.evaluate(()=>window.__TOWER__?.killFirst?.());
  await page.waitForTimeout(900); // 等 death 動畫播完(die→anim 'death' onComplete 才 dead=true、才移除+onTowerDestroyed)
  const alive=await page.evaluate(()=>window.__TOWER__?.aliveCount?.());
  kills.push({killed:k, aliveAfter:alive});
}
const destroyed = await page.evaluate(()=>window.__towerDestroyed?.());

console.log('[尖塔怪+守護波橋接驗]');
console.log('  fx_tower_ring 404:', v404.length?'★有':'無');
console.log('  onTowerWave→生尖塔數:', spawned.aliveTowers, spawned.aliveTowers===3?'PASS(生 towerCount=3 座)':'★FAIL');
console.log('  逐座打掉:', JSON.stringify(kills));
console.log('  onTowerDestroyed→notifyTowerDestroyed 累計次數:', destroyed, destroyed===3?'PASS(每塔死累計、橋接通)':'★FAIL');
const finalAlive = kills[kills.length-1]?.aliveAfter;
const pass = v404.length===0 && spawned.aliveTowers===3 && destroyed===3 && finalAlive===0;
console.log('  最終存活尖塔:', finalAlive, finalAlive===0?'PASS(全清)':'★FAIL');
console.log('  總結:', pass?'ALL PASS ✓(onTowerWave→spawnTower→onTowerDestroyed→notifyTowerDestroyed 橋接通、過關計數對)':'★HAS FAIL');
await b.close();server.close();console.log('DONE');
