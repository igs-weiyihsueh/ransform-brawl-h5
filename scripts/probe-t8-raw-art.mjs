// #8 地基真相: 直接渲染「原始貼圖幀(完全不 flip)」放大, 看每種敵人 idle/move 美術「天生朝哪」。
// 移除所有 flip 邏輯+遊戲雜訊, 只看美術基準。大圖給視覺肉眼(小圖不可靠)。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'public');
const MIME={'.png':'image/png','.html':'text/html'};
const server = http.createServer((req,res)=>{ let u=decodeURIComponent(req.url.split('?')[0]); const fp=path.join(root,u); if(fs.existsSync(fp)&&fs.statSync(fp).isFile()){res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); return;} res.statusCode=404; res.end('404'); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:900,height:500}});
const cases=[
  ['Enemy_Rush','idle'],['Enemy_Rush','move'],
  ['Enemy_Ranged','idle'],['Enemy_Ranged','move'],
  ['Enemy_Elite','idle'],['Enemy_Elite','move'],
];
for(const [t,st] of cases){
  const url=`http://127.0.0.1:${port}/assets/images/characters/${t}/${st}/frame_00.png`;
  // 放大 3x + 綠色中線(左/右參考) + 標籤。原圖不翻。
  await page.setContent(`<html><body style="margin:0;background:#333;display:flex;flex-direction:column;align-items:center;justify-content:center;height:500px">
    <div style="color:#fff;font:20px sans-serif;margin-bottom:8px">${t} / ${st}  (原始貼圖, 不flip. 左=L 右=R)</div>
    <div style="position:relative">
      <div style="position:absolute;left:50%;top:0;bottom:0;width:2px;background:#0f0"></div>
      <img src="${url}" style="width:384px;height:384px;image-rendering:pixelated">
    </div>
    <div style="color:#fff;font:16px sans-serif;margin-top:8px">← 左(L)          右(R) →</div>
  </body></html>`);
  await page.waitForTimeout(300);
  const fn=`probe-shot-t8raw-${t}-${st}.png`;
  await page.screenshot({ path: path.join(__dirname,'..',fn) });
  console.log(`${t}/${st} 原始幀 → ${fn}`);
}
await browser.close(); server.close();
console.log('DONE');
