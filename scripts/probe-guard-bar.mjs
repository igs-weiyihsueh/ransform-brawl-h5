import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,120)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1500);
// N 推進到守護波，量 guardGfx 可見 + root 滑走 + guardText
let caught=false;
for(let i=0;i<30 && !caught;i++){
  const st=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ws=gs.systems.find(s=>s?.name==='WaveSystem');const ge=ws.getGuardEvent?.();const pbs=gs.systems.find(s=>s?.name==='ProgressBarSystem');return {hasGuard:!!ge&&!ge.isFinished?.(), rootY:pbs?.root?.y, guardVisible:pbs?.guardGfx?.visible, guardTextVisible:pbs?.guardText?.visible, guardText:pbs?.guardText?.text, shownY:pbs?.root?.y};});
  if(st.hasGuard){
    await pg.waitForTimeout(400); // 讓 root 滑走
    const s=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const pbs=gs.systems.find(x=>x?.name==='ProgressBarSystem');const gg=pbs.guardGfx;return {rootY:Math.round(pbs.root.y), guardGfxScrollFactor:gg.scrollFactorX, guardVisible:gg.visible, guardTextVis:pbs.guardText.visible, guardText:pbs.guardText.text, guardGfxY:gg.y};});
    console.log('守護波中: rootY='+s.rootY+' (主條滑走), guardGfx visible='+s.guardVisible+' guardGfx.y='+s.guardGfxY+' (獨立不隨root)');
    console.log('金條秒數文字: visible='+s.guardTextVis+' text="'+s.guardText+'"');
    // guardGfx 是獨立 graphics (y=0, 畫在絕對座標)，不在 root → root 滑走不影響
    console.log('金條可見(不隨主條滑走隱藏):', s.guardVisible?'PASS':'★');
    console.log('秒數文字顯示:', (s.guardTextVis && /^\d+$/.test(s.guardText))?'PASS(顯 '+s.guardText+')':'★');
    // 等幾秒看秒數縮短
    const t1=s.guardText;
    await pg.waitForTimeout(1500);
    const t2=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.systems.find(x=>x?.name==='ProgressBarSystem').guardText.text;});
    console.log('秒數倒數:', t1+'→'+t2, Number(t2)<Number(t1)?'PASS(縮短)':'(相近/看值)');
    caught=true;
  }
  await pg.keyboard.press('KeyN'); await pg.waitForTimeout(500);
}
if(!caught) console.log('未觸發守護波');
await b.close(); console.log('DONE');
