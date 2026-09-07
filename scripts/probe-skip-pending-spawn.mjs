import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,120)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1500);
// 等 Spawn 節點自然排程 spawnWarning（pendingSpawns>0 但怪未生），或手動觸發 maybeSpawn
const before=await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');const sp=gs.ctx.spawner;
  // 強制觸發一次 spawn 排程（若有 private maybeSpawn 不好呼叫→靠自然：確保在 Spawn 節點）
  return {node:ws.nodeIndex, pending:ws.pendingSpawns, alive:sp.enemies.filter(e=>!e.isDead()).length, gen:ws.spawnGeneration};
});
console.log('初始:', JSON.stringify(before));
// 等到 pendingSpawns>0（預警中，怪還沒生）
let waited=0;
while(waited<3000){
  const st=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');return {pending:ws.pendingSpawns, alive:gs.ctx.spawner.enemies.filter(e=>!e.isDead()).length};});
  if(st.pending>0){ console.log('捕捉到預警中: pendingSpawns='+st.pending+' 場上活怪='+st.alive); 
    // 立刻按 N skip（趁 doSpawn 還沒觸發）
    await pg.keyboard.press('KeyN');
    // 等預警淡入時間過去（doSpawn 本該觸發的時點）+餘裕
    await pg.waitForTimeout(1200);
    const after=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');return {node:ws.nodeIndex, pending:ws.pendingSpawns, alive:gs.ctx.spawner.enemies.filter(e=>!e.isDead()).length, gen:ws.spawnGeneration};});
    console.log('skip 後(預警本該生怪的時點已過):', JSON.stringify(after));
    console.log('預警的怪不生出來:', after.alive===0?'PASS(正在出生的怪也清)':'★冒出 '+after.alive+' 隻', '| gen 遞增:', after.gen>before.gen?'PASS':'?');
    break;
  }
  await pg.waitForTimeout(100); waited+=100;
}
if(waited>=3000) console.log('(3s 內未捕捉到預警中狀態；spawn 節奏可能較慢)');
await b.close(); console.log('DONE');
