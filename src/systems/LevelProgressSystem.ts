import Phaser from 'phaser';
import type { GameSystem } from '@/systems/GameSystem';
import type { GameContext } from '@/systems/GameContext';
import { PLAYER_BOUNDS, setPlayerLeftBoundOverride } from '@/config/mapConfig';

/**
 * LevelProgressSystem — 關卡推進：
 *  全波次打完（波騎 WaveSystem emit onLevelCleared）→ 左邊開「通道」（發光區+左箭頭）
 *  + 臨時放寬玩家左界 → 角色往左走出原 playfield 進通道延伸區、鏡頭鎖定角色平滑跟隨捲動
 *  → 走到延伸區盡頭 → 重置波次進下一關 + 還原（stopFollow/setScroll0/還原左界）。
 *
 * 分工：波騎 WaveSystem 出 onLevelCleared（本關全清 emit + 停生怪 waitingForPortal，不自動進關）
 *   + notifyPortalEntered()（我呼→清 gate+清場+重置波次進下一輪）+ isAwaitingLevelAdvance()（查是否等通道）。
 *   征騎（本 system）＝通道視覺 + 臨時放寬左界 + camera-follow 過場 + 走到盡頭觸發（game-side）。
 * ★step2（用戶定案：真 camera-follow 角色、無黑幕）：onLevelCleared 開通道後臨時放寬 PLAYER_BOUNDS 左界
 *   → update() 自管 lerp centerOn 鏡頭平滑跟隨角色（看得到角色往左走、鏡頭跟著捲、不要 fade 黑幕）
 *   → 走到延伸盡頭 → stopFollow + setScroll(0,0) + 還原左界 + notifyPortalEntered 重置波次。
 * ★鐵律：mapConfig 常數不改、PLAYER_BOUNDS 只「臨時」放寬（走 setPlayerLeftBoundOverride，觸發後一定還原 null）；
 *   觸發重置後 setScroll(0,0)+還原 bounds＝世界座標/碰撞/生怪基準完全復原（跟 step1 一樣）。
 *   通道 Graphics 世界座標（跟著鏡頭捲）、UI scrollFactor0 不動、波騎 WaveSystem 零改。
 */

/** 波騎 WaveSystem 關卡推進接口（本 system 只依賴這幾個，避免緊耦合具體型別；異靈定案 e068d58 名）。 */
interface LevelAdvanceWave {
  /** ★levelCleared 事件（本關全波次跑完 emit，開通道 gate；onStageClear 另留給燈、語意分開）。 */
  onLevelCleared: (() => void) | null;
  /** 玩家走進左通道盡頭 → 呼此（notify* 範式）：波騎清 gate+清場+重置波次進下一輪。 */
  notifyPortalEntered?(): void;
  /** 是否本關跑完等玩家走進通道態（期間波騎停生怪）。 */
  isAwaitingLevelAdvance?(): boolean;
}

/** 通道寬（螢幕 px，從左邊界往右延伸的視覺帶）。 */
const CORRIDOR_WIDTH_PX = 180;
/** ★通道延伸距離（px）：臨時把玩家左界往左延伸這麼多，讓角色能走出原 playfield 進通道區（鏡頭有東西跟）。可調。 */
const EXIT_EXTENSION_PX = 900;
/** 走到盡頭觸發：玩家中心 x <= 延伸後左界 + 此 margin → 重置進下一關。 */
const END_MARGIN_PX = 60;
/** 鏡頭跟隨平滑係數（lerp，越小越滑；看得到角色移動過程）。可調。 */
const FOLLOW_LERP_X = 0.08;
const FOLLOW_LERP_Y = 0.08;
/** 重置後玩家拉回位置：原左界稍右（避免貼在還原後的左牆上）。 */
const RESET_PLAYER_INSET_PX = 120;

export class LevelProgressSystem implements GameSystem {
  readonly name = 'LevelProgressSystem';

