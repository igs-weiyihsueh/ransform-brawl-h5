import Phaser from 'phaser';
import type { GameSystem } from '@/systems/GameSystem';
import type { GameContext } from '@/systems/GameContext';
import { PLAYER_BOUNDS, setPlayerLeftBoundOverride, advanceLevelOffsetX, getLevelOffsetX } from '@/config/mapConfig';

/**
 * LevelProgressSystem — 關卡推進（step2：block-offset 真相鄰場景，玩家自由控 + 鏡頭只在跨界過場那段捲）：
 *  全波次打完（波騎 emit onLevelCleared）→ 左邊開「發光通道」+ 解左界（玩家可往左走進通道）
 *  → 玩家**自由控制**走到左邊界、要跨過去那刻 → **鏡頭才 lerp 往左捲一個區塊**到新區塊（平時鏡頭固定不跟玩家）
 *  → 玩家走到新區塊左界 → levelOffsetX 遞進 + notifyPortalEntered → 就地開下一關（無縫、無瞬移/走完位移）。
 *
 * 分工：波騎 WaveSystem 出 onLevelCleared（本關全清 emit + 停生怪 waitingForPortal）+ notifyPortalEntered()（我呼→重置）
 *   + isAwaitingLevelAdvance()。征騎（本 system）＝通道視覺 + 解左界 + 跨界鏡頭捲 + offset 遞進（game-side + offset seam）。
 * ★用戶定案（試 f166cb5 後釐清）：
 *   1. 玩家**自由控制**（上下左右自己走，不 scripted 自動走、不鎖輸入、不 pin Y）。
 *   2. 鏡頭**平時固定不動**（玩家在畫面內走動鏡頭都不跟）；**只**玩家走到左邊界要跨過去那刻，鏡頭才 lerp 往左捲過去。
 *   3. 發光通道區**短**（別讓玩家走很久）——STRIDE 縮短。
 *   4. ★走完通道**不位移**（offset 遞進那刻玩家/鏡頭連續、無縫接縫，不跳一下）。
 * ★鐵律：mapConfig 常數不改（用 offset/override）；碰撞/生怪/貼地/AI 世界座標 offset 一致；UI scrollFactor0 不動；波騎介面零改。
 */

/** 波騎 WaveSystem 關卡推進接口（本 system 只依賴這幾個）。 */
interface LevelAdvanceWave {
  onLevelCleared: (() => void) | null;
  notifyPortalEntered?(): void;
  isAwaitingLevelAdvance?(): boolean;
}

/** 通道視覺帶：箭頭區寬（螢幕 px）。 */
const CORRIDOR_WIDTH_PX = 160;
/**
 * ★區塊跨距（世界 px）＝一關往左遞進的偏移量＝發光通道要走的距離。
 *   用戶嫌太長→縮短成 700（非整 playfield 1600；各關清場重生不共存、區塊可重疊，短走位即可）。
 */
const BLOCK_STRIDE_PX = 700;
/** 開通道後玩家往左越過此線（＝當前區塊左界）→ 開始跨界鏡頭捲。 */
const CROSS_START_INSET_PX = 0;
/** 鏡頭跨界捲動平滑係數（lerp，越小越滑）。可調。 */
const CAM_LERP_X = 0.1;
/** 鏡頭到位判定：|scrollX - 目標| <= 此值 視為捲到位。 */
const CAM_SNAP_EPS_PX = 2;

export class LevelProgressSystem implements GameSystem {
  readonly name = 'LevelProgressSystem';

