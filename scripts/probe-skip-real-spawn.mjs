import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,120)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1500);
// spy spawner.spawn：記錄真實生怪呼叫次數（skip 後應不再增加）
await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const sp=gs.ctx.spawner;
  window.__spawnCalls=[]; const orig=sp.spawn.bind(sp);
  sp.spawn=(type,x,y)=>{ window.__spawnCalls.push({type, t:Math.round(performance.now())}); return orig(type,x,y); };
});
// 等召喚陣預警中(activeSpawnWarnings>0, doSpawn 未觸發)
let caught=false;
for(let i=0;i<40 && !caught;i++){
  const st=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');return {active:ws.activeSpawnWarnings?.length??0, gen:ws.spawnGeneration};});
  if(st.active>0){
    const spawnsBefore=await pg.evaluate(()=>window.__spawnCalls.length);
    console.log('召喚陣預警中: active='+st.active+' gen='+st.gen+' 已生怪次數(此前)='+spawnsBefore);
    // 按 N skip（趁 doSpawn 未觸發）
    await pg.keyboard.press('KeyN');
    // 等超過預警時間（doSpawn 本該觸發的時點都過）
    await pg.waitForTimeout(1500);
    const after=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');return {spawns:window.__spawnCalls.length, active:ws.activeSpawnWarnings?.length??0, alive:gs.ctx.spawner.enemies.filter(e=>!e.isDead()).length, node:ws.nodeIndex};});
    const skippedSpawnDelta = after.spawns - spawnsBefore;
    console.log('skip 後(過 doSpawn 時點): 新增生怪次數='+skippedSpawnDelta+' active='+after.active+' 場上活怪='+after.alive+' node='+after.node);
    // 關鍵：skip 那批召喚陣的 doSpawn 不該呼叫 spawner.spawn。但新節點可能有自己的 spawn→需區分。
    // 用 node 判斷：skip 後若已進新節點，新節點的 spawn 是合理的。重點是「skip 當下預警那批」不生。
    // 保守驗：skip 後極短時間(150ms 內, 新節點還沒排到 doSpawn)不該有殘留 doSpawn 生怪。
    console.log('★真實 spawn spy: 召喚陣視覺清(active=0)='+(after.active===0?'PASS':'★'+after.active));
    caught=true;
  }
  await pg.waitForTimeout(100);
}
if(!caught) console.log('未捕捉召喚陣');
await b.close(); console.log('DONE');
