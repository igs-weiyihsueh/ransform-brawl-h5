import Phaser from 'phaser';
import type { GameSystem } from '@/systems/GameSystem';
import type { GameContext } from '@/systems/GameContext';
import {
  PLAYER_BOUNDS,
  setPlayerLeftBoundOverride,
  advanceLevelOffsetX,
  getLevelOffsetX,
} from '@/config/mapConfig';

/**
 * LevelProgressSystem — 關卡推進（step2 升級：block-offset model，真相鄰場景）：
 *  全波次打完（波騎 WaveSystem emit onLevelCleared）→ 左邊開「通道」+ 解除左界
 *  → 角色**連續往左走過分界**進真的下一塊區域、鏡頭**只水平(X)跟隨**（垂直 Y 鎖住）
 *  → 走過分界 → levelOffsetX **遞進**（不 setScroll 回原點、不拉回玩家＝不瞬移）+ notifyPortalEntered
 *  → 就地開下一關（怪生在新 offset 區塊，波騎 offset-aware spawn 讀 getLevelOffsetX）。
 *
 * 分工：波騎 WaveSystem 出 onLevelCleared（本關全清 emit + 停生怪 waitingForPortal，不自動進關）
 *   + notifyPortalEntered()（我呼→清 gate+清場+重置波次進下一輪，生怪讀當前 offset）+ isAwaitingLevelAdvance()。
 *   征騎（本 system）＝通道視覺 + 解左界 + X-only camera-follow + 走過分界遞進 offset（game-side + offset seam）。
 * ★block-offset 核心（不擴世界，用偏移）：進下一關時世界座標基準平移 levelOffsetX（推廣左界 override seam）；
 *   offset 前進**取代** setScroll(0,0)——不再走盡頭 setScroll 回原點+拉玩家回（那是用戶抱怨的瞬移），
 *   改 offset 遞進、玩家連續走、鏡頭連續跟，走到哪人就在哪。
 * ★鐵律：mapConfig PLAYER_BOUNDS/ENEMY_PLAY_BOUNDS 常數不亂改（用 offset/override）；碰撞/生怪/貼地/AI
 *   全用世界座標，offset 平移一致；鏡頭過場只 lerp scrollX、scrollY 鎖住；UI scrollFactor0 不動；波騎零改介面。
 */

/** 波騎 WaveSystem 關卡推進接口（本 system 只依賴這幾個，避免緊耦合具體型別；異靈定案 e068d58 名）。 */
interface LevelAdvanceWave {
  /** ★levelCleared 事件（本關全波次跑完 emit，開通道 gate；onStageClear 另留給燈、語意分開）。 */
  onLevelCleared: (() => void) | null;
  /** 玩家走過分界進新區塊 → 呼此（notify* 範式）：波騎清 gate+清場+重置波次進下一輪（生怪讀當前 offset）。 */
  notifyPortalEntered?(): void;
  /** 是否本關跑完等玩家走過分界態（期間波騎停生怪）。 */
  isAwaitingLevelAdvance?(): boolean;
}

/** 通道視覺帶寬（螢幕 px，箭頭區）。 */
const CORRIDOR_WIDTH_PX = 180;
/** ★區塊跨距（世界 px）：一關往左遞進的偏移量＝一個 playfield 寬（走過分界＝進下一整塊）。 */
const BLOCK_STRIDE_PX = PLAYER_BOUNDS.maxX - PLAYER_BOUNDS.minX;
/** 走過分界觸發：玩家中心 x <= 新區塊左界 + 此 margin → 遞進 offset 開下一關。 */
const CROSS_MARGIN_PX = 80;
/** 鏡頭水平跟隨平滑係數（lerp，越小越滑；看得到角色移動過程）。可調。★只用於 X（Y 鎖住）。 */
const FOLLOW_LERP_X = 0.08;

export class LevelProgressSystem implements GameSystem {
  readonly name = 'LevelProgressSystem';

