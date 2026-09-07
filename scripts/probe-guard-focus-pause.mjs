import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,120)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1200);
// N 推進直到守護波 focus phase（guardFocusPause=true）
let sawPause=false, enemyFrozenOK=true, pulseOK=false;
for(let i=0;i<40;i++){
  const st=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');const ge=ws.getGuardEvent?.();return {pause:gs.ctx.guardFocusPause, hasGuard:!!ge&&!ge.isFinished?.(), combat:ge?ge.isCombatPhase?.():null};});
  if(!st.hasGuard){ await pg.keyboard.press('KeyN'); await pg.waitForTimeout(400); continue; }
  // 守護波啟動，等到 focus (pause=true)
  if(st.pause){
    sawPause=true;
    // 量敵人位移凍：連兩幀敵人位置不變
    const p1=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.spawner.enemies.filter(e=>!e.isDead()).map(e=>{const c=e.getHitCenter();return Math.round(c.x)+','+Math.round(c.y);});});
    await pg.waitForTimeout(150);
    const p2=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.spawner.enemies.filter(e=>!e.isDead()).map(e=>{const c=e.getHitCenter();return Math.round(c.x)+','+Math.round(c.y);});});
    enemyFrozenOK = JSON.stringify(p1)===JSON.stringify(p2);
    // 雕像脈動 tween 存在？(container alpha 在動)
    const a1=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');const ge=ws.getGuardEvent?.();return ge?.target?.container?.alpha ?? null;});
    await pg.waitForTimeout(200);
    const a2=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');const ge=ws.getGuardEvent?.();return ge?.target?.container?.alpha ?? null;});
    pulseOK = (a1!==null&&a2!==null&&a1!==a2); // alpha 呼吸中變化
    console.log('聚焦定格中: guardFocusPause=true, 敵人位移凍='+enemyFrozenOK+' (敵'+p1.length+'隻), 雕像 alpha '+a1+'→'+a2+' 脈動='+pulseOK);
    break;
  }
  await pg.waitForTimeout(100);
}
console.log('① 聚焦定格 pause=true:', sawPause?'PASS':'(未捕捉 focus phase)');
console.log('① 敵人位移凍:', sawPause?(enemyFrozenOK?'PASS':'★沒凍'):'(n/a)');
console.log('② 雕像呼吸燈脈動:', sawPause?(pulseOK?'PASS(alpha 呼吸)':'(alpha 未變/取樣點同相位)'):'(n/a)');
// 等聚焦結束(自然)→ pause 應解除
for(let i=0;i<30;i++){ await pg.waitForTimeout(150); const s=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.guardFocusPause;}); if(!s){ console.log('聚焦結束→guardFocusPause 解除:', 'PASS(不卡死)'); break; } }
await b.close(); console.log('DONE');
