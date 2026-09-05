// @vitest-environment jsdom
/**
 * 用戶試玩新#1#2 回歸 bug 根治整合鎖（翼騎 92c3dc9）。
 * 根因：敵人 body 半徑原用 256 透明 frame 半徑(134px 大半 padding) → 推怪太遠(真空帶大)+
 * 怪被推到攻擊形狀外(搆不到不攻擊)。修：ENEMY_BODY_RADIUS_PX=45(可視半徑)、推怪對齊視覺圈、
 * 敵人 setFacingEnemy(flipX 相反,修倒著走)。pushOutOfPlayer/isPlayerInEnemyAttackShape 簽章沒動。
 * 維度3 斷實際近邊/攻擊 bool/flipX，非 call-count。
 * ⚠️ jsdom + HEADLESS 共用 scene，每測 forceDestroy/destroy。純視覺(召喚陣/facing 動畫)不補。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Enemy } from '@/entities/Enemy';
import { Player } from '@/entities/Player';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import { pushOutOfPlayer } from '@/systems/enemySeparation';
import { isPlayerInEnemyAttackShape, type Vec2 } from '@/systems/hitDetection';
import { ENEMY_AI, ENEMY_BODY_RADIUS_PX } from '@/config/enemyConfig';
import { FOOT_GLOW } from '@/config/playerConfig';

let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() {
        super({ key: 'Boot' });
      }
      create(): void {
        scene = this;
        resolve();
      }
    }
    game = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 100,
      height: 100,
      scene: [Boot],
      audio: { noAudio: true },
      banner: false,
    });
  });
});
afterAll(() => game?.destroy(true));

describe('回歸根治 — 敵人可視 body 半徑(45) + 真空帶對齊視覺圈', () => {
  it('敵人 getBodyRadius = 45（可視半徑，取代舊 134 frame 半徑；scaleFactor=1）', () => {
    const e = new Enemy(scene, 0, 0, 'Enemy_Rush');
    expect(e.getBodyRadius()).toBe(45); // 斷字面 45（非綁常數,常數改也要能抓到）
    expect(e.getBodyRadius()).toBe(ENEMY_BODY_RADIUS_PX); // 且 = 設定常數（Rush scaleFactor=1）
    e.forceDestroy();
  });

  it('敵人被推近邊 = 視覺圈 50：body45 + vacuum50 → 中心距95、近邊 95-45=50=FOOT_GLOW.radiusPx', () => {
    const e = new Enemy(scene, 0, 0, 'Enemy_Rush');
    const body = e.getBodyRadius(); // 45
    const p = new Player(scene, 0, 0);
    const vac = p.getVacuumRadius(); // 50
    const minDist = vac + body; // 95
    const player: Vec2 = { x: 0, y: 0 };
    const fixed = pushOutOfPlayer({ x: 10, y: 0 }, player, minDist);
    const centerDist = Math.hypot(fixed.x, fixed.y);
    expect(centerDist).toBeCloseTo(95); // 中心距 = vacuum + body
    // 近邊（敵人身體最靠玩家那側）= 中心距 - body = 50 = 視覺圈（真空帶=視覺圈）。
    expect(centerDist - body).toBeCloseTo(FOOT_GLOW.radiusPx);
    expect(centerDist - body).toBeCloseTo(50);
    e.forceDestroy();
  });
});

describe('回歸根治 — 停 95 能攻擊 vs 舊 body134 停 184 搆不到（#2a 正面+對照）', () => {
  // Enemy_Rush 攻擊：circle offsetX0.8/radius0.45 scale1 → 圓心 = 敵人 + facing×80、半徑45px。
  // 玩家當圓 radius=40（getHitRadius）。circleIntersectsCircle 閾值 = 45+40 = 85。
  // 敵人在玩家右側時「面向玩家」= 面左(facing=-1)，攻擊圓心朝玩家延伸。
  const rushAtk = ENEMY_AI.Enemy_Rush.attack;
  const FACE_TO_PLAYER = -1; // 敵人在玩家右側、面向玩家 → 面左
  const SCALE = 1;
  const PLAYER_HIT = 40;
  const PLAYER: Vec2 = { x: 0, y: 0 };

  it('★ 新 body45：敵人停 minDist=95 於玩家右、面向玩家 → 攻擊形狀內 isPlayerInEnemyAttackShape=true（會攻擊）', () => {
    // 敵人停玩家右側 95px。面向玩家(左)→ 攻擊圓心 = 95 + (-1)×80 = 15，距玩家 15 <= 85 → 命中。
    const enemyPos: Vec2 = { x: 95, y: 0 };
    expect(isPlayerInEnemyAttackShape(rushAtk, enemyPos, FACE_TO_PLAYER, SCALE, PLAYER, PLAYER_HIT)).toBe(true);
  });

  it('★ 對照舊 body134：敵人停 184、面向玩家 → 攻擊圓心離玩家 104 > 85 → false（不攻擊 = bug 根因）', () => {
    // 舊 body134 + vacuum50 → 停 184。攻擊圓心 = 184 + (-1)×80 = 104 > 85 → 搆不到、不攻擊。
    const enemyPosOld: Vec2 = { x: 184, y: 0 };
    expect(isPlayerInEnemyAttackShape(rushAtk, enemyPosOld, FACE_TO_PLAYER, SCALE, PLAYER, PLAYER_HIT)).toBe(false);
  });

  it('攻擊形狀判定與實際命中同基準（isPlayerInEnemyAttackShape 用 Enemy_Rush 真 attack 設定）', () => {
    // 正貼近（停 90，面向玩家）必中；退遠（停 184）不中 — 同一函式、同 attack 設定。
    expect(isPlayerInEnemyAttackShape(rushAtk, { x: 90, y: 0 }, FACE_TO_PLAYER, SCALE, PLAYER, PLAYER_HIT)).toBe(true);
    expect(isPlayerInEnemyAttackShape(rushAtk, { x: 184, y: 0 }, FACE_TO_PLAYER, SCALE, PLAYER, PLAYER_HIT)).toBe(false);
  });
});

describe('回歸根治 — 敵人 setFacingEnemy flipX 反向（修倒著走 #2b）', () => {
  it('敵人面右(f>0) → flipX=false、面左(f<0) → flipX=true（與玩家 setFacing 相反）', () => {
    const anim = new CharacterAnimator(scene, 'Enemy_Rush', 0, 0);
    anim.setFacingEnemy(1); // 面右
    expect(anim.sprite.flipX).toBe(false);
    anim.setFacingEnemy(-1); // 面左
    expect(anim.sprite.flipX).toBe(true);
    anim.destroy();
  });

  it('對照玩家 setFacing：面右→flipX=true、面左→flipX=false（敵人與玩家相反，證反轉）', () => {
    const anim = new CharacterAnimator(scene, 'Enemy_Rush', 0, 0);
    // 玩家式 setFacing：flipX = f>0。
    anim.setFacing(1);
    const playerFlipRight = anim.sprite.flipX; // true
    anim.setFacingEnemy(1);
    const enemyFlipRight = anim.sprite.flipX; // false
    expect(playerFlipRight).toBe(true);
    expect(enemyFlipRight).toBe(false);
    expect(enemyFlipRight).not.toBe(playerFlipRight); // 敵人與玩家相反
    anim.destroy();
  });
});
