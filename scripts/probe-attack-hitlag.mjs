import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url)); const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch(); const pg=await b.newPage(); await pg.setViewportSize({width:400,height:400});
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await pg.waitForTimeout(2800);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1200);
fs.mkdirSync('/tmp/hitlagseq',{recursive:true});
const clip={x:120,y:110,width:180,height:180};
// 用 pcs 手動驅動：生怪在攻擊範圍(~150px右)、模擬 justPressedAttack、逐幀 pcs.update 讀 render tex + hitlag + px + 截圖
const rec = [];
await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];const pp=p.getPosition();window.__e=gs.ctx.spawner.spawn('Enemy_Rush', pp.x+150, pp.y);});
await pg.waitForTimeout(100);
// 觸發攻擊
await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];const pcs=gs.systems.find(s=>s?.name==='PlayerControlSystem');const src=p.inputSource||p.getInputSource?.();let f=false;const o=src.justPressedAttack?.bind(src);const om=src.getMoveVector?.bind(src);src.getMoveVector=()=>({x:0,y:0});src.justPressedAttack=()=>{const v=!f;f=true;return v;};pcs.update(1/60);src.justPressedAttack=o;src.getMoveVector=om;});
for(let i=0;i<10;i++){
  const s=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const p=gs.ctx.players[0];const sp=p.anim?.sprite;const pcs=gs.systems.find(s=>s?.name==='PlayerControlSystem');pcs.update(1/60);return {tex:sp?.texture?.key, hitlag:p.isInHitlag?.(), px:Math.round(p.getPosition().x), paused: sp?.anims?.isPlaying===false};});
  await pg.screenshot({path:`/tmp/hitlagseq/f${i}.png`, clip});
  rec.push({i,...s});
  await pg.waitForTimeout(20);
}
console.log('攻擊(命中怪)逐幀 render tex / hitlag / px / animPaused:');
for(const r of rec) console.log(`  f${r.i} tex=${r.tex} hitlag=${r.hitlag} px=${r.px} paused=${r.paused}`);
const atk=[...new Set(rec.filter(r=>/attack/.test(r.tex||'')).map(r=>r.tex))];
console.log('攻擊揮擊不同幀數:', atk.length, JSON.stringify(atk), atk.length>=3?'PASS(逐幀揮,非凍)':'★');
const hl=rec.filter(r=>r.hitlag);
if(hl.length){const pxSet=[...new Set(hl.map(r=>r.px))];console.log('hitlag 期間 px:', JSON.stringify(hl.map(r=>r.px)), pxSet.length===1?'PASS(位移凍)':'(有變)');}
else console.log('(此次無 hitlag 幀取樣到，命中在幀間)');
await b.close(); server.close(); console.log('DONE');
