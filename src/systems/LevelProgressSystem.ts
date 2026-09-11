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
 * ★step1 不動 camera（step2 才鏡頭捲動過場）。（介面名異靈定案 e068d58：onLevelCleared/notifyPortalEntered。）
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

export class LevelProgressSystem implements GameSystem {
  readonly name = 'LevelProgressSystem';

  private ctx!: GameContext;
  private wave!: LevelAdvanceWave;
  /** 通道視覺（發光區+箭頭），僅在 levelCleared→等玩家走進 期間存在。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** 是否顯示通道中（收到 levelCleared、尚未觸發進關）。 */
  private corridorShown = false;
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
    if (!this.corridorShown) return;
    // 波騎若提供 awaiting 查詢：非 awaiting（已進關/被別處推進）→ 收通道。
    if (this.wave.isAwaitingLevelAdvance && !this.wave.isAwaitingLevelAdvance()) {
      this.hideCorridor();
      return;
    }
    // 玩家走進左通道範圍（中心 x <= 左邊界 + margin）→ 進下一關。
    const p = this.ctx.player;
    const pos = p?.getPosition?.();
    if (!pos) return;
    if (pos.x <= PLAYER_BOUNDS.minX + ENTER_MARGIN_PX) {
      this.wave.notifyPortalEntered?.(); // 非 awaiting 態波騎會忽略（防呆）
      this.hideCorridor();
    }
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
    // 還原 onLevelCleared（避免多場景殘留）。
    if (this.wave) this.wave.onLevelCleared = this.prevOnLevelCleared;
  }
}
