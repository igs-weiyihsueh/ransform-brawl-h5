import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url)); const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await pg.waitForTimeout(2800);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1200);
await pg.keyboard.press('KeyZ');
const rec=[];
for(let i=0;i<16;i++){
  await pg.waitForTimeout(30);
  const s=await pg.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];const sp=p.anim?.sprite;
    // slash VFX sprite 是否已出現
    const vfx=gs.children.list.filter(o=>o.type==='Sprite'&&o.anims?.currentAnim?.key&&/slash|attack|vfx/i.test(o.anims.currentAnim.key)&&o!==sp);
    return { anim:sp?.anims?.currentAnim?.key, frame:sp?.anims?.currentFrame?.index, fps: sp?.anims?.currentAnim?.frameRate, totalFrames: sp?.anims?.currentAnim?.frames?.length, vfxCount: vfx.length, vfxAlpha: vfx[0]?+vfx[0].alpha.toFixed(2):null, vfxScale: vfx[0]?+vfx[0].scaleX.toFixed(2):null };
  });
  rec.push({t:i*30,...s});
}
console.log('attack 動畫 + VFX 時序:');
for(const r of rec) console.log(`  t${r.t} anim=${r.anim} frame=${r.frame}/${r.totalFrames} fps=${r.fps} vfx=${r.vfxCount}${r.vfxAlpha!==null?' alpha='+r.vfxAlpha+' scale='+r.vfxScale:''}`);
// 判定: (B) attack totalFrames=10 fps=18; (A) vfx 首次出現的 t (應 >=90ms 延後)
const atkFrame=rec.find(r=>r.anim==='Human__attack');
const vfxFirst=rec.find(r=>r.vfxCount>0);
console.log('(B) attack 幀數/fps:', atkFrame?atkFrame.totalFrames+'幀 @'+atkFrame.fps+'fps':'?', (atkFrame&&atkFrame.totalFrames===10&&atkFrame.fps===18)?'PASS(去尾幀+降fps)':'★');
console.log('(A) VFX 首次出現 t:', vfxFirst?vfxFirst.t+'ms':'未見', vfxFirst&&vfxFirst.t>=60?'PASS(延後，揮擊先播)':'(看值)', vfxFirst?'alpha='+vfxFirst.vfxAlpha+' scale='+vfxFirst.vfxScale:'');
await b.close(); server.close(); console.log('DONE');
