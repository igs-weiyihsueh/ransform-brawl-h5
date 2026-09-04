import Phaser from 'phaser';
import { getPerCharScale } from '@/config/animationConfig';
import { SPRITE_SCALE } from '@/config/combatConfig';
import { ENEMY_AI, type EnemyAIConfig } from '@/config/enemyConfig';
import { PPU } from '@/config/gameConfig';
import { CharacterAnimator, FRAME_SIZE } from '@/systems/CharacterAnimator';
import {
  buildAttackCircle,
  type Hittable,
  type Vec2,
} from '@/systems/hitDetection';

/** 敵人可用的角色美術 key（debug 預覽用循環選擇）。 */
export const ENEMY_CHARACTERS = ['Enemy_Rush', 'Enemy_Ranged', 'Enemy_Elite'] as const;

/** 敵人 AI 狀態。 */
type EnemyState = 'idle' | 'chase' | 'charge' | 'attack' | 'cooldown' | 'damaged' | 'death';

/**
 * 敵人出手時通知場景的資料。melee 帶命中圓，projectile 帶生成參數。
 * 場景據此對玩家做命中判定 / 生成射彈（射彈為可重用系統）。
 */
export interface EnemyAttackEvent {
  kind: 'melee' | 'projectile';
  sourceName: string;
  damage: number;
  knockback: number;
  /** melee：世界像素判定圓。 */
  meleeCircle?: { center: Vec2; radius: number };
  /** projectile：生成點、方向、速度(unit)、半徑(unit)。 */
  projectile?: {
    x: number;
    y: number;
    dir: Vec2;
    speedUnits: number;
    radiusUnits: number;
  };
}

/**
 * Enemy — 資料驅動的敵人（三種行為由 ENEMY_AI 決定）。
 *
 * 狀態機：chase（追）→ 進 attackRange → charge（蓄力 chargeTime）→ 出手（播 attack + 發 attackEvent）
 * → cooldown（attackCooldown）→ 再來。damaged（hitStun 硬直 + 擊退）；death 播完消失。
 * 實作 Hittable 供玩家攻擊判定。出手用 callback 交給場景處理（近戰對玩家判定 / 生成射彈）。
 */
export class Enemy implements Hittable {
  private readonly anim: CharacterAnimator;
  private readonly cfg: EnemyAIConfig;
  private readonly scaleFactor: number;

  private hp: number;
  private readonly maxHp: number;
  private readonly radiusPx: number;

  private state: EnemyState = 'chase';
  private timer = 0; // 當前狀態的計時（charge/cooldown/damaged 用）
  private facing = 1;

  private knockbackVel: Vec2 = { x: 0, y: 0 };
  private dead = false;
  /** attack 動畫是否播完（由 onComplete 設定），播完才進 cooldown。 */
  private attackAnimDone = false;

