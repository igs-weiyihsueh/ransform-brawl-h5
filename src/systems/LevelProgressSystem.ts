import Phaser from 'phaser';
import type { GameSystem } from '@/systems/GameSystem';
import type { GameContext } from '@/systems/GameContext';
import { PLAYER_BOUNDS } from '@/config/mapConfig';

/**
 * LevelProgressSystem — 關卡推進 step1（無 camera）：
 *  全波次打完（波騎 WaveSystem emit onLevelCleared）→ 左邊開「通道」（發光區+左箭頭）→
 *  玩家往左走進通道範圍 → 呼 wave.notifyPortalEntered() 重置波次進下一關 → 清通道 UI。
 *
 * 分工：波騎 WaveSystem 出 onLevelCleared（本關全清 emit + 停生怪 waitingForPortal，不自動進關）
 *   + notifyPortalEntered()（我呼→清 gate+清場+重置波次進下一輪）+ isAwaitingLevelAdvance()（查是否等通道）。
 *   征騎（本 system）＝通道視覺 + 走進觸發（game-side）。
 * ★step2（變身-leader approach C）：走進通道 → 鏡頭往左平滑 pan + fadeOut/fadeIn 過場，
 *   onComplete 才 setScroll(0,0) reset + notifyPortalEntered 重置波次（world/碰撞/生怪不變，只鏡頭視覺動）。
 */

/** 波騎 WaveSystem 關卡推進接口（本 system 只依賴這幾個，避免緊耦合具體型別；異靈定案 e068d58 名）。 */
interface LevelAdvanceWave {
  /** ★levelCleared 事件（本關全波次跑完 emit，開通道 gate；onStageClear 另留給燈、語意分開）。 */
  onLevelCleared: (() => void) | null;
  /** 玩家走進左通道 → 呼此（notify* 範式）：波騎清 gate+清場+重置波次進下一輪。 */
  notifyPortalEntered?(): void;
  /** 是否本關跑完等玩家走進通道態（期間波騎停生怪）。 */
  isAwaitingLevelAdvance?(): boolean;
}

/** 通道寬（螢幕 px，從左邊界往右延伸的觸發+視覺帶）。 */
const CORRIDOR_WIDTH_PX = 180;
/** 走進觸發：玩家中心 x <= 左邊界 + 此 margin → 進下一關（玩家走到左邊貼牆處）。 */
const ENTER_MARGIN_PX = 90;
/** step2 過場：鏡頭往左平滑 pan 的距離（世界 px，模擬走過通道到新場景；之後可交用戶調）。 */
const PAN_DISTANCE_PX = 900;
/** pan 捲動時長（ms）。 */
const PAN_DURATION_MS = 700;
/** 淡出/淡入時長（ms），遮住世界重置的跳變。 */
const FADE_DURATION_MS = 320;

export class LevelProgressSystem implements GameSystem {
  readonly name = 'LevelProgressSystem';