  private ctx!: GameContext;
  private wave!: LevelAdvanceWave;
  /** 通道視覺（發光區+箭頭），僅在 levelCleared→走過分界 期間存在。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** 是否顯示通道中（收到 levelCleared、尚未走過分界）。 */
  private corridorShown = false;
  /** ★是否過場中（已解左界+鏡頭 X 跟隨），期間 update 偵測走過分界、擋重複觸發。 */
  private following = false;
  /** ★過場鎖定的鏡頭 Y（scrollY 固定不動＝垂直鎖，用戶要求）。 */
  private lockedScrollY = 0;
  /** 過場起點的 levelOffsetX（開通道當下），算「當前區塊左界／新區塊左界」用。 */
  private baseOffsetAtOpen = 0;
  private prevOnLevelCleared: (() => void) | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.wave = ctx.wave as unknown as LevelAdvanceWave;
    // 掛 onLevelCleared（＝levelCleared，異靈定案：跟給燈的 onStageClear 語意分開）：本關全清 → 開通道+解左界+鏡頭 X 跟隨。
    //   鏈式保留既有回呼，不覆蓋掉別人。
    this.prevOnLevelCleared = this.wave.onLevelCleared;
    this.wave.onLevelCleared = () => {
      this.prevOnLevelCleared?.();
      this.openPortal();
    };
  }

  update(dt: number): void {
    if (!this.following) return; // 未開通道/已推進：不偵測
    // 波騎若提供 awaiting 查詢：非 awaiting（已進關/被別處推進）→ 收通道（不重複遞進）。
    if (this.wave.isAwaitingLevelAdvance && !this.wave.isAwaitingLevelAdvance()) {
      this.endFollow();
      return;
    }
    const pos = this.ctx.player?.getPosition?.();
    if (!pos) return;
    // ★鏡頭只水平(X)平滑跟隨角色（scrollY 鎖住 lockedScrollY＝垂直不跟）：看得到角色往左走、鏡頭橫捲、無黑幕。
    this.followCameraX(pos.x, dt);
    // 角色走過分界進新區塊（中心 x <= 新區塊左界 + margin）→ 遞進 offset 開下一關。
    const newBlockLeft = PLAYER_BOUNDS.minX + this.baseOffsetAtOpen - BLOCK_STRIDE_PX;
    if (pos.x <= newBlockLeft + CROSS_MARGIN_PX) {
      this.commitAdvance();
    }
  }

  /** 鏡頭只水平跟隨（自管 lerp scrollX；scrollY 固定 lockedScrollY＝垂直鎖）。dt-aware 平滑不瞬跳。 */
  private followCameraX(px: number, dt: number): void {
    const cam = this.ctx.scene?.cameras?.main;
    if (!cam) return;
    const targetX = px - (cam.width * 0.5) / cam.zoom;
    const tx = 1 - Math.pow(1 - FOLLOW_LERP_X, Math.max(1, dt * 60));
    cam.setScroll(cam.scrollX + (targetX - cam.scrollX) * tx, this.lockedScrollY); // ★Y 鎖住
  }

  /**
   * ★開通道（onLevelCleared）：畫左通道 + 解除左界（放寬到新區塊左界）+ 起鏡頭 X 跟隨（垂直鎖）。
   *   角色接著連續往左走過分界 → update 偵測。
   */
  private openPortal(): void {
    if (this.following) return;
    this.baseOffsetAtOpen = getLevelOffsetX();
    this.showCorridor();
    // ★解除左界：放寬到「新區塊左界」（當前左界再往左一個 STRIDE），讓角色能連續走過分界進下一塊。
    setPlayerLeftBoundOverride(PLAYER_BOUNDS.minX + this.baseOffsetAtOpen - BLOCK_STRIDE_PX);
    // 鎖定過場鏡頭 Y＝當前 scrollY（垂直不跟）。
    const cam = this.ctx.scene?.cameras?.main;
    this.lockedScrollY = cam ? cam.scrollY : 0;
    this.following = true;
    // 鏡頭 X 跟隨由 update() 自管 lerp（不靠 Phaser startFollow）。
  }

  /**
   * ★走過分界 → 遞進 offset 開下一關（block-offset 核心：取代 setScroll(0,0)＋拉回玩家）。
   *   advanceLevelOffsetX(-STRIDE)：座標基準平移到新區塊 → 還原左界 override（現在正常界＝新區塊）
   *   → notifyPortalEntered（波騎重置波次、生怪讀新 offset 落在新區塊）。★鏡頭不回原點、玩家不拉回＝連續不瞬移。
   */
  private commitAdvance(): void {
    advanceLevelOffsetX(-BLOCK_STRIDE_PX); // 座標基準往左遞進一塊
    setPlayerLeftBoundOverride(null); // 還原 override（正常界已隨 offset 平移到新區塊）
    this.wave.notifyPortalEntered?.(); // 波騎重置波次進下一輪（生怪讀當前 offset 落新區塊）
    this.hideCorridor();
    this.following = false;
    // ★不 setScroll(0,0)、不拉回玩家：鏡頭停在跟到的新區塊位置、玩家就地＝連續無瞬移。
  }

  /** 別處已推進 → 只收尾還原（不重複遞進 offset / 不 notify）。 */
  private endFollow(): void {
    setPlayerLeftBoundOverride(null);
    this.hideCorridor();
    this.following = false;
  }

  /** 顯示左通道：發光帶 + 指向左的箭頭（世界座標＝offset-aware，跟著鏡頭橫捲）。畫在當前區塊左界往左一個 STRIDE 的延伸帶。 */
  private showCorridor(): void {
    if (this.corridorShown) return;
    this.corridorShown = true;
    const sc = this.ctx.scene;
    if (!sc) return;
    // 通道帶＝從新區塊左界到當前區塊左界（世界座標含 offset）。
    const curLeft = PLAYER_BOUNDS.minX + this.baseOffsetAtOpen; // 當前區塊左界（原分界）
    const extendedLeft = curLeft - BLOCK_STRIDE_PX; // 新區塊左界
    const top = PLAYER_BOUNDS.minY;
    const bottom = PLAYER_BOUNDS.maxY;
    const midY = (top + bottom) / 2;
    const bandW = curLeft - extendedLeft; // ＝BLOCK_STRIDE_PX
    const g = sc.add.graphics();
    g.setDepth(5); // 貼地層（角色 PLAY_DEPTH=10 之下、地面之上）
    // 發光通道帶（延伸區青色柔光矩形，示意「往左出口／下一塊」）。
    g.fillStyle(0x33ddff, 0.18);
    g.fillRect(extendedLeft, top, bandW, bottom - top);
    g.lineStyle(3, 0x66eeff, 0.7);
    g.strokeRect(extendedLeft, top, bandW, bottom - top);
    // 指向左的箭頭（在當前分界內側，白色三角+尾桿；引導往左走過分界）。
    const ax = curLeft - CORRIDOR_WIDTH_PX * 0.38;
    const ah = 70; // 箭頭高
    const tipX = curLeft - CORRIDOR_WIDTH_PX;
    g.fillStyle(0xffffff, 0.92);
    g.fillTriangle(tipX, midY, ax, midY - ah / 2, ax, midY + ah / 2); // 尖朝左
    g.fillRect(ax, midY - 12, CORRIDOR_WIDTH_PX * 0.28, 24); // 箭尾桿
    // 呼吸脈動（提示可走）。
    g.setAlpha(0.9);
    sc.tweens.add({ targets: g, alpha: 0.55, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.corridorGfx = g;
  }

  private hideCorridor(): void {
    this.corridorShown = false;
    if (this.corridorGfx) {
      this.corridorGfx.destroy();
      this.corridorGfx = null;
    }
  }

  destroy(): void {
    this.hideCorridor();
    // ★過場中被銷毀（切場景）→ 安全還原左界 override（offset 本身留給下場景延續；不強制 setScroll）。
    if (this.following) {
      setPlayerLeftBoundOverride(null);
      this.following = false;
    }
    // 還原 onLevelCleared（避免多場景殘留）。
    if (this.wave) this.wave.onLevelCleared = this.prevOnLevelCleared;
  }
}
