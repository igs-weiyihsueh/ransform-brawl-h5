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
// 按住 D（往右移動意圖）+ 按 X 觸發衝刺，真實走 InputSystem→PlayerControl 路徑
await pg.keyboard.down('KeyD'); await pg.waitForTimeout(50);
await pg.keyboard.press('KeyX');
// 逐幀（用 rAF 時間）抓 shield vs 角色位置
const rec=[];
for(let i=0;i<14;i++){
  await pg.waitForTimeout(16);
  const s=await pg.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];
    const sh=gs.children.list.filter(o=>o.texture&&o.texture.key==='vfx-player-dash-shield'&&o.active);
    const pos=p.getPosition();
    return { dashing:p.isDashing(), px:Math.round(pos.x), py:Math.round(pos.y), shield: sh[0]?{x:Math.round(sh[0].x),y:Math.round(sh[0].y),alpha:+sh[0].alpha.toFixed(2),scale:+sh[0].scaleX.toFixed(2)}:null };
  });
  rec.push({i,...s, offset: s.shield?s.shield.x-s.px:null});
}
await pg.keyboard.up('KeyD');
await pg.waitForTimeout(400);
const after=await pg.evaluate(()=>gs=window.__PHASER_GAME__.scene.getScene('GameScene').children.list.filter(o=>o.texture&&o.texture.key==='vfx-player-dash-shield'&&o.active).length);
for(const r of rec) console.log(`f${r.i} dash=${r.dashing} px=${r.px} shield=${JSON.stringify(r.shield)} off=${r.offset}`);
const df=rec.filter(r=>r.dashing&&r.shield);
const offs=df.map(r=>r.offset);
console.log('衝刺期間有 shield 幀數:', df.length);
console.log('offset(shield.x-px) 恆定~34:', offs.length&&Math.max(...offs)-Math.min(...offs)<=4?'PASS':'★', JSON.stringify(offs));
console.log('shield 隨本體移動:', df.length>1&&Math.abs(df[df.length-1].shield.x-df[0].shield.x)>30?'PASS':'★', 'alpha 樣本='+JSON.stringify(df.map(r=>r.shield.alpha)));
console.log('結束後銷毀:', after===0?'PASS':'★殘留'+after);
await b.close(); server.close(); console.log('DONE');
