import Phaser from 'phaser';
import { multiplyScales, type TimeScaleLayer } from '@/systems/timeScaleMath';

/**
 * GlobalJuice — 全域手感骨幹（怪物 AI 移植第 4 塊，鬥破規格 12.1）：
 *  ①TimeScaleCounter（加性乘法層 effective scale，全域頓幀/慢動作）②camera.shake ③Boss-gate 觸發。
 *
 * ★單一注入：GameScene.update 讀 getEffectiveScale() 算 scaledDt 往下傳（不重寫各 update(dt) 站點）。
 * ★預設無層＝1.0＝scaledDt===dt＝byte 同現況（不破 1450 測）。
 * ★hitstop 倒數用 real dt（tick(realDt)，不吃自己的 scale），否則 timeScale=0 把自己頓死永不解除。
 * ★★共屏保護（變身-leader 硬規則、落碼）：全域效果（camera.shake / 全域 hitstop）**預設只 Boss 級事件**觸發
 *    （triggerBossImpact）；**一般怪 heavy 命中不呼全域**（per-hit 全域關）——heavy 份量走 block3 局部特效。
 *    globalEffectsBossOnly 預設 true；per-hit 想震全場要顯式關掉此保護（不建議）。
 */

/** Boss-gate + 手感 config（保守預設；可調）。 */
export interface GlobalJuiceConfig {
  /** ★全域效果只給 Boss 級事件（預設 true＝共屏保護；per-hit 全域關）。 */
  globalEffectsBossOnly: boolean;
  /** Boss 衝擊震動強度（0~1，Phaser shake intensity）。 */
  bossShakeIntensity: number;
  /** Boss 衝擊震動時長（秒）。 */
  bossShakeDurationSec: number;
  /** Boss 衝擊全域頓幀時長（秒；0=不頓）。 */
  bossHitstopSec: number;
}

export const DEFAULT_GLOBAL_JUICE: GlobalJuiceConfig = {
  globalEffectsBossOnly: true, // ★預設保守：全域效果 Boss-only、per-hit 全域關
  bossShakeIntensity: 0.012,
  bossShakeDurationSec: 0.25,
  bossHitstopSec: 0.08,
};

export class GlobalJuice {
  private readonly scene: Phaser.Scene;
  private readonly config: GlobalJuiceConfig;
  /** 時間縮放層（加性乘法）：預設空＝1.0。 */
  private readonly layers = new Map<TimeScaleLayer, number>();
  /** 全域 hitstop 剩餘（秒，real dt 倒數）。>0 期間 'code' 層＝0（全域凍）。 */
  private hitstopRemaining = 0;

  constructor(scene: Phaser.Scene, config: GlobalJuiceConfig = DEFAULT_GLOBAL_JUICE) {
    this.scene = scene;
    this.config = config;
  }

  /** 設某層縮放（加性乘法層之一）；1.0＝該層無效。 */
  pushTimeScale(layer: TimeScaleLayer, value: number): void {
    this.layers.set(layer, value);
  }
  /** 移除某層（回 1.0 該層）。 */
  popTimeScale(layer: TimeScaleLayer): void {
    this.layers.delete(layer);
  }
  /** 生效總縮放＝∏ 各層 × (hitstop 中→0)。預設無層+無 hitstop＝1.0。 */
  getEffectiveScale(): number {
    const base = multiplyScales(this.layers);
    return this.hitstopRemaining > 0 ? 0 : base;
  }

  /**
   * ★每幀 real dt 推進 hitstop 倒數（GameScene.update 用 real dt 呼，不吃 scale）。
   * hitstop 期間 getEffectiveScale()=0（全域凍）；倒數歸零自動解除。★用 real dt 才不會把自己頓死。
   */
  tick(realDt: number): void {
    if (this.hitstopRemaining > 0) {
      this.hitstopRemaining -= realDt;
      if (this.hitstopRemaining < 0) this.hitstopRemaining = 0;
    }
  }

  /**
   * ★Boss 級衝擊（大招/登場/死亡才呼）：全域 camera.shake + 全域 hitstop。
   *  ★★一般怪 heavy 命中**不呼此**（per-hit 全域關、共屏保護）——heavy 份量走 block3 局部。
   * @param opts 覆蓋強度/時長（省略用 config 預設）。
   */
  triggerBossImpact(opts?: { shakeIntensity?: number; shakeDurationSec?: number; hitstopSec?: number }): void {
    const inten = opts?.shakeIntensity ?? this.config.bossShakeIntensity;
    const shakeSec = opts?.shakeDurationSec ?? this.config.bossShakeDurationSec;
    const stopSec = opts?.hitstopSec ?? this.config.bossHitstopSec;
    this.shake(inten, shakeSec);
    if (stopSec > 0) this.hitstopRemaining = Math.max(this.hitstopRemaining, stopSec);
  }

  /**
   * camera.shake（Phaser 內建：暫態疊加偏移、自動歸位不殘留；相容 block-offset scrollX）。
   * ★offset 無關（既有 camera）。intensity=Phaser 比例（0~1，實際位移=viewport×intensity）。
   * @param intensity 0~1。
   * @param durationSec 秒。
   */
  shake(intensity: number, durationSec: number): void {
    const cam = this.scene.cameras?.main;
    if (!cam || intensity <= 0 || durationSec <= 0) return;
    cam.shake(durationSec * 1000, intensity, false); // force=false：不打斷正在進行的同類（疊加感）
  }

  /** 是否全域頓幀中（GameScene 判豁免用）。 */
  isHitstopped(): boolean {
    return this.hitstopRemaining > 0;
  }
}
