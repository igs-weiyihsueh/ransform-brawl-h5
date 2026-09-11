/**
 * formationConfig — 陣型座標生成純函式（怪物 AI 移植第 2 塊，鬥破規格第 6 節）。
 * ★零 Phaser 純函式：征騎執行系統(EnemyFormation) + 波騎編輯預覽 **都 import computeFormationSlots**，
 *   確保編輯器預覽 100% ＝ 遊戲（decision d910b8ef 1:1）。單位一律 unit（呼叫端 ×PPU 轉 px）。
 *
 * ★型別單一來源＝levelSchema（異靈定案）：FormationConfig/FormationType 定在 levelSchema
 *   （硬規範零遊戲依賴、編輯器也 import），本檔 import 它、re-export 方便遊戲端型別+函式同處取用。
 *   不可反向讓 levelSchema import 遊戲層。
 * ★computeFormationSlots(config) 回「各 slot 相對錨點的偏移(unit)」；呼叫端再 ×PPU + anchor 平移。
 */
import type { Vec2 } from '@/systems/hitDetection';
import type { FormationType, FormationConfig } from '@/config/levelSchema';

export type { FormationType, FormationConfig };

/** 旋轉一個偏移向量 rad（繞原點）。 */
function rotate(v: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * ★核心共用純函式：算陣型各 slot「相對錨點的偏移」(unit)。
 *   回傳陣列已套 facingDeg 旋轉（陣型整體朝 facing）；呼叫端只需 ×PPU + 加 anchor。
 *   零 Phaser、determinstic（同 config 恆同結果）→ 編輯預覽與遊戲執行同源 1:1。
 * @param config 陣型設定。
 * @returns 各 slot 相對錨點偏移（unit），長度＝實際 slot 數。
 */
export function computeFormationSlots(config: FormationConfig): Vec2[] {
  const raw = computeRawSlots(config); // 未旋轉（陣型本地座標，+x 為 facing 0 方向）
  const rad = (config.facingDeg * Math.PI) / 180;
  return raw.map((p) => rotate(p, rad));
}

/** 未旋轉的本地 slot 偏移（+x＝facing 0；各形狀以幾何中心為原點）。 */
function computeRawSlots(config: FormationConfig): Vec2[] {
  const d = config.distance;
  const n = Math.max(1, Math.min(30, Math.floor(config.count)));
  switch (config.type) {
    case 'Line': {
      // 沿 y 軸排一列（垂直於 facing），置中：i=0..n-1 → y = (i-(n-1)/2)×d，x=0。
      const out: Vec2[] = [];
      for (let i = 0; i < n; i += 1) out.push({ x: 0, y: (i - (n - 1) / 2) * d });
      return out;
    }
    case 'Triangle': {
      // 等腳三角：頂點在前(+x)，往後(-x)逐排加寬。頂角 triangleAngle。
      const angle = ((config.triangleAngle ?? 60) * Math.PI) / 180;
      const halfSpread = Math.tan(angle / 2); // 每往後 1 距，橫向擴 halfSpread
      const out: Vec2[] = [];
      let placed = 0;
      let row = 0;
      while (placed < n) {
        const rowCount = row + 1; // 第 row 排放 row+1 個
        const backX = -row * d; // 往後
        const spreadY = row * d * halfSpread;
        for (let k = 0; k < rowCount && placed < n; k += 1) {
          const y = rowCount === 1 ? 0 : (k / (rowCount - 1) - 0.5) * 2 * spreadY;
          out.push({ x: backX, y });
          placed += 1;
        }
        row += 1;
      }
      return out;
    }
    case 'Square': {
      // 方/矩形陣：rows×cols（省略由 count 近正方推），置中格點。
      const cols = config.cols ?? Math.ceil(Math.sqrt(n));
      const rows = config.rows ?? Math.ceil(n / cols);
      const out: Vec2[] = [];
      let placed = 0;
      for (let r = 0; r < rows && placed < n; r += 1) {
        for (let c = 0; c < cols && placed < n; c += 1) {
          out.push({ x: (r - (rows - 1) / 2) * d, y: (c - (cols - 1) / 2) * d });
          placed += 1;
        }
      }
      return out;
    }
    case 'Circle': {
      // 圓周均分 n 個；半徑 circleRadius 或由 count×distance 推（周長=n×d → r=n×d/2π）。
      const r = config.circleRadius ?? (n * d) / (2 * Math.PI);
      const out: Vec2[] = [];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return out;
    }
    case 'Hexagonal': {
      // 六角：中心 + 每環 6×ring 個（環半徑 ring×d）。hexRings 決定環數；受 count 上限截斷。
      const rings = config.hexRings ?? 1;
      const out: Vec2[] = [{ x: 0, y: 0 }]; // 中心
      for (let ring = 1; ring <= rings && out.length < n; ring += 1) {
        const perRing = 6 * ring;
        for (let i = 0; i < perRing && out.length < n; i += 1) {
          const a = (i / perRing) * Math.PI * 2;
          out.push({ x: Math.cos(a) * ring * d, y: Math.sin(a) * ring * d });
        }
      }
      return out.slice(0, n);
    }
    default:
      return [{ x: 0, y: 0 }];
  }
}