  /** 出手回呼（由場景設定）。 */
  onAttack: ((e: EnemyAttackEvent) => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, charKey: string = ENEMY_CHARACTERS[0]) {
    this.cfg = ENEMY_AI[charKey] ?? ENEMY_AI[ENEMY_CHARACTERS[0]];
    this.scaleFactor = getPerCharScale(this.cfg.characterKey);
    this.anim = new CharacterAnimator(scene, this.cfg.characterKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.radiusPx = (FRAME_SIZE * SPRITE_SCALE * this.scaleFactor) / 2;
  }

  isDead(): boolean {
    return this.dead;
  }

  getHitCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  getHitRadius(): number {
    return this.radiusPx;
  }

  getCharacterKey(): string {
    return this.cfg.characterKey;
  }

  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  getState(): EnemyState {
    return this.state;
  }

  /** 每幀更新：套擊退殘速 → 跑狀態機 → 更新動畫。 */
  update(playerPos: Vec2, dt: number): void {
    if (this.dead) return;

    // 擊退殘速（衰減）。
    this.anim.sprite.x += this.knockbackVel.x * dt;
    this.anim.sprite.y += this.knockbackVel.y * dt;
    const decay = Math.pow(0.001, dt);
    this.knockbackVel.x *= decay;
    this.knockbackVel.y *= decay;

    if (this.state === 'death') return;

    const dx = playerPos.x - this.anim.sprite.x;
    const dy = playerPos.y - this.anim.sprite.y;
    const dist = Math.hypot(dx, dy);

    // 面向玩家（水平）。
    if (dx > 0.001) this.setFacing(1);
    else if (dx < -0.001) this.setFacing(-1);

    const detectPx = this.cfg.detectRange * PPU;
    const attackPx = this.cfg.attackRange * PPU;

    switch (this.state) {
      case 'damaged':
        this.timer -= dt;
        this.anim.play('damaged');
        if (this.timer <= 0) this.state = 'chase';
        break;

      case 'chase': {
        this.anim.play('idle'); // 預設，下面若移動改 move
        if (dist <= attackPx) {
          // 進入攻擊距離 → 開始蓄力。
          this.state = 'charge';
          this.timer = this.cfg.chargeTime;
          this.anim.play('idle');
        } else if (dist <= detectPx && dist > 0.001) {
          const speedPx = this.cfg.moveSpeed * PPU;
          this.anim.sprite.x += (dx / dist) * speedPx * dt;
          this.anim.sprite.y += (dy / dist) * speedPx * dt;
          this.anim.play('move');
        } else {
          this.anim.play('idle');
        }
        break;
      }

      case 'charge':
        this.timer -= dt;
        // 蓄力期間維持 idle 姿勢（別移動），時間到 → 進 attack 狀態出手。
        this.anim.play('idle');
        if (this.timer <= 0) {
          this.state = 'attack';
          this.attackAnimDone = false;
          this.fireAttack(playerPos); // 內含 play('attack', force) + 觸發判定/射彈
        }
        break;

      case 'attack':
        // 出手中：只播 attack 動畫，不做任何會覆蓋動畫的事（不移動、不改 play）。
        // 待 attack 動畫播完（attackAnimDone）→ 進 cooldown。
        if (this.attackAnimDone) {
          this.state = 'cooldown';
          this.timer = this.cfg.attackCooldown;
        }
        break;

      case 'cooldown':
        this.timer -= dt;
        // 冷卻期間仍會追（若玩家跑出攻擊距離）。
        if (dist > attackPx && dist <= detectPx && dist > 0.001) {
          const speedPx = this.cfg.moveSpeed * PPU;
          this.anim.sprite.x += (dx / dist) * speedPx * dt;
          this.anim.sprite.y += (dy / dist) * speedPx * dt;
          this.anim.play('move');
        } else {
          this.anim.play('idle');
        }
        if (this.timer <= 0) this.state = 'chase';
        break;

      default:
        break;
    }
  }

  /** 出手：播 attack 動畫（一次性）並發出攻擊事件（近戰命中圓 / 射彈生成參數）。 */
  private fireAttack(playerPos: Vec2): void {
    // 播 attack 一次性動畫；播完 → attackAnimDone，讓狀態機進 cooldown。
    this.anim.play('attack', {
      force: true,
      onComplete: () => {
        this.attackAnimDone = true;
      },
    });
    const pos = this.getHitCenter();
    const a = this.cfg.attack;

    if (this.cfg.attackKind === 'melee') {
      // 近戰圓形判定：offset 隨 perCharScale 放大（菁英大範圍）。
      const circle = buildAttackCircle(a, pos, this.facing, this.scaleFactor);
      this.onAttack?.({
        kind: 'melee',
        sourceName: this.cfg.characterKey,
        damage: a.damage,
        knockback: a.knockback,
        meleeCircle: { center: circle.center, radius: circle.radius },
      });
    } else {
      // 射彈：朝玩家方向，從身體前方生成。
      const dir = { x: playerPos.x - pos.x, y: playerPos.y - pos.y };
      const spawnX = pos.x + this.facing * a.offsetX * PPU;
      const spawnY = pos.y + a.offsetY * PPU;
      this.onAttack?.({
        kind: 'projectile',
        sourceName: this.cfg.characterKey,
        damage: a.damage,
        knockback: a.knockback,
        projectile: {
          x: spawnX,
          y: spawnY,
          dir,
          speedUnits: this.cfg.projectileSpeed ?? 8,
          radiusUnits: a.radius ?? 0.2,
        },
      });
    }
  }

  private setFacing(dir: number): void {
    if (dir === this.facing) return;
    this.facing = dir;
    this.anim.setFacing(dir);
  }

  /** 被玩家攻擊：扣血、hitStun 硬直、擊退。HP 歸 0 播 death 消失。 */
  takeHit(damage: number, knockback: number, fromPos: Vec2): void {
    if (this.dead || this.state === 'death') return;
    this.hp -= damage;

    // 擊退方向：遠離攻擊來源，力道 × (1 - 依 hitStun 感覺的抗性)。
    // 這裡直接用 knockback（來自玩家攻擊）× hitStun 比例當「抗性」：菁英 hitStun0.05 幾乎不退。
    const dx = this.anim.sprite.x - fromPos.x;
    const dy = this.anim.sprite.y - fromPos.y;
    const len = Math.hypot(dx, dy) || 1;
    // hitStun 越小越像牆：用 hitStun 當擊退倍率（0.05→幾乎不動，0.8→明顯退）。
    const kbPx = knockback * PPU * this.cfg.hitStun;
    this.knockbackVel.x = (dx / len) * kbPx;
    this.knockbackVel.y = (dy / len) * kbPx;

    if (this.hp <= 0) {
      this.die();
    } else {
      this.state = 'damaged';
      this.timer = this.cfg.hitStun;
      this.anim.play('damaged', { force: true });
    }
  }

  private die(): void {
    this.state = 'death';
    this.knockbackVel = { x: 0, y: 0 };
    this.anim.play('death', {
      force: true,
      onComplete: () => {
        this.dead = true;
        this.anim.destroy();
      },
    });
  }
}