  private ctx!: GameContext;
  private wave!: LevelAdvanceWave;
  /** 通道視覺（發光區+箭頭），僅在 levelCleared→等玩家走進 期間存在。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** 是否顯示通道中（收到 levelCleared、尚未觸發進關）。 */
  private corridorShown = false;
  /** ★step2：過場進行中（pan+fade），期間不重複觸發、update 不再偵測走進。 */
  private transitioning = false;
  private prevOnLevelCleared: (() => void) | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.wave = ctx.wave as unknown as LevelAdvanceWave;
    // 掛 onLevelCleared（＝levelCleared，異靈定案：跟給燈的 onStageClear 語意分開）：本關全清 → 顯示左通道。
    //   鏈式保留既有回呼，不覆蓋掉別人。
    this.prevOnLevelCleared = this.wave.onLevelCleared;
    this.wave.onLevelCleared = () => {
      this.prevOnLevelCleared?.();
      this.showCorridor();
    };
  }

  update(_dt: number): void {
    if (this.transitioning) return; // 過場中：不再偵測走進、不重複觸發
    if (!this.corridorShown) return;
    // 波騎若提供 awaiting 查詢：非 awaiting（已進關/被別處推進）→ 收通道。
    if (this.wave.isAwaitingLevelAdvance && !this.wave.isAwaitingLevelAdvance()) {
      this.hideCorridor();
      return;
    }
    // 玩家走進左通道範圍（中心 x <= 左邊界 + margin）→ 觸發過場（step2）。
    const p = this.ctx.player;
    const pos = p?.getPosition?.();
    if (!pos) return;
    if (pos.x <= PLAYER_BOUNDS.minX + ENTER_MARGIN_PX) {
      this.startTransition(); // ★過場插在偵測→notifyPortalEntered 之間：pan+fade 完才 notify+重置
    }
  }

  /**
   * ★step2 過場（變身-leader approach C）：玩家走進 → 鏡頭往左平滑 pan（模擬走過通道）
   *   → 淡出遮住世界重置的跳變 → onComplete 才 setScroll(0,0) 回原點 + notifyPortalEntered() 重置波次
   *   + 清通道 UI → 淡入新一輪。
   * ★鐵律：mapConfig/PLAYER_BOUNDS 不動（世界座標/碰撞/生怪不變，只鏡頭視覺動）；
   *   pan 純過場視覺，onComplete 一定 setScroll(0,0) reset（世界沒真的變寬）；通道 Graphics 保世界座標跟 pan。
   */
  private startTransition(): void {
    if (this.transitioning) return;
    this.transitioning = true;
    const sc = this.ctx.scene;
    const cam = sc?.cameras?.main;
    if (!sc || !cam) {
      // 無 camera（測試/降級）→ 退回 step1 行為：直接重置。
      this.finishTransition();
      return;
    }
    const startX = cam.scrollX;
    const startY = cam.scrollY;
    // 1) 往左平滑 pan（scrollX 減 → 世界往右移＝鏡頭往左看，模擬走過通道到新場景）。
    cam.pan(
      startX - PAN_DISTANCE_PX,
      startY,
      PAN_DURATION_MS,
      'Sine.easeInOut',
      false,
      (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress < 1) return;
        // 2) pan 完 → 淡出（黑幕遮住世界重置的跳變）。
        cam.once('camerafadeoutcomplete', () => {
          // 3) 黑幕中：鏡頭回原點（pan 只是過場視覺）+ 重置波次進下一輪 + 清通道。
          cam.setScroll(0, 0);
          this.finishTransition();
          // 4) 淡入新一輪。
          cam.fadeIn(FADE_DURATION_MS, 0, 0, 0);
        });
        cam.fadeOut(FADE_DURATION_MS, 0, 0, 0);
      },
    );
  }

  /** 過場收尾：notifyPortalEntered 重置波次 + 清通道 UI + 解過場旗標。 */
  private finishTransition(): void {
    this.wave.notifyPortalEntered?.(); // 非 awaiting 態波騎會忽略（防呆）
    this.hideCorridor();
    this.transitioning = false;
  }

  /** 顯示左通道：發光帶 + 指向左的箭頭（貼地明顯；step1 純視覺示意，不動 camera）。 */
  private showCorridor(): void {
    if (this.corridorShown) return;
    this.corridorShown = true;
    const sc = this.ctx.scene;
    if (!sc) return;
    const left = PLAYER_BOUNDS.minX;
    const top = PLAYER_BOUNDS.minY;
    const bottom = PLAYER_BOUNDS.maxY;
    const midY = (top + bottom) / 2;
    const g = sc.add.graphics();
    g.setDepth(5); // 貼地層（角色 PLAY_DEPTH=10 之下、地面之上）
    // 發光通道帶（左邊界往右 CORRIDOR_WIDTH_PX 的青色柔光矩形，示意「出口」）。
    g.fillStyle(0x33ddff, 0.18);
    g.fillRect(left, top, CORRIDOR_WIDTH_PX, bottom - top);
    g.lineStyle(3, 0x66eeff, 0.7);
    g.strokeRect(left, top, CORRIDOR_WIDTH_PX, bottom - top);
    // 指向左的箭頭（在通道帶中央，白色三角+尾桿）。
    const ax = left + CORRIDOR_WIDTH_PX * 0.62;
    const ah = 70; // 箭頭高
    g.fillStyle(0xffffff, 0.92);
    g.fillTriangle(left + 24, midY, ax, midY - ah / 2, ax, midY + ah / 2); // 尖朝左
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
    // ★過場中被銷毀（切場景）→ 還原鏡頭避免殘留（回原點+清淡出）。
    if (this.transitioning) {
      const cam = this.ctx?.scene?.cameras?.main;
      if (cam) {
        cam.setScroll(0, 0);
        cam.resetFX();
      }
      this.transitioning = false;
    }
    // 還原 onLevelCleared（避免多場景殘留）。
    if (this.wave) this.wave.onLevelCleared = this.prevOnLevelCleared;
  }
}
