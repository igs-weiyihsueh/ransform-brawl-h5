import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { MAP_BOUNDS } from '@/config/mapConfig';
import { ENEMY_CHARACTERS } from '@/entities/Enemy';
import { Player, PLAYER_CHARACTERS } from '@/entities/Player';
import { WAITING_PLATFORM_LIFT } from '@/config/playerConfig';
import { AIController } from '@/systems/AIController';
import type { EnemySpawner } from '@/systems/EnemySpawner';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { PlayerControlSystem } from '@/systems/PlayerControlSystem';

/**
 * DebugSystem — 開發用 debug 疊層與快捷鍵。
 *
 * - 快捷鍵：T 切玩家皮膚、E 切敵人類型並補一隻、R 補同型一隻。
 * - 繪製：玩家攻擊 OBB（黃）、敵人近戰判定圓（紅）。
 * - 資訊列：玩家/面向/被誰打/iFrame、下一隻敵人類型、場上敵人狀態與 HP。
 *
 * 這是可整包移除的 debug 系統：正式版把它從 registry 拿掉即可，玩法不受影響。
 */
export class DebugSystem implements GameSystem {
  readonly name = 'DebugSystem';
  private ctx!: GameContext;
  private gfx!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;

  private playerSkinIndex = 0;
  private enemyTypeIndex = 0;

