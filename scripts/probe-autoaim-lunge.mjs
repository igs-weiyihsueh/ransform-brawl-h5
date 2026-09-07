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
// 生一隻怪在玩家「上方」(非水平)，測 auto-aim 是否朝上（非純水平 facing）
const setup=await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=gs.ctx;const p=ctx.players[0];const sp=ctx.spawner;
  const pp=p.getPosition();
  // 怪放玩家正上方（y 小）
  const e=sp.spawn('Enemy_Rush', pp.x+20, pp.y-200);
  return { px:Math.round(pp.x), py:Math.round(pp.y), ex:Math.round(pp.x+20), ey:Math.round(pp.y-200) };
});
console.log('setup 玩家', setup.px, setup.py, '怪在上方', setup.ex, setup.ey);
// 按攻擊(KeyZ)，量 lastCircle/Fan/OBB center 是否朝怪(上方)偏、lunge 是否啟動往上
await pg.keyboard.press('KeyZ');
await pg.waitForTimeout(30);
const r1=await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=gs.ctx;const p=ctx.players[0];
  const pcs=gs.systems.find(s=>s?.name==='PlayerControlSystem');
  const pp=p.getPosition();
  return { lunging:p.isLunging?.(), py:Math.round(pp.y), lungeVelY: p.lungeVel?.y };
});
console.log('按攻擊後 lunging=', r1.lunging, '(往上戳 py 應變小)');
// 等攻擊 hitDelay 到，量 shape center（朝怪=偏上，center.y < pos.y）
await pg.waitForTimeout(200);
const shape=await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const pcs=gs.systems.find(s=>s?.name==='PlayerControlSystem');const p=gs.ctx.players[0];
  const c=pcs.getDebugCircle?.()||pcs.lastCircle; const f=pcs.lastFan; const o=pcs.lastOBB;
  const pos=p.getPosition();
  const sh=c||f||o;
  return sh?{ centerX:Math.round(sh.center.x), centerY:Math.round(sh.center.y), posX:Math.round(pos.x), posY:Math.round(pos.y), type:c?'circle':f?'fan':'obb', rotation:sh.rotation!==undefined?+sh.rotation.toFixed(2):null }:null;
});
console.log('攻擊 shape:', JSON.stringify(shape));
if(shape) console.log('shape center 朝怪(上方,centerY<posY):', shape.centerY < shape.posY ? 'PASS(朝上=朝怪，非純水平)' : '★沒朝怪');
// lunge 前戳後不回彈：連續量 py 單調往上(變小)後停，不反彈變大
const pys=[];
for(let i=0;i<8;i++){ await pg.waitForTimeout(30); const y=await pg.evaluate(()=>Math.round(window.__PHASER_GAME__.scene.getScene('GameScene').ctx.players[0].getPosition().y)); pys.push(y); }
console.log('lunge 後 py 序列:', JSON.stringify(pys));
const noRebound = pys.every((y,i)=> i===0 || y<=pys[i-1]+2); // 不回彈(不往下增大)
console.log('lunge 不回彈:', noRebound?'PASS(單調前進/停，不反彈)':'★回彈');
await b.close(); server.close(); console.log('DONE');
