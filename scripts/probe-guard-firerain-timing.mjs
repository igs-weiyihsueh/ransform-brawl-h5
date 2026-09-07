import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,120)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1200);
// N 推進到守護 Event 節點自然啟動，逐階段量 getActiveFireRainPreset vs guardEvent.phase
let started=false;
for(let i=0;i<12 && !started;i++){
  const st=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');const ge=ws.getGuardEvent?.();return {hasGuard:!!ge&&!ge.isFinished?.()};});
  if(st.hasGuard){ started=true; break; }
  await pg.keyboard.press('KeyN'); await pg.waitForTimeout(500);
}
if(!started){ console.log('未觸發守護波'); await b.close(); process.exit(0); }
// 守護波啟動，逐幀量 phase(combat?) + fireRain gate
const rec=[];
for(let i=0;i<40;i++){
  const s=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(x=>x?.name==='WaveSystem');const ge=ws.getGuardEvent?.();const fr=ws.getActiveFireRainPreset?.();return {combat:ge?ge.isCombatPhase?.():null, fireRain:!!fr, finished:ge?ge.isFinished?.():true};});
  rec.push(s);
  if(s.finished) break;
  await pg.waitForTimeout(120);
}
// 分析：combat 前(false)有無 fireRain；combat 後(true)火雨
const preCombat=rec.filter(r=>r.combat===false);
const inCombat=rec.filter(r=>r.combat===true);
console.log('守護波開場(combat=false)取樣', preCombat.length, '幀，其中有火雨的:', preCombat.filter(r=>r.fireRain).length, preCombat.every(r=>!r.fireRain)?'PASS(開場無火雨)':'★開場就降火雨');
console.log('combat 階段取樣', inCombat.length, '幀，有火雨的:', inCombat.filter(r=>r.fireRain).length, (inCombat.length===0||inCombat.some(r=>r.fireRain))?'(combat 有火雨 or 該 preset 無 attachFireRain)':'');
await b.close(); console.log('DONE');