  /** debug 需要讀這兩個系統的判定圖形。 */
  constructor(
    private readonly playerControl: PlayerControlSystem,
    private readonly spawner: EnemySpawner,
  ) {}

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.gfx = ctx.scene.add.graphics();
    this.infoText = ctx.scene.add.text(16, 16, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    });
    ctx.scene.add
      .text(
        GAME_WIDTH / 2,
        32,
        'WASD/方向鍵 移動   Z/左鍵 攻擊   T 切換玩家(Human↔SunWukong)   E 切換敵人類型   R 補一隻敵人',
        {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: '20px',
          color: '#aaaaaa',
        },
      )
      .setOrigin(0.5, 0);
  }

  update(_dt: number): void {
    const { input, player } = this.ctx;

    // R：補同型一隻
    if (input.isRespawnJustPressed()) {
      this.spawnCurrentType();
    }
    // T：循環切玩家皮膚
    if (input.isSwitchPlayerJustPressed()) {
      this.playerSkinIndex = (this.playerSkinIndex + 1) % PLAYER_CHARACTERS.length;
      player.switchCharacter(PLAYER_CHARACTERS[this.playerSkinIndex]);
    }
    // E：循環切敵人類型並立刻補一隻
    if (input.isSwitchEnemyJustPressed()) {
      this.enemyTypeIndex = (this.enemyTypeIndex + 1) % ENEMY_CHARACTERS.length;
      this.spawnCurrentType();
    }
    // G：生成一個變身道具（走過去撿→變身）
    if (input.isSpawnItemJustPressed()) {
      this.ctx.transform.spawnItem();
    }
    // F2/F3/F4：加入 AI 玩家（P2-P4）
    const joinId = input.justPressedJoin();
    if (joinId > 0) {
      this.joinAiPlayer(joinId);
    }

    this.drawDebug();
    this.updateInfo();
  }

  /** 加入一個 AI 玩家（playerId=1/2/3；已存在則略過）。走 GameContext 受控 addPlayer 入口。 */
  private joinAiPlayer(playerId: number): void {
    if (this.ctx.players.some((p) => p.playerId === playerId)) return; // 已加入
    // 投幣進場循環：AI 加入後先站下方面板待機點，PlayerControl 的待機分支會自動投幣→進場
    // （AI 自動投幣，對應 Unity JoinGame）。起點/進場落點由待機點 + landingX 決定。
    const wait = this.ctx.getWaitingAnchor(playerId);
    const wy = wait.y - WAITING_PLATFORM_LIFT; // 站台座頂面（跟 GameScene 待機 lift 一致）
    const ai = new Player(this.ctx.scene, wait.x, wy, PLAYER_CHARACTERS[0], playerId, 'ai');
    ai.inputSource = new AIController(this.ctx, ai); // AI 的 InputSource（各自目標狀態）
    ai.setWaiting(wait.x, wy); // 開場待機（真空環隱藏、不可操控），下一幀自動投幣進場
    this.ctx.addPlayer(ai);
    console.info(`[Debug] AI 玩家 P${playerId + 1}(id=${playerId}) 加入 → 待機→自動投幣進場`);
  }

  private spawnCurrentType(): void {
    this.ctx.spawner.spawn(
      ENEMY_CHARACTERS[this.enemyTypeIndex],
      GAME_WIDTH * 0.7 + Phaser.Math.Between(-120, 120),
      GAME_HEIGHT * 0.5 + Phaser.Math.Between(-200, 200),
    );
  }

  private drawDebug(): void {
    this.gfx.clear();

    // 地圖邊界（綠框，對應 Unity MapConfig OnDrawGizmos WireCube）。
    this.gfx.lineStyle(2, 0x00ff00, 0.5);
    this.gfx.strokeRect(
      MAP_BOUNDS.minX,
      MAP_BOUNDS.minY,
      MAP_BOUNDS.maxX - MAP_BOUNDS.minX,
      MAP_BOUNDS.maxY - MAP_BOUNDS.minY,
    );

    // 玩家攻擊 OBB（黃）。
    const obb = this.playerControl.getDebugOBB();
    if (obb) {
      this.gfx.lineStyle(2, 0xffeb3b, 0.9);
      this.gfx.save();
      this.gfx.translateCanvas(obb.center.x, obb.center.y);
      this.gfx.rotateCanvas(obb.rotation);
      this.gfx.strokeRect(
        -obb.halfLength,
        -obb.halfWidth,
        obb.halfLength * 2,
        obb.halfWidth * 2,
      );
      this.gfx.restore();
    }

    // 玩家攻擊圓（黃，circle 招式如凡人 skill1）。
    const pc = this.playerControl.getDebugCircle();
    if (pc) {
      this.gfx.lineStyle(2, 0xffeb3b, 0.9);
      this.gfx.strokeCircle(pc.center.x, pc.center.y, pc.radius);
    }

    // 玩家攻擊扇形（黃，fan 招式如悟空 skill1）——用多段線近似扇形。
    const pf = this.playerControl.getDebugFan();
    if (pf) {
      this.gfx.lineStyle(2, 0xffeb3b, 0.9);
      const startA = -pf.halfAngleRad;
      const endA = pf.halfAngleRad;
      const baseA = pf.facing >= 0 ? 0 : Math.PI;
      const steps = 16;
      this.gfx.beginPath();
      this.gfx.moveTo(pf.center.x, pf.center.y);
      for (let i = 0; i <= steps; i += 1) {
        const a = baseA + startA + ((endA - startA) * i) / steps;
        this.gfx.lineTo(
          pf.center.x + Math.cos(a) * pf.radius,
          pf.center.y + Math.sin(a) * pf.radius,
        );
      }
      this.gfx.closePath();
      this.gfx.strokePath();
    }

    // 敵人近戰判定圓（紅）。
    const c = this.spawner.getDebugMeleeCircle();
    if (c) {
      this.gfx.lineStyle(2, 0xff5252, 0.9);
      this.gfx.strokeCircle(c.center.x, c.center.y, c.radius);
    }
  }

  private updateInfo(): void {
    const { player, energy, transform, credit, combo, ticket, chest, jp, wave } = this.ctx;
    const guard = wave.getGuardEvent();
    const enemies = this.ctx.getEnemies();
    const enemyInfo = enemies
      .map(
        (e) =>
          `${e.getCharacterKey().replace('Enemy_', '')}[${e.getState()}]HP${e.getHp()}/${e.getMaxHp()}`,
      )
      .join('  ');
    const facing = player.getFacing() >= 0 ? '→' : '←';
    const nextEnemy = ENEMY_CHARACTERS[this.enemyTypeIndex];
    const hitInfo = player.getLastHitBy() ? `最近被 ${player.getLastHitBy()} 打` : '未被打';
    const iframe = player.isInvincible() ? ' [iFrame無敵中]' : '';
    const p1 = player.playerId;
    const energyInfo = `能量 ${energy.getEnergy(p1)}/${energy.getMax(p1)}${energy.isReady(p1) ? '(READY放招)' : ''}`;
    const soulInfo = transform.isTransformed(p1)
      ? `變身中 魂力 ${transform.getSoul(p1)}/100`
      : '凡人';
    const creditInfo = credit.isOutOfCredit(p1)
      ? `Credit 0 [耗盡! 按C投幣, 倒數${credit.getCountdown(p1).toFixed(1)}s]`
      : `Credit ${credit.getCredit(p1)}`;
    const comboInfo = `COMBO ${combo.getCombo(p1)}${combo.isWarning(p1) ? '(警告!)' : ''}  彩票 ${ticket.getTickets(p1)}`;
    const chestInfo = `寶盒 ${chest.getCharge(p1)}/${chest.getThreshold()}(開${chest.getOpensCount()}${chest.getLastReward() ? ' 最近:' + chest.getLastReward() : ''})`;
    const jpInfo = `JP 紅${jp.getLights('red')}燈×${jp.getMultiplier('red').toFixed(1)} 藍${jp.getLights('blue')}燈×${jp.getMultiplier('blue').toFixed(1)} 紫${jp.getLights('purple')}燈×${jp.getMultiplier('purple').toFixed(1)}${jp.getLastPayout() ? ' 派:' + jp.getLastPayout() : ''}`;
    const guardInfo = guard
      ? `\n🛡守護波 剩${guard.getRemaining()}s 雕像HP ${guard.getTargetHp()}/${guard.getTargetMaxHp()}`
      : '';
    this.infoText.setText(
      `玩家:${player.getCharacterKey()}(${soulInfo})  面向 ${facing}   ${hitInfo}${iframe}\n` +
        `${creditInfo}   ${comboInfo}   ${chestInfo}   ${energyInfo}\n` +
        `${jpInfo}${guardInfo}\n` +
        `下一隻敵人(E補新/R補同型):${nextEnemy}   場上:${enemies.length}  ${enemyInfo}\n` +
        `[G]生變身道具  [X]衝刺  [C]投幣  [H]頭盔  [F2/3/4]加AI玩家(共${this.ctx.players.length}人)  [Z/左鍵]攻擊/放招` +
        (player.isOnCooldown() ? '   [玩家攻擊冷卻中]' : ''),
    );
  }
}
