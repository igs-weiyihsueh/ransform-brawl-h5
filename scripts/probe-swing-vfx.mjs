import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1200);
// 觸發攻擊(直接 tryStartAttack 帶 onSwingFrame — 但實際路徑是 PlayerControl；用 KeyZ 走真實)
await pg.keyboard.press('KeyZ');
const rec=[];
for(let i=0;i<14;i++){
  await pg.waitForTimeout(25);
  const s=await pg.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];const sp=p.anim.sprite;
    const vfx=gs.children.list.filter(o=>o.type==='Sprite'&&o!==sp&&o.anims?.currentAnim?.key&&/slash|attack_vfx|player.*slash/i.test(o.anims.currentAnim.key));
    return { animKey:sp.anims?.currentAnim?.key, frame:sp.anims?.currentFrame?.index, vfxCount:vfx.length };
  });
  rec.push({t:i*25,...s});
}
console.log('attack 動畫 frame vs 斬光 VFX 出現:');
let vfxAppearFrame=null;
for(const r of rec){
  console.log(`  t${r.t} anim=${r.animKey} frame=${r.frame} vfx=${r.vfxCount}`);
  if(vfxAppearFrame===null && r.vfxCount>0 && /attack/.test(r.animKey||'')) vfxAppearFrame=r.frame;
}
console.log('斬光首次出現時 attack 動畫在 frame:', vfxAppearFrame, (vfxAppearFrame!==null && vfxAppearFrame>=4)?'PASS(綁揮擊幀>=4，非 hitDelay frame~2 計時)':'(看值)');
await b.close(); console.log('DONE');