  private ctx!: GameContext;
  private wave!: LevelAdvanceWave;
  /** 通道視覺（發光帶+箭頭），僅在 levelCleared→走過分界 期間存在。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** ★是否等待玩家跨界（已開通道解左界、鏡頭尚未開始捲）。 */
  private awaitingCross = false;
  /** ★是否跨界鏡頭捲動中（玩家已越左界，鏡頭 lerp 往新區塊；期間玩家仍自由走）。 */
  private panning = false;
  /** 開通道當下的 levelOffsetX（算當前/新區塊左界 + 鏡頭 home）。 */
  private baseOffsetAtOpen = 0;
  private prevOnLevelCleared: (() => void) | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.wave = ctx.wave as unknown as LevelAdvanceWave;
    this.prevOnLevelCleared = this.wave.onLevelCleared;
    this.wave.onLevelCleared = () => {
      this.prevOnLevelCleared?.();
      this.openPortal();
    };
  }

  update(dt: number): void {
    if (!this.awaitingCross && !this.panning) return; // 非過場：完全不碰鏡頭（平時固定）
    // 別處已推進 → 收尾還原。
    if (this.wave.isAwaitingLevelAdvance && !this.wave.isAwaitingLevelAdvance()) {
      this.endTransition();
      return;
    }
    const pos = this.ctx.player?.getPosition?.();
    if (!pos) return;
    const curLeft = PLAYER_BOUNDS.minX + this.baseOffsetAtOpen; // 當前區塊左界（原分界）
    const newBlockLeft = curLeft - BLOCK_STRIDE_PX; // 新區塊左界

    // 玩家（自由控）往左越過當前區塊左界 → 進入跨界過場：鏡頭開始往左捲。
    if (this.awaitingCross && pos.x <= curLeft - CROSS_START_INSET_PX) {
      this.awaitingCross = false;
      this.panning = true;
    }

    if (this.panning) {
      // ★鏡頭 lerp 往新區塊 home（scrollX：baseOffset-STRIDE；scrollY 不動＝只水平捲）。
      const cam = this.ctx.scene?.cameras?.main;
      const targetX = this.baseOffsetAtOpen - BLOCK_STRIDE_PX;
      if (cam) {
        const tx = 1 - Math.pow(1 - CAM_LERP_X, Math.max(1, dt * 60));
        cam.setScroll(cam.scrollX + (targetX - cam.scrollX) * tx, cam.scrollY);
      }
      // 玩家走到新區塊左界 且 鏡頭已捲到位 → 遞進 offset 開下一關（無縫）。
      const camAtHome = !cam || Math.abs(cam.scrollX - targetX) <= CAM_SNAP_EPS_PX;
      if (pos.x <= newBlockLeft && camAtHome) {
        this.commitAdvance();
      }
    }
  }

  /** ★開通道（onLevelCleared）：畫短通道 + 解左界（放寬到新區塊左界）。★不動鏡頭、不鎖輸入、不 pin——玩家自由走。 */
  private openPortal(): void {
    if (this.awaitingCross || this.panning) return;
    this.baseOffsetAtOpen = getLevelOffsetX();
    this.showCorridor();
    // ★解左界：放寬到新區塊左界（玩家可自由往左走進通道到新區塊）。
    setPlayerLeftBoundOverride(PLAYER_BOUNDS.minX + this.baseOffsetAtOpen - BLOCK_STRIDE_PX);
    this.awaitingCross = true;
    // 鏡頭平時固定：此刻不動；等玩家走到左界才在 update 開始捲。
  }

  /**
   * ★走到新區塊左界 + 鏡頭捲到位 → 遞進 offset 開下一關（無縫）。
   *   advanceLevelOffsetX(-STRIDE)：座標基準平移到新區塊（正常界隨之平移）。此刻鏡頭已 lerp 到新 home、
   *   玩家已在新區塊左界＝視覺連續，offset 遞進不移動 sprite/鏡頭＝無縫、走完不位移。
   */
  private commitAdvance(): void {
    advanceLevelOffsetX(-BLOCK_STRIDE_PX); // 座標基準往左遞進一塊（＝STRIDE）
    setPlayerLeftBoundOverride(null); // 還原 override（正常界已隨 offset 平移到新區塊）
    // ★鏡頭精確吸附新 home（＝新 offset），確保平時固定鏡頭正好框住新區塊、無殘留誤差。
    const cam = this.ctx.scene?.cameras?.main;
    if (cam) cam.setScroll(getLevelOffsetX(), cam.scrollY);
    this.wave.notifyPortalEntered?.(); // 波騎重置波次進下一輪（生怪讀新 offset 落新區塊）
    this.hideCorridor();
    this.panning = false;
    this.awaitingCross = false;
    // ★不拉回玩家、不改玩家 y：玩家就地自由續走＝無縫、走完不位移。
  }

  /** 別處已推進 → 只收尾還原（不重複遞進 / 不 notify）。 */
  private endTransition(): void {
    setPlayerLeftBoundOverride(null);
    this.hideCorridor();
    this.panning = false;
    this.awaitingCross = false;
  }

  /** 顯示短發光通道：發光帶 + 指向左的箭頭（世界座標＝offset-aware）。畫在當前區塊左界往左一個 STRIDE。 */
  private showCorridor(): void {
    const sc = this.ctx.scene;
    if (!sc) return;
    const curLeft = PLAYER_BOUNDS.minX + this.baseOffsetAtOpen; // 當前區塊左界
    const extendedLeft = curLeft - BLOCK_STRIDE_PX; // 新區塊左界
    const top = PLAYER_BOUNDS.minY;
    const bottom = PLAYER_BOUNDS.maxY;
    const midY = (top + bottom) / 2;
    const bandW = curLeft - extendedLeft; // ＝BLOCK_STRIDE_PX（短）
    const g = sc.add.graphics();
    g.setDepth(5); // 貼地層
    g.fillStyle(0x33ddff, 0.18);
    g.fillRect(extendedLeft, top, bandW, bottom - top);
    g.lineStyle(3, 0x66eeff, 0.7);
    g.strokeRect(extendedLeft, top, bandW, bottom - top);
    // 指向左的箭頭（當前分界內側，引導往左走過分界）。
    const ax = curLeft - CORRIDOR_WIDTH_PX * 0.38;
    const ah = 70;
    const tipX = curLeft - CORRIDOR_WIDTH_PX;
    g.fillStyle(0xffffff, 0.92);
    g.fillTriangle(tipX, midY, ax, midY - ah / 2, ax, midY + ah / 2);
    g.fillRect(ax, midY - 12, CORRIDOR_WIDTH_PX * 0.28, 24);
    g.setAlpha(0.9);
    sc.tweens.add({ targets: g, alpha: 0.55, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.corridorGfx = g;
  }

  private hideCorridor(): void {
    if (this.corridorGfx) {
      this.corridorGfx.destroy();
      this.corridorGfx = null;
    }
  }

  destroy(): void {
    this.hideCorridor();
    // ★過場中被銷毀（切場景）→ 安全還原左界 override（offset 留給下場景延續）。
    if (this.awaitingCross || this.panning) {
      setPlayerLeftBoundOverride(null);
      this.awaitingCross = false;
      this.panning = false;
    }
    if (this.wave) this.wave.onLevelCleared = this.prevOnLevelCleared;
  }
}
