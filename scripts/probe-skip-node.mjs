// Debug N 熱鍵驗證：按 N → WaveSystem 當前節點跳下一個（Spawn 未達配額也跳、守護波 forceFinish cleanup）。
// 用法：npm run build && npm run preview & ; node scripts/probe-skip-node.mjs
import { chromium } from 'playwright';
const b=await chromium.launch(); const pg=await b.newPage();
await pg.goto('http://localhost:4173/',{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1500);
const idx=()=>pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.systems.find(s=>s?.name==='WaveSystem').nodeIndex;});
const before=await idx(); await pg.keyboard.press('KeyN'); await pg.waitForTimeout(200); const after=await idx();
console.log('N skip node:', before, '→', after, after>before?'PASS':'FAIL');
await b.close();
