import Phaser from 'phaser';
import {
  comboTierColorHex,
  HUD_COLORS,
  HUD_FONT_FAMILY,
  OVERHEAD_DEPTH,
  OVERHEAD_LAYOUT,
  resolveOverheadLayout,
  UI_ICONS,
} from '@/config/uiConfig';
import { EnergyBar } from '@/systems/ui/EnergyBar';
import {
  resolveSecondTransformDisplay,
  type SecondTransformStyle,
} from '@/systems/ui/secondTransformDisplay';

/**
 * PlayerOverheadUI — 角色頭上 UI（對照 Unity PlayerUI 200×80）。
 *
 * 世界座標容器，每幀跟隨玩家浮在頭上（setPosition）。內含：
 *  - 玩家編號牌（P1）
 *  - 魂力環（60×60 圓環，stub 先固定滿）
 *  - Credit 數字 + 金幣 icon（stub）
 *  - 能量 4 格（EnergyBar 嵌入，接現有 getEnergy，滿格閃爍）
 *  - COMBO「n HIT」（stub）
 *
 * 純顯示層：位置讀 ctx.player.getPosition()，數值由 UISystem 傳入，絕不回寫。
 * 目前用色塊/圓/文字排佈局；真美術 icon 之後替換。
 */
export class PlayerOverheadUI {
  private readonly container: Phaser.GameObjects.Container;
  private readonly soulRing: Phaser.GameObjects.Graphics;
  /** 二段變身能量條（用戶新大功能）：魂力環同位置疊一條二段填充弧，available 時取代魂力環顯示。 */
  private readonly secondRing: Phaser.GameObjects.Graphics;
  /** 魂力環底圖（ring.png，用戶 #1：變身前隱藏魂力條）；無 sprite 則 null。 */
  private readonly ringImg: Phaser.GameObjects.Image | null = null;
  private readonly creditText: Phaser.GameObjects.Text;
  /** 沒 Credit 投幣提示文字（對照 Unity CoinHint），預設隱藏。 */
  private readonly coinHintText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly maxText: Phaser.GameObjects.Text;
  private readonly energyBar: EnergyBar;
  /** 用戶 #6：per-group 顯示物件（供 layout.overhead.{badge,credit,energy,combo}.visible 隱藏）。 */
  private readonly groupBadge: Phaser.GameObjects.GameObject[] = [];
  private readonly groupCredit: Phaser.GameObjects.GameObject[] = [];
  private readonly groupCombo: Phaser.GameObjects.GameObject[] = [];

  private shownSoul = -1;
  /** 二段能量條上次繪製狀態（ratio+樣式+可見）：變動才重畫。 */
  private shownSecondRatio = -1;
  private shownSecondStyle: 'charging' | 'active' | 'none' = 'none';
  private shownCredit = -1;
  private shownCombo = -1;
  /** COMBO 警告閃爍中旗標，避免重複啟動 tween。 */
  private comboWarning = false;
  /** 警告閃爍 tween（active 時存在）。 */
  private warnTween?: Phaser.Tweens.Tween;
  /** MAX! 一次性強調 tween（播放中存在）。 */
  private maxTween?: Phaser.Tweens.Tween;
  /** COMBO 跳動放大 tween（PunchEffect；連續 combo 防重入重啟）。 */
  private comboPunchTween?: Phaser.Tweens.Tween;
  /** 沒 Credit 閃紅旗標 + tween（防重入）。 */
  private outOfCredit = false;
  private creditFlashTween?: Phaser.Tweens.Tween;
  /** 連打變身 UI 狀態 + 放大 tween + 訊息文字（防重入）。 */
  private mashActive = false;
  private mashScaleTween?: Phaser.Tweens.Tween;
  private mashMsgText?: Phaser.GameObjects.Text;
  /** 解析後（含 override）的沒 credit 演出設定，供 setOutOfCredit 用。 */
  private readonly outOfCreditCfg: typeof OVERHEAD_LAYOUT.credit.outOfCredit;
  /** 保存 scene 以供 tween 使用。 */
  private readonly scene: Phaser.Scene;
  /** 是否已用 ring.png 當魂力環底圖（true 時 setSoul 不再畫底槽環，只畫填充弧）。 */
  private hasRingSprite = false;

