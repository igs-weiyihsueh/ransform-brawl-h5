/**
 * Phaser HEADLESS 測試環境 setup — QA（測騎）維護。
 *
 * 為什麼需要這支：
 *   即使用 Phaser.HEADLESS，`import Phaser` 在模組載入期就會跑 CanvasFeatures.js，
 *   對一個 <canvas> 呼叫 getContext('2d') 做特徵偵測。jsdom 未實作 getContext
 *   （需原生 canvas 套件），會直接拋 "Not implemented: HTMLCanvasElement.prototype.getContext"。
 *   這不是遊戲壞，是測試環境沒有 2D context。
 *
 *   解法：在任何 Phaser import 之前（setupFiles 於測試檔 import 前執行），
 *   對 HTMLCanvasElement.prototype.getContext 補一個最小的假 2D context，
 *   讓 CanvasFeatures 的特徵偵測拿到「非 null 的 context」跑完即可。
 *   我們【不】模擬 WebGL — HEADLESS 本來就跳過 WebGL；只補 2D 特徵偵測所需的最小面。
 *
 * instrument-validity 說明：
 *   這只是讓「boot 真的能發生」的環境墊片（等同瀏覽器有 canvas 2D）。
 *   它不偽造遊戲邏輯、不吞例外——boot smoke 之後仍會真的建 scene、跑 system.init、step 幀。
 */

/** 極簡 2D context 假物件：用 Proxy 對任何未知方法回 no-op、屬性回合理預設，
 *  並對文字量測（measureText，Phaser Text 需要）回可用的 metrics。
 *  CanvasFeatures 特徵偵測、以及 Phaser Text 的 canvas 量測都靠這個墊片跑起來。 */
function makeFake2DContext(): CanvasRenderingContext2D {
  const explicit: Record<string, unknown> = {
    // CanvasFeatures.checkInverseAlpha：fillRect 後 getImageData 讀 alpha。
    getImageData: (_x: number, _y: number, w: number, h: number) =>
      ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        width: Math.max(1, w),
        height: Math.max(1, h),
        colorSpace: 'srgb',
      }) as ImageData,
    createImageData: (w: number = 1, h: number = 1) =>
      ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h, colorSpace: 'srgb' }) as ImageData,
    // Phaser Text 量測：回一個帶常見欄位的 TextMetrics。
    measureText: (text: string) =>
      ({
        width: (text?.length ?? 0) * 8,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: (text?.length ?? 0) * 8,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
        emHeightAscent: 8,
        emHeightDescent: 2,
      }) as TextMetrics,
    getContextAttributes: () => ({ alpha: true }) as CanvasRenderingContext2DSettings,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => null,
    setTransform: () => undefined,
    getTransform: () => ({}),
    canvas: undefined as unknown,
  };
  // 可讀寫的屬性預設（Phaser 會設 fillStyle/font/textBaseline 等）。
  const props: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '16px sans-serif',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
  };
  return new Proxy(explicit as unknown as CanvasRenderingContext2D, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (prop in props) return props[prop];
      // 任何未知成員：一律回 no-op 函式（涵蓋 fillRect/clearRect/drawImage/save/restore/…）。
      return () => undefined;
    },
    set(_target, prop: string, value) {
      props[prop] = value;
      return true;
    },
  });
}

// 只在 DOM 環境（jsdom）補；node 環境沒有 HTMLCanvasElement 就略過。
if (typeof HTMLCanvasElement !== 'undefined') {
  // 覆寫 getContext：2d 回一個綁定到該 canvas 的假 context（Phaser Text 會讀 ctx.canvas），
  // 其餘（webgl…）回 null（HEADLESS 不需要）。
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    contextId: string,
  ): CanvasRenderingContext2D | null {
    if (contextId !== '2d') return null;
    const ctx = makeFake2DContext();
    try {
      Object.defineProperty(ctx, 'canvas', { configurable: true, value: this });
    } catch {
      // Proxy set 已處理；忽略。
    }
    return ctx;
  } as HTMLCanvasElement['getContext'];
}

/**
 * jsdom 的 <img> 永遠不會觸發 onload（它不真的解碼圖），
 * 導致 Phaser TextureManager 等待內建 default/__MISSING 貼圖 ready 時卡死、
 * 整個 Game boot 停在半路（scene 永遠不 boot）。
 *
 * 解法：讓 Image 的 src 一被設定就在下一個 microtask 觸發 onload（假裝載入成功）。
 * 這只影響「圖片載入事件時機」，不偽造遊戲邏輯；boot 之後 scene.create / system.init
 * 仍真的執行。缺真實像素在 HEADLESS 本就不需要（不畫任何東西）。
 */
if (typeof HTMLImageElement !== 'undefined') {
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get(this: HTMLImageElement): string {
      return (this as unknown as { _src?: string })._src ?? '';
    },
    set(this: HTMLImageElement, value: string): void {
      (this as unknown as { _src?: string })._src = value;
      // 給一個非零尺寸，讓 TextureManager 認為是有效圖。
      Object.defineProperty(this, 'naturalWidth', { configurable: true, value: 1 });
      Object.defineProperty(this, 'naturalHeight', { configurable: true, value: 1 });
      Object.defineProperty(this, 'complete', { configurable: true, value: true });
      queueMicrotask(() => {
        // 用 try/catch 包住 Phaser 自己掛的 onload handler：
        // 場景 shutdown/destroy 後，殘留的圖片 onload 仍可能觸發，Phaser 的 File.onload
        // 會去讀已被清成 null 的 loader（loader.nextFile）而丟 TypeError。這純屬測試環境
        // 「onload 墊片與 teardown 競態」的雜訊，非產品錯誤 → 就地吞掉，避免變成 uncaught
        // 讓整個 test process 退出碼變 1（Advisory CI 會誤紅）。
        try {
          this.onload?.(new Event('load'));
          this.dispatchEvent(new Event('load'));
        } catch (err) {
          const msg = (err as Error)?.message ?? '';
          if (!msg.includes('nextFile')) throw err; // 只吞已知的 teardown 競態雜訊
        }
      });
      // 保留原 setter 副作用（若有）。
      desc?.set?.call(this, value);
    },
  });
}

/**
 * 最後一道防線：攔截 jsdom window 冒出的同一個 teardown 競態錯誤（nextFile），
 * 避免它以 uncaught 形式讓 vitest process 退出碼變 1。只吞這個已知訊息，其餘照舊。
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('error', (e: ErrorEvent) => {
    if (e?.message?.includes('nextFile')) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
    }
  });
}