  private ctx!: GameContext;
  private wave!: LevelAdvanceWave;
  /** 通道視覺（發光區+箭頭），僅在 levelCleared→走到盡頭 期間存在。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** 是否顯示通道中（收到 levelCleared、尚未走到盡頭）。 */
  private corridorShown = false;
  /** ★是否過場中（已放寬左界+鏡頭跟隨），期間 update 偵測走到盡頭、擋重複觸發。 */
  private following = false;
  private prevOnLevelCleared: (() => void) | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.wave = ctx.wave as unknown as LevelAdvanceWave;
    // 掛 onLevelCleared（＝levelCleared，異靈定案：跟給燈的 onStageClear 語意分開）：本關全清 → 開通道+放寬左界+鏡頭跟隨。
    //   鏈式保留既有回呼，不覆蓋掉別人。
    this.prevOnLevelCleared = this.wave.onLevelCleared;
    this.wave.onLevelCleared = () => {
      this.prevOnLevelCleared?.();
      this.openPortal();
    };
  }

  update(dt: number): void {
    if (!this.following) return; // 未開通道/已重置：不偵測
    // 波騎若提供 awaiting 查詢：非 awaiting（已進關/被別處推進）→ 收通道還原。
    if (this.wave.isAwaitingLevelAdvance && !this.wave.isAwaitingLevelAdvance()) {
      this.finishTransition(false); // 別處已推進→只還原（不重複 notify）
      return;
    }
    const pos = this.ctx.player?.getPosition?.();
    if (!pos) return;
    // ★鏡頭平滑跟隨角色（自管 lerp centerOn，不靠 Phaser startFollow 內部更新時機、跨場景穩定）：
    //   看得到角色往左走、鏡頭跟著捲、無黑幕。lerp 越小越滑。
    this.followCameraTo(pos.x, pos.y, dt);
    // 角色走到延伸區盡頭（中心 x <= 延伸後左界 + margin）→ 重置進下一關。
    const extendedMinX = PLAYER_BOUNDS.minX - EXIT_EXTENSION_PX;
    if (pos.x <= extendedMinX + END_MARGIN_PX) {
      this.finishTransition(true);
    }
  }

  /** 鏡頭平滑跟隨（自管 lerp）：scrollX/Y 朝「以角色為中心」目標插值，dt-aware 平滑不瞬跳。 */
  private followCameraTo(px: number, py: number, dt: number): void {
    const cam = this.ctx.scene?.cameras?.main;
    if (!cam) return;
    const targetX = px - cam.width * 0.5 / cam.zoom;
    const targetY = py - cam.height * 0.5 / cam.zoom;
    // dt-aware lerp：t = 1-(1-lerp)^(dt*60)，60fps 時≈FOLLOW_LERP，掉幀也一致平滑。
    const tx = 1 - Math.pow(1 - FOLLOW_LERP_X, Math.max(1, dt * 60));
    const ty = 1 - Math.pow(1 - FOLLOW_LERP_Y, Math.max(1, dt * 60));
    cam.setScroll(cam.scrollX + (targetX - cam.scrollX) * tx, cam.scrollY + (targetY - cam.scrollY) * ty);
  }

  /**
   * ★開通道（onLevelCleared）：畫左通道 + 臨時放寬左界 + 鏡頭鎖定角色平滑跟隨（無黑幕）。
   *   角色接著往左走 → 鏡頭跟著捲（看得到移動過程）→ update 偵測走到盡頭。
   */
  private openPortal(): void {
    if (this.following) return;
    this.showCorridor();
    // ★臨時放寬玩家左界（往左延伸 EXIT_EXTENSION_PX），讓角色能走出原 playfield 進通道區。
    setPlayerLeftBoundOverride(PLAYER_BOUNDS.minX - EXIT_EXTENSION_PX);
    this.following = true;
    // 鏡頭跟隨由 update() 自管 lerp centerOn（不靠 Phaser startFollow，跨場景/更新時機更穩）。
  }

  /**
   * 過場收尾（走到盡頭 or 別處推進）：stopFollow + setScroll(0,0) + 還原左界 + （doNotify）notifyPortalEntered。
   * ★鐵律：一定 setScroll(0,0)+還原左界 override＝世界座標/碰撞/生怪基準完全復原。
   */
  private finishTransition(doNotify: boolean): void {
    const cam = this.ctx.scene?.cameras?.main;
    if (cam) cam.setScroll(0, 0); // ★鏡頭回原點（過場只是視覺、世界沒真的變寬）
    setPlayerLeftBoundOverride(null); // ★還原左界（回 PLAYER_BOUNDS.minX）
    // 玩家拉回原左界稍右（避免還原後貼在左牆/卡延伸區外）。
    const p = this.ctx.player;
    const pos = p?.getPosition?.();
    if (pos && typeof p?.setPosition === 'function') {
      p.setPosition(PLAYER_BOUNDS.minX + RESET_PLAYER_INSET_PX, pos.y);
    }
    if (doNotify) this.wave.notifyPortalEntered?.(); // 重置波次進下一輪（非 awaiting 態波騎會忽略防呆）
    this.hideCorridor();
    this.following = false;
  }

  /** 顯示左通道：發光帶 + 指向左的箭頭（世界座標，跟著鏡頭捲）。 */
  private showCorridor(): void {
    if (this.corridorShown) return;
    this.corridorShown = true;
    const sc = this.ctx.scene;
    if (!sc) return;
    // 通道畫在「延伸後的新左界」起（世界座標往左延伸），寬含延伸區到原左界。
    const extendedLeft = PLAYER_BOUNDS.minX - EXIT_EXTENSION_PX;
    const top = PLAYER_BOUNDS.minY;
    const bottom = PLAYER_BOUNDS.maxY;
    const midY = (top + bottom) / 2;
    const bandRight = PLAYER_BOUNDS.minX; // 帶右緣＝原左界
    const bandW = bandRight - extendedLeft; // ＝EXIT_EXTENSION_PX
    const g = sc.add.graphics();
    g.setDepth(5); // 貼地層（角色 PLAY_DEPTH=10 之下、地面之上）
    // 發光通道帶（延伸區青色柔光矩形，示意「往左出口」）。
    g.fillStyle(0x33ddff, 0.18);
    g.fillRect(extendedLeft, top, bandW, bottom - top);
    g.lineStyle(3, 0x66eeff, 0.7);
    g.strokeRect(extendedLeft, top, bandW, bottom - top);
    // 指向左的箭頭（在原左界內側，白色三角+尾桿；引導往左走）。
    const ax = bandRight - CORRIDOR_WIDTH_PX * 0.38;
    const ah = 70; // 箭頭高
    const tipX = bandRight - CORRIDOR_WIDTH_PX;
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
    // ★過場中被銷毀（切場景）→ 安全還原：setScroll0 + 還原左界。
    if (this.following) {
      const cam = this.ctx?.scene?.cameras?.main;
      if (cam) cam.setScroll(0, 0);
      setPlayerLeftBoundOverride(null);
      this.following = false;
    }
    // 還原 onLevelCleared（避免多場景殘留）。
    if (this.wave) this.wave.onLevelCleared = this.prevOnLevelCleared;
  }
}