  constructor(
    scene: Phaser.Scene,
    badgeText: string = OVERHEAD_LAYOUT.badge.text,
    badgeColor: number = HUD_COLORS.pNumBg,
    overhead?: Parameters<typeof resolveOverheadLayout>[0],
  ) {
    // 七輪 overhead override 補接：座標讀 layout.overhead(含 override) 合併進 OVERHEAD_LAYOUT，
    //   無 override/缺欄 → 打包預設(行為不變)。取代舊「硬讀 OVERHEAD_LAYOUT 靜態 const 無視 override」。
    const cfg = resolveOverheadLayout(overhead);
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(OVERHEAD_DEPTH);

    // --- 玩家編號牌（圓形）+ 魂力環（同心，環在外圈繞著編號牌）---
    // 繪製順序：魂力環底圖(ring.png 或畫底槽) → 魂力填充弧 → 內圓編號牌 → P1 文字。
    // ring.png 當底框（對照 Unity RingSprite）；魂力多寡仍用彩色弧疊在上面表現。
    if (scene.textures.exists(UI_ICONS.ring.key)) {
      const ringImg = scene.add.image(cfg.badge.cx, cfg.badge.cy, UI_ICONS.ring.key);
      ringImg.setDisplaySize(cfg.badge.ringRadius * 2 + cfg.badge.ringThickness, cfg.badge.ringRadius * 2 + cfg.badge.ringThickness);
      this.container.add(ringImg);
      this.ringImg = ringImg; // 用戶 #1：留參考供變身前隱藏
      this.groupBadge.push(ringImg);
      this.hasRingSprite = true;
    }
    this.soulRing = scene.add.graphics();
    this.container.add(this.soulRing);
    this.groupBadge.push(this.soulRing);

    // 二段變身能量條（用戶新大功能）：魂力環同心同位置疊一條二段填充弧。
    // 預設隱藏；available 時由 UISystem 呼叫 setSecondTransform 顯示並取代魂力環。
    // 併入 groupBadge → 沿用 badge visible 隱藏開關（用戶 #6）。
    this.secondRing = scene.add.graphics();
    this.secondRing.setVisible(false);
    this.container.add(this.secondRing);
    this.groupBadge.push(this.secondRing);

    const pnum = scene.add.graphics();
    pnum.fillStyle(badgeColor, 1);
    pnum.fillCircle(cfg.badge.cx, cfg.badge.cy, cfg.badge.innerRadius);
    pnum.lineStyle(2, HUD_COLORS.panelStroke, 0.9);
    pnum.strokeCircle(cfg.badge.cx, cfg.badge.cy, cfg.badge.innerRadius);
    this.container.add(pnum);
    this.groupBadge.push(pnum);

    const pnumText = scene.add
      .text(cfg.badge.cx, cfg.badge.cy, badgeText, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.badge.fontSize,
        color: HUD_COLORS.text,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(pnumText);
    this.groupBadge.push(pnumText);

    // --- Credit 底框 + 劍 icon（sword.png，用戶 #5：credit=投幣點數改用劍）+ 數字 ---
    const creditBg = scene.add.graphics();
    creditBg.fillStyle(HUD_COLORS.creditBg, 0.55);
    creditBg.fillRoundedRect(cfg.credit.x, cfg.credit.y, cfg.credit.width, cfg.credit.height, 6);
    this.container.add(creditBg);
    this.groupCredit.push(creditBg);
    const coinR = cfg.credit.coinSize / 2;
    const coinCx = cfg.credit.x + coinR + 6;
    const coinCy = cfg.credit.y + cfg.credit.height / 2;
    if (scene.textures.exists(UI_ICONS.sword.key)) {
      const swordImg = scene.add.image(coinCx, coinCy, UI_ICONS.sword.key);
      swordImg.setDisplaySize(cfg.credit.coinSize, cfg.credit.coinSize);
      this.container.add(swordImg);
      this.groupCredit.push(swordImg);
    } else {
      // fallback：貼圖沒載到時退回金幣圓形佔位（不致空白）。
      const coin = scene.add.graphics();
      coin.fillStyle(HUD_COLORS.coin, 1);
      coin.fillCircle(coinCx, coinCy, coinR);
      coin.lineStyle(2, 0x8a6d0f, 1);
      coin.strokeCircle(coinCx, coinCy, coinR);
      this.container.add(coin);
      this.groupCredit.push(coin);
    }
    this.creditText = scene.add
      .text(coinCx + coinR + 6, coinCy, cfg.credit.placeholder, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.credit.fontSize,
        color: HUD_COLORS.text,
      })
      .setOrigin(0, 0.5);
    this.container.add(this.creditText);
    this.groupCredit.push(this.creditText);

    // 沒 Credit 投幣提示（對照 Unity CoinHint）：表現/位置讀 override(resolveOverheadLayout)，
    // 開放編輯器可調。預設隱藏，setOutOfCredit(true) 時顯示+閃。
    const oc = cfg.credit.outOfCredit;
    this.outOfCreditCfg = oc;
    this.coinHintText = scene.add
      .text(
        cfg.credit.x + oc.hintOffsetX,
        cfg.credit.y + cfg.credit.height + oc.hintOffsetY,
        oc.hintText,
        {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: oc.hintFontSize,
          color: oc.hintColor,
          fontStyle: 'bold',
        },
      )
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.container.add(this.coinHintText);
    this.groupCredit.push(this.coinHintText);

    // --- 能量 4 格（嵌入容器）---
    this.energyBar = new EnergyBar(scene, this.container, cfg.energy.x, cfg.energy.y);

    // --- COMBO「n HIT」---
    this.comboText = scene.add
      .text(cfg.combo.x, cfg.combo.y, '', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.combo.fontSize,
        color: HUD_COLORS.comboText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(this.comboText);
    this.groupCombo.push(this.comboText);

    // --- MAX!（一次性強調，對照 Unity ShowMaxCombo）；預設隱藏 ---
    this.maxText = scene.add
      .text(cfg.combo.x, cfg.combo.y + cfg.combo.max.offsetY, cfg.combo.max.text, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.combo.max.fontSize,
        color: cfg.combo.max.color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.container.add(this.maxText);
    this.groupCombo.push(this.maxText);

    // 連打變身訊息（預設隱藏，setMashTransform(true) 時顯）。
    const mt = cfg.mashTransform;
    this.mashMsgText = scene.add
      .text(mt.messageX, mt.messageY, mt.message, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: mt.messageFontSize,
        color: mt.messageColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.container.add(this.mashMsgText);

    // 初始顯示。
    this.setSoul(1);
    this.setCredit(0);
    this.setCombo(0);
  }

  /**
   * 用戶 #6：依 layout.overhead 各元素 visible 隱藏對應 group（badge/credit/energy/combo）。
   * false=隱藏；undefined/true=顯示（預設）。由 UISystem 建構後以 JSON layout.overhead 呼叫。
   * 注意：badge/credit/combo 用 group 物件 setVisible；energy 用 EnergyBar.setContainerVisible。
   */
  setElementVisibility(vis: { badge?: boolean; credit?: boolean; energy?: boolean; combo?: boolean }): void {
    if (vis.badge === false) for (const o of this.groupBadge) (o as unknown as { setVisible: (v: boolean) => void }).setVisible(false);
    if (vis.credit === false) for (const o of this.groupCredit) (o as unknown as { setVisible: (v: boolean) => void }).setVisible(false);
    if (vis.combo === false) for (const o of this.groupCombo) (o as unknown as { setVisible: (v: boolean) => void }).setVisible(false);
    if (vis.energy === false && typeof this.energyBar.setContainerVisible === 'function') this.energyBar.setContainerVisible(false);
  }

  /** 七輪 待機隔離：整個頭上 UI 容器顯示/隱藏（待機玩家不顯，加入後顯）。 */
  setContainerVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  /** 每幀跟隨玩家：把容器移到玩家位置上方。 */
  followWorldPosition(x: number, y: number): void {
    this.container.setPosition(x, y + OVERHEAD_LAYOUT.offsetY);
  }

  /** 設定魂力比例（0..1）。環繞在編號牌外圈（同心）。stub：目前傳固定值。 */
  setSoul(ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    if (clamped === this.shownSoul) return;
    this.shownSoul = clamped;

    const cfg = OVERHEAD_LAYOUT.badge;
    const g = this.soulRing;
    g.clear();
    // 沒有 ring.png 時才畫底槽環（有 sprite 就用圖當底，只疊填充弧）。
    if (!this.hasRingSprite) {
      g.lineStyle(cfg.ringThickness, HUD_COLORS.soulRingBg, 1);
      g.strokeCircle(cfg.cx, cfg.cy, cfg.ringRadius);
    }
    // 魂力充填弧（從 12 點鐘順時針，弧度表現魂力多寡）。
    if (clamped > 0) {
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * clamped;
      g.lineStyle(cfg.ringThickness, HUD_COLORS.soulRingFill, 1);
      g.beginPath();
      g.arc(cfg.cx, cfg.cy, cfg.ringRadius, start, end, false);
      g.strokePath();
    }
  }

  /**
   * 魂力環顯示 gate（用戶 #1：變身前不顯示魂力條，變身後才顯）。
   * 隱藏/顯示魂力環底圖(ring.png)+充填弧(soulRing)；P 編號牌與其餘 UI 不受影響。
   * @param visible 是否顯示（= 是否已變身，由 UISystem 傳 transform.isTransformed）。
   */
  setSoulVisible(visible: boolean): void {
    this.ringImg?.setVisible(visible);
    this.soulRing.setVisible(visible);
  }

  /**
   * 二段變身能量條（用戶新大功能，讀翼騎 TransformSystem 接口，只讀不回寫）：
   *  - available=true（一段悟空後且 flag 開）→ 魂力環位置改顯二段能量條（打怪累積 ratio 填充）；
   *    魂力環（底圖+充填弧）隱藏，改由二段填充弧表現。
   *  - active=true（二段變身中，放大強化）→ 二段條用 active 樣式（更醒目色，ratio 隨時間消退往下）。
   *  - available=false 且 active=false（未變身/flag 關）→ 二段條隱藏，回傳 false 交回現有魂力環邏輯。
   *
   * ★feature flag 關時核心回 available=false/ratio=0 → 此處 show=false → 完全走現有魂力環（現況不受影響）。
   * 純顯示；ratio/樣式決策走純函式 resolveSecondTransformDisplay（可測）。變動才重畫（省開銷）。
   *
   * @returns 是否正在顯示二段能量條（true → 呼叫端不要再跑魂力環顯示邏輯）。
   */
  setSecondTransform(available: boolean, active: boolean, ratio: number): boolean {
    const d = resolveSecondTransformDisplay(available, active, ratio);
    if (!d.show) {
      // 不顯二段條：隱藏二段弧、清狀態；魂力環顯示交回 UISystem/setSoulVisible。
      if (this.shownSecondStyle !== 'none') {
        this.shownSecondStyle = 'none';
        this.shownSecondRatio = -1;
        this.secondRing.setVisible(false).clear();
      }
      return false;
    }
    // 顯二段條：魂力環（底圖+充填弧）讓位隱藏，改顯二段填充弧於同位置。
    this.ringImg?.setVisible(false);
    this.soulRing.setVisible(false);
    this.secondRing.setVisible(true);
    // 變動才重畫。
    if (d.ratio === this.shownSecondRatio && d.style === this.shownSecondStyle) return true;
    this.shownSecondRatio = d.ratio;
    this.shownSecondStyle = d.style;
    this.drawSecondRing(d.ratio, d.style);
    return true;
  }

  /** 畫二段能量填充弧（魂力環同心同位置；底槽 + 依 ratio 的彩色填充弧）。 */
  private drawSecondRing(ratio: number, style: SecondTransformStyle): void {
    const cfg = OVERHEAD_LAYOUT.badge;
    const g = this.secondRing;
    g.clear();
    // 底槽環（沿用魂力環底槽色，同心同半徑，讓二段條「接管」魂力環視覺位置）。
    g.lineStyle(cfg.ringThickness, HUD_COLORS.soulRingBg, 1);
    g.strokeCircle(cfg.cx, cfg.cy, cfg.ringRadius);
    if (ratio > 0) {
      // 從 12 點鐘順時針填充，弧度=ratio（與魂力環同方向，位置一致）。
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * ratio;
      const color = style === 'active' ? HUD_COLORS.secondRingActive : HUD_COLORS.secondRingFill;
      g.lineStyle(cfg.ringThickness, color, 1);
      g.beginPath();
      g.arc(cfg.cx, cfg.cy, cfg.ringRadius, start, end, false);
      g.strokePath();
    }
  }

  /**
   * 連打變身 UI（讀翼騎 TransformSystem.isMashingTransform/getMashRatio）。
   * active=true：頭上 UI 放大 + 顯訊息 + 魂力環從空(ratio 0)慢慢填滿(ratio 0..1)。
   * active=false：縮回、藏訊息（魂力環顯示交回 UISystem 的變身後 soul 邏輯）。
   * 純顯示，不改核心。連打填充 ratio 與變身後 soul ratio 由 UISystem 分流呼叫（見下）。
   */
  setMashTransform(active: boolean, ratio: number): void {
    const mt = OVERHEAD_LAYOUT.mashTransform;
    if (active !== this.mashActive) {
      this.mashActive = active;
      this.mashMsgText?.setVisible(active);
      // 頭上 UI 整體放大/縮回（container scale）。
      this.mashScaleTween?.stop();
      this.mashScaleTween = this.scene.tweens.add({
        targets: this.container,
        scale: active ? mt.enlargeScale : 1,
        duration: mt.scaleMs,
        ease: 'Back.easeOut',
      });
    }
    // 連打中：魂力環顯示 + 從 getMashRatio 填充（空→滿）。
    if (active) {
      this.setSoulVisible(true);
      this.setSoul(ratio);
    }
  }

  /** 設定 Credit 數字。stub：目前傳 0（Credit 系統未做）。 */
  setCredit(value: number): void {
    if (value === this.shownCredit) return;
    this.shownCredit = value;
    // 補零到 5 位（對照 Unity 99999 樣式）。
    this.creditText.setText(`${Math.max(0, Math.floor(value))}`.padStart(5, '0'));
  }

  /**
   * 沒 Credit 演出（對齊 Unity credit=0：閃紅 + 投幣提示 + 倒數）。純顯示層：
   * 讀 credit.isOutOfCredit(pid)/getCountdown(pid) 傳入，不回寫核心。
   * 角色本體閃紅由核心 CreditSystem 處理；此處是 HUD credit 顯示區的演出。
   * @param active 是否耗盡（credit=0）。
   * @param countdown 剩餘倒數秒數（用於提示文字附秒數；可省）。
   */
  setOutOfCredit(active: boolean, countdown = 0): void {
    const oc = this.outOfCreditCfg;
    if (active !== this.outOfCredit) {
      this.outOfCredit = active;
      if (active) {
        this.coinHintText.setVisible(true);
        // credit 數字閃紅（yoyo 無限）。
        this.creditText.setColor(oc.flashColor);
        this.creditFlashTween = this.scene.tweens.add({
          targets: [this.creditText, this.coinHintText],
          alpha: { from: 1, to: 0.3 },
          duration: oc.blinkMs,
          yoyo: true,
          repeat: -1,
        });
      } else {
        // 復原：停閃、還原色與透明度、藏提示。
        this.creditFlashTween?.stop();
        this.creditFlashTween = undefined;
        this.creditText.setAlpha(1).setColor(HUD_COLORS.text);
        this.coinHintText.setAlpha(1).setVisible(false);
      }
    }
    // 倒數秒數附在提示後（如「投幣 (C) 9」）。
    if (active && oc.showCountdown) {
      const secs = Math.max(0, Math.ceil(countdown));
      this.coinHintText.setText(`${oc.hintText} ${secs}`);
    } else if (active) {
      this.coinHintText.setText(oc.hintText);
    }
  }

  /**
   * 設定 COMBO 數（對照 Unity ComboUI ShowCombo）。
   * - 顏色階層：>=20 紅 / >=10 橙 / else 金（warning 啟用時警告色 override，見 setComboWarning）。
   * - 跳動放大：combo 數「增加」時文字 punch 彈跳一下（scale 1→peak→1）。
   * 由 UISystem 每幀傳 combo.getCombo(pid)。
   */
  setCombo(value: number): void {
    const cfg = OVERHEAD_LAYOUT.combo;
    const n = Math.max(0, Math.floor(value));
    if (n === this.shownCombo) return;
    const increased = n > this.shownCombo && this.shownCombo >= 0;
    this.shownCombo = n;

    const visible = !(cfg.hideWhenZero && n === 0);
    this.comboText.setVisible(visible);
    if (!visible) return;
    this.comboText.setText(`${n}${cfg.suffix}`);

    // 顏色階層（warning 中不覆蓋，警告色優先）。
    if (!this.comboWarning) {
      this.comboText.setColor(comboTierColorHex(n));
    }

    // 跳動放大：combo 增加時 punch（防重入：先停舊的、從 peak 彈回 1）。
    if (increased) this.punchCombo();
  }

  /** COMBO 文字跳動放大（Unity PunchEffect）：scale 1→peak→1 回彈。連續 combo 重啟。 */
  private punchCombo(): void {
    const p = OVERHEAD_LAYOUT.combo.punch;
    this.comboPunchTween?.stop();
    this.comboText.setScale(1);
    this.comboPunchTween = this.scene.tweens.add({
      targets: this.comboText,
      scale: { from: p.peakScale, to: 1 },
      duration: p.durationMs,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.comboText.setScale(1);
        this.comboPunchTween = undefined;
      },
    });
  }

  /**
   * COMBO 快超時警告（對照 Unity ComboUI warning）。
   * active=true：數字變警告色 + 閃爍；false：停止並復原。
   * 由翼騎接 ComboSystem.isWarning() 每幀（或狀態變化時）呼叫。
   */
  setComboWarning(active: boolean): void {
    if (active === this.comboWarning) return;
    this.comboWarning = active;

    const w = OVERHEAD_LAYOUT.combo.warning;
    if (active) {
      // 變警告色 + 明↔暗閃爍（yoyo 無限）。
      this.comboText.setColor(w.color);
      this.warnTween = this.scene.tweens.add({
        targets: this.comboText,
        alpha: { from: 1, to: w.minAlpha },
        duration: w.blinkMs,
        yoyo: true,
        repeat: -1,
      });
    } else {
      // 停止閃爍、復原透明度；顏色復原成當前 combo 數的階層色（非固定色）。
      this.warnTween?.stop();
      this.warnTween = undefined;
      this.comboText.setAlpha(1);
      this.comboText.setColor(comboTierColorHex(Math.max(0, this.shownCombo)));
    }
  }

  /**
   * COMBO 滿檔強調（對照 Unity ShowMaxCombo）：顯示 "MAX!" 放大彈跳後淡出。
   * 一次性：由翼騎接 ComboSystem.consumeMaxTriggered() 為 true 時呼叫一次。
   */
  showMaxCombo(): void {
    const m = OVERHEAD_LAYOUT.combo.max;
    // 若上一次還在播，先停掉重來。
    this.maxTween?.stop();
    this.maxText.setVisible(true).setAlpha(1).setScale(m.punchScale);
    // 放大彈回 → 停留 → 淡出隱藏。
    this.maxTween = this.scene.tweens.add({
      targets: this.maxText,
      scale: 1,
      duration: m.popMs,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.maxTween = this.scene.tweens.add({
          targets: this.maxText,
          alpha: 0,
          duration: m.fadeMs,
          delay: m.popMs,
          onComplete: () => {
            this.maxText.setVisible(false).setAlpha(1).setScale(1);
            this.maxTween = undefined;
          },
        });
      },
    });
  }

  /** 設定能量格數（0..4）。接現有 getEnergy stub。 */
  setEnergy(value: number): void {
    this.energyBar.setEnergy(value);
  }

  /** 設定能量階段（0=skill1/1=skill2/2=ultimate）→ 能量格黃/青/紅。接 energy.getSkillStage。 */
  setEnergyStage(stage: number): void {
    this.energyBar.setStage(stage);
  }

  /** 每幀推進能量滿格閃爍。 */
  updateEnergy(dt: number): void {
    this.energyBar.update(dt);
  }

  destroy(): void {
    this.warnTween?.stop();
    this.maxTween?.stop();
    this.comboPunchTween?.stop();
    this.creditFlashTween?.stop();
    this.mashScaleTween?.stop();
    this.energyBar.destroy();
    this.container.destroy(); // 連同容器內所有子物件一併銷毀
  }
}
