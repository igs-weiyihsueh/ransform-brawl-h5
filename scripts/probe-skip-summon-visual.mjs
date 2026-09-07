import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,120)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1500);
const summonKey=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const keys=gs.textures.getTextureKeys().filter(k=>/summon/i.test(k));return keys[0]||null;});
console.log('召喚陣 texture key:', summonKey);
// 等到召喚陣出現(active handles>0 + 場上有 summon 視覺物件)
let waited=0, caught=false;
while(waited<4000 && !caught){
  const st=await pg.evaluate((sk)=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');
    const summonObjs=sk?gs.children.list.filter(o=>o.texture&&o.texture.key===sk).length:0;
    return {active:ws.activeSpawnWarnings?.length??0, summonObjs};
  }, summonKey);
  if(st.active>0){
    console.log('捕捉召喚陣: activeSpawnWarnings='+st.active+' 場上召喚陣視覺物件='+st.summonObjs);
    // 按 N skip
    await pg.keyboard.press('KeyN');
    await pg.waitForTimeout(60); // 當幀後
    const after=await pg.evaluate((sk)=>{
      const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');
      const summonObjs=sk?gs.children.list.filter(o=>o.texture&&o.texture.key===sk&&o.active).length:0;
      return {active:ws.activeSpawnWarnings?.length??0, summonObjs, alive:gs.ctx.spawner.enemies.filter(e=>!e.isDead()).length};
    }, summonKey);
    console.log('skip 後: activeSpawnWarnings='+after.active+' 召喚陣視覺物件='+after.summonObjs+' 場上活怪='+after.alive);
    console.log('召喚陣視覺 skip 當幀清:', (after.active===0 && after.summonObjs===0)?'PASS(handles+視覺物件都清)':'★殘留 active='+after.active+' obj='+after.summonObjs);
    // 等預警本該生怪時點過→不冒怪
    await pg.waitForTimeout(1000);
    const later=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.spawner.enemies.filter(e=>!e.isDead()).length;});
    console.log('之後不冒怪(場上活怪):', later);
    caught=true;
  }
  await pg.waitForTimeout(100); waited+=100;
}
if(!caught) console.log('(未捕捉召喚陣 active 狀態)');
await b.close(); console.log('DONE');
