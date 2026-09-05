// 怪物登場 probe: 開場一般波 → 該點冒預警圈(低 depth graphics)淡入 → 淡入後敵人原地出現。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const fp = path.join(distDir, u);
  if (!fp.startsWith(distDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode = 404; res.end('404'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// 啟動一般 Spawn 波 preview 關卡（→ WaveSystem 一般波 → 預警圈 → 3s 後敵人）。
await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const level = { id: 'probe', nodes: [{ nodeType: 'Spawn', killQuota: 20, maxAlive: 5, spawnThreshold: 5, spawnInterval: 0.5, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] }] };
  g.scene.stop('BootScene'); g.scene.stop('GameScene');
  g.scene.start('GameScene', { previewLevels: [level] });
});
// 開場 ~1s：預警圈淡入中、敵人應「尚未」出現（延遲 3s）。
await page.waitForTimeout(1200);
const early = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  // 召喚法陣 = Image(depth -6, texture ui-summon-circle)。
  const summons = gs.children.list.filter((o) => o.type === 'Image' && o.depth === -6 && o.texture && o.texture.key === 'ui-summon-circle');
  const enemies = gs.children.list.filter((o) => o.type === 'Sprite' && o.depth === 10);
  return { summonCircles: summons.length, summonAlpha: summons[0] ? Math.round(summons[0].alpha * 100) / 100 : null, summonAngle: summons[0] ? Math.round(summons[0].angle) : null, summonW: summons[0] ? Math.round(summons[0].displayWidth) : null, enemyCount: enemies.length };
});
console.log('[登場 probe] 開場~1.2s(法陣淡入中):', JSON.stringify(early));
// 等預警(3s)+緩衝 → 敵人出現。
await page.waitForTimeout(5000);
const after = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const sprites = gs.children.list.filter((o) => o.type === 'Sprite');
  const warnings = gs.children.list.filter((o) => o.type === 'Graphics' && o.depth === -6);
  const depths = [...new Set(sprites.map((s) => s.depth))];
  return { spriteCount: sprites.length, spriteDepths: depths, warningCircles: warnings.length };
});
console.log('[登場 probe] ~4s(預警完敵人出現):', JSON.stringify(after));
await page.screenshot({ path: path.join(__dirname, '..', 'probe-shot-spawn.png') });
console.log('[登場 probe] screenshot: probe-shot-spawn.png');
await browser.close(); server.close();
