import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1200);
const r=await pg.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];const sp=p.anim.sprite;
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  p.tryStartAttack(0.1,0.333,1);
  p.startHitlag(0.2);
  const seq=[];
  for(let i=0;i<22;i++){ await wait(20); seq.push({frame:sp.anims?.currentFrame?.index, key:(sp.anims?.currentAnim?.key||'').replace('Human__',''), hitlag:p.isInHitlag(), hlr:+p.hitlagRemaining.toFixed(2)}); }
  return seq;
});
let pauseFrame=null, resumed=false, hitlagSeen=false;
for(const s of r){ if(s.hitlag){ hitlagSeen=true; if(pauseFrame===null) pauseFrame=s.frame; } if(hitlagSeen && !s.hitlag) resumed=true; }
console.log('hitlag(定格)首次時 attack frame:', pauseFrame, (pauseFrame!==null&&pauseFrame>=4)?'PASS(揮擊幀後定格,非卡起手frame<4)':(pauseFrame!==null?'★frame'+pauseFrame:'未定格'));
console.log('hitlag 後 resume 恢復:', resumed?'PASS(不殘留卡定格)':'★沒恢復/取樣不足');
// 印關鍵幀
console.log('序列(節錄):', JSON.stringify(r.filter((s,i)=>i%2===0).map(s=>`f${s.frame}${s.hitlag?'*':''}`)));
await b.close(); console.log('DONE');
