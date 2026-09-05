// 新#3-5 驗: 不打怪等 idle 8s → grabber 抓 → 被抓 UI(倒數) + grabber idle + 倒數完自動掙脫。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const fp = path.join(distDir, u);
  if (!fp.startsWith(distDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode=404; res.end('404'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
// 生怪(戰鬥階段 idle 才累積), 之後完全不攻擊、不移動 → idle 8s → grabber。
// 先投幣進場(C)讓 P1 離開待機(isWaiting=false), 否則 idle 不累積。
await page.keyboard.press('KeyC');
await page.waitForTimeout(1500); // 等進場動畫落地
for (let k=0;k<3;k++){ await page.keyboard.press('KeyR'); await page.waitForTimeout(200); }
function snap(){ return page.evaluate(()=>{
  const g = window.__PHASER_GAME__;
  const gs = g.scene.getScene('GameScene');
  const player = gs.children.list.find((o)=>o.type==='Sprite'&&o.texture&&/Human|SunWukong/.test(o.texture.key||''));
  const enemies = gs.children.list.filter((o)=>o.type==='Sprite'&&o.texture&&/Enemy_/.test(o.texture.key||''));
  const hint = gs.children.list.find((o)=>o.type==='Text'&&/掙脫/.test(o.text||''));
  const anims = enemies.map((e)=>e.anims&&e.anims.currentAnim?e.anims.currentAnim.key:'');
  // 找 GrabSystem 讀 idle（registry 系統陣列）。
  let idle=null, dbg=null;
  try {
    const sys=(gs.systems||[]).find((x)=>x&&x.name==='GrabSystem');
    if(sys&&typeof sys.getIdle==='function') idle=Math.round(sys.getIdle(0)*10)/10;
    const ctx = sys && sys.ctx;
    if(ctx){
      const p0 = ctx.players[0];
      dbg = {
        combo: ctx.combo&&ctx.combo.getCombo?ctx.combo.getCombo(0):'?',
        waiting: p0&&p0.isWaiting?p0.isWaiting():'?',
        entering: p0&&p0.isEntering?p0.isEntering():'?',
        livingNonGrabber: ctx.getEnemies().filter((e)=>!e.isDead()&&!e.isGrabber()).length,
      };
    }
  } catch(e){ dbg={err:String(e)}; }
  return { hintText: hint?hint.text.replace(/\n/g,' '):null, hintVisible: hint?hint.visible:false, enemyCount: enemies.length, playerActive: !!player, idle, dbg, grabberIdle: anims.some((a)=>/idle/i.test(a)) };
});}
let sawHint=false, sawIdleGrabber=false, sawEscape=false, lastCountdownSeen=null;
for (let i=0;i<220;i++){ // ~22s
  await page.waitForTimeout(100);
  const s = await snap();
  if (s.hintVisible && s.hintText){ sawHint=true; const m=s.hintText.match(/(\d+)/); if(m) lastCountdownSeen=Number(m[1]); }
  if (s.hintVisible && s.grabberIdle) sawIdleGrabber=true;
  if (sawHint && !s.hintVisible) sawEscape=true;
  if (i%30===0) console.log(`  t=${(i*0.1).toFixed(1)}s idle=${s.idle} dbg=${JSON.stringify(s.dbg)}`);
  if (sawEscape) break;
}
console.log('[新#3-5 驗] 被抓UI提示出現=', sawHint, ' | grabber抓住時有idle動畫=', sawIdleGrabber, ' | 倒數完/掙脫後UI消失=', sawEscape, ' | 最後看到倒數=', lastCountdownSeen);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-grab.png') });
await browser.close(); server.close();
