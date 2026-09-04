# 條件性等價清單（Conditional Equivalences）

QA（測騎）維護。記錄「**當前實作下是等價 mutant、但條件性承重**」的防禦碼/實作細節。

## 這份清單是什麼、為什麼存在

做壞版必紅（mutation 對照）時，會遇到「把某行改掉，卻沒有任何測試變紅」的情況。
依團隊 QA 規則（決策 `dfb08b5e`）：**壞版必紅的本意是「抓真回歸」，不是「每個源碼改動都要讓某測試變紅」**。
若一個改動在當前實作下**不產生可觀察行為差異**，那是「等價程式」不是回歸——沒測試該紅、也沒測試能紅，硬湊反而逼出假測試。

但「等價」**不是永久性質，是當前實作的函數**。某行現在是防禦性/等價的，可能因為它**依賴某個前提**；當那個前提被未來的改動打破，這行就會**從防禦碼變成承重碼**，那時它就變成「真回歸點」，需要補一條對照。

**這份清單的用途**（＝「fallback 是承重的、刪掉是錯的」教訓的預防版）：
1. 讓「為什麼這行沒有對應測試」**有據可查**——下一個人不會誤以為是漏測而亂補假測試，也不會誤以為是死碼而刪掉。
2. 當「會讓它變承重的未來改動」真的發生時（例如有人加某新機制），這份清單提醒：**這裡該補一條對照了**，否則防禦碼會在無人補測下默默從等價變承重、回歸不被抓到。

**維護方式**：每次做壞版必紅遇到「改了卻不紅」的點，用下面這把尺判斷該「寫測試」還是「進清單」。

## 🔑 判準（顧問定調，決策 `dfb08b5e`）：能不能寫出一個「鑑別這個改動」的測試？三個維度都要過

一個「改了卻不紅」的點，該**寫測試**還是**進清單**，用以下**三維判準**判（三維都指向「可寫出鑑別測試」才寫，否則進清單）：

**維度 1 — 定義域可達性**：判準是「在函式**定義域**上有沒有可鑑別差異」，**不是**「呼叫端現在可不可達」。
（防禦 guard 如 `if (amount <= 0) return;`：負數在定義域內可達，是「呼叫端現在不傳」而非「函式不接受」→ 可測。）

**維度 2 — 參數層 vs 內部狀態層（可測性 = 觸發條件能否用「這個 unit 可控的輸入」構造出來）**：
- **參數層 = 直接可控** → 觸發值就是參數，測試可直接餵 → **可測 → 寫測試**（防禦契約測試）。
- **內部狀態層 / 受類別不變量把守 = 構造不出** → 要觸發的狀態被公開 API + 不變量擋住，外部構造不出 →
  **測不出 → 留清單**。「內部狀態不可達 → 真等價」與「分家條件」是同件事兩面：不可達因不變量守著，
  不變量一鬆就變可達變承重 → 分家條件要**明確綁到它依賴的不變量**。

**維度 3 — 可觀察行為/契約 vs 實作細節（🔴 顧問補的第三維）**：
「可鑑別」必須是**對可觀察行為/契約**的鑑別，**不是**對**實作細節**（call-count、內部呼叫序列、私有中間值）的鑑別。
- 只綁實作細節（例如「敗時有沒有呼叫 `addTickets(0)`」這種 call-count）的測試，會在**合法重構**時**誤紅**
  （例：改成「一律呼叫、傳算出的值」——行為不變、call-count 變）＝**過擬合的假回歸**。
- 這跟「測空氣」是**相反方向的同一種病**：測空氣＝真回歸不紅（欠擬合）；call-count 測試＝非回歸卻紅（過擬合）。
- 準則：**測行為、不測實作**。若兩版本「玩家可觀察行為/對外契約」完全相同、只差內部呼叫細節 → **進清單**（真行為等價），
  不為 call-count 寫測試（見 #4）。

為何不「一律不寫、全列清單」：那讓 guard 沒有測試網接住、全靠人讀清單＝靜默失效。
**清單是「提醒」不是「守衛」，只裝「測試本質上做不到的」（三維判下來寫不出鑑別測試的真等價），不是「懶得測的」**。

每筆格式：
- **等價點**：哪個檔/哪行、當前是什麼實作細節。
- **依賴前提**：它為什麼在當前是等價的（依賴什麼成立）。
- **何時變真回歸點**：哪個未來改動會打破前提、讓它在定義域上出現可鑑別差異 → 屆時要補的對照。
- **驗證紀錄**：實測「改掉→全綠」的批次（證明當前確為真等價，寫不出鑑別測試）。

---

## 1. Fan 上下（垂直軸）對稱 — dy 正負號翻轉

- **等價點**：`src/systems/hitDetection.ts` `fanIntersectsCircle` 的角度判定
  `cosTheta = (dx * forwardX) / dist`（forward 向量為純水平 `(facing, 0)`）。
  對圓心方向做 `dy → -dy`（上下鏡射）不改變 theta。
- **依賴前提**：扇形的面向向量是**純水平** `(facing, 0)`，`y` 分量恆為 0；
  角度只由 `dx/dist` 決定，`dy` 只透過 `dist`（`hypot(dx,dy)`，對 dy 正負對稱）影響距離，不影響 theta。
  → 扇形對水平軸**天生上下對稱**，`dy` 翻號是等價 mutant（抓不到、也**不該**抓，那是正確設計）。
- **何時變真回歸點**：若扇形 forward 之後帶**垂直分量**（例如攻擊可朝斜上/斜下瞄準，forward 變成非水平的 `(fx, fy)`），
  上下就不再對稱，`dy` 相關的號/項就會有可觀察差異 → 屆時補「斜向 forward 下上/下非對稱」的對照。
- **驗證紀錄**：batch4（Fan harden）。決策 `dfb08b5e` 的源頭案例（顧問立規則：非對稱 bug 要用非對稱輸入測；對稱的等價改動不強求紅）。
  真正的方向鑑別力由「前後（左右）非對稱」case 守著（`fanDetection.test.ts` 前後非對稱 describe）。

## 2. Credit ConsumeCredit 的 `Math.max(0, …)` clamp

- **等價點**：`src/systems/CreditSystem.ts` `consumeOnHit()` 的
  `this.credit = Math.max(0, this.credit - CREDIT_PER_HIT);`
  ——把 `Math.max(0, …)` 拿掉（只留 `this.credit - CREDIT_PER_HIT`）不產生行為差異。
- **為何留清單而非寫測試（用判準）**：`consumeOnHit()` **不吃參數**，只讀內部狀態 `this.credit`（內部狀態層）。
  要讓這行 clamp 真的 clamp，需要在 `credit=0 且非耗盡` 的狀態下呼叫它——但**類別不變量**守著這個狀態：
  開頭 `if (this.outOfCredit) return;` ＋ credit 歸 0 時**同幀原子** `enterOutOfCredit()`，使「credit 會走負」的狀態
  **透過任何公開 API 呼叫序列都不可達**。因此經公開 API 的定義域上**寫不出鑑別測試** → 屬真等價、留清單。
  （對比 chest/jp 的 `amount<=0` guard：那是**參數**級契約，負數在參數定義域內、可直接傳入鑑別 → 寫防禦契約測試，不入清單。）
- **依賴的不變量（＝分家條件，同件事兩面）**：真等價身份**依賴類別不變量**
  「`outOfCredit` guard ＋ 歸 0 同幀原子進耗盡」使「credit 走負」的狀態不可達。
  → **在當前不變量下，經公開 API 不可達 → 真等價；若該不變量改變（guard 被拿掉／改成允許在 credit 可能為負的狀態下扣）使該狀態變可達，此 clamp 即變可測且承重，須補防禦契約測試「扣到負值被 clamp 回 0」。**
  （此即 batch6 對 credit clamp 的原始預測，前後一致：不可達是因不變量守著，不變量一鬆就變可達變承重。）
- **驗證紀錄**：batch6 + batch10 皆實測「拿掉 clamp → credit 測試全綠」。真正守「不為負」的鑑別力現由
  `if(outOfCredit)return` guard + 「倒數中命中不誤扣」不變量 case 提供（拿掉 guard → 該 case 紅）。

## 3. Combo 結算 `Math.ceil` → `Math.round`

- **等價點**：`src/config/comboConfig.ts` `ticketsForCombo`
  `return Math.ceil(count * COMBO_TICKET_MULTIPLIER);`
  ——把 `Math.ceil` 換成 `Math.round` 不產生行為差異。
- **依賴前提**：`COMBO_TICKET_MULTIPLIER = 0.5` 且 `count` 為整數。
  `count × 0.5` 只會是「整數」或「x.5」；`Math.round` 為 round-half-up，`round(x.5) = ceil(x.5) = x+1`，
  整數處兩者也相等 → 在整個整數 count 定義域上 **ceil ≡ round**。
- **何時變真回歸點**：若 `COMBO_TICKET_MULTIPLIER` 改成**非 0.5** 的值（讓 `count×mult` 出現小數部分 < 0.5，
  例如 0.3、0.7），ceil 與 round 就會分家（round 會往下捨、ceil 一律進位）→ 屆時補「ceil ≠ round」對照。
- **驗證紀錄**：batch7（COMBO harden）實測「ceil→round → 全綠」。真正該抓的是 **ceil vs floor**（floor 會少給票），
  已由多條 ticket case + `ceil≠floor` 對照守著。

## 4. GuardEvent 派彩的 `if (won)` 分支（vs 無條件派彩）

- **等價點**：`src/systems/GuardEvent.ts` `finish()` 內
  `if (won) { const reward = Math.round(this.preset.rewardTickets * hpRatio); ... }`
  ——把 `if (won)` 改成 `if (true)`（敗也走派彩分支）在**玩家可觀察行為（發出的獎券數）**上不產生差異。
- **維度 3 判定（顧問定調 = (a) 留清單）**：`if(true)` 版在敗時會多**呼叫一次** `ticket.addTickets(0)`
  （`if(won)` 版完全不呼叫），可用 call-count 鑑別——但 `addTickets(0)` 是 no-op（`if (n<=0) return`），
  **非玩家可觀察行為/契約，只是實作細節**。依維度 3「測行為不測實作」：只綁 call-count 的測試會在合法重構時誤紅
  （過擬合假回歸）→ **不寫 call-count 測試、留清單**。
- **依賴前提（＝分家條件，精準版）**：獎券公式為 `round(rewardTickets × hpRatio)`，且
  **敗 ⟺ 雕像 HP=0 ⟺ hpRatio=0**（`isDefeated` 只在 `hp<=0` 翻真、敗只透過 `isDefeated()` 觸發）
  → 敗時 `round(rewardTickets × 0)=0`，**跑不跑派彩分支，玩家看到的都是 0 票＝可觀察行為等價**。
  → **若獎券公式改成「敗也可能發非 0 票」（例如敗底獎、或 hpRatio 有 >0 的下限），跑不跑分支就有可觀察差異、變真回歸 → 屆時補「敗→0 票」對照。**
- **驗證紀錄**：batch11（Guard harden）實測「`if(won)`→`if(true)` → 玩家可觀察測試（敗給 0 獎券）全綠」。
  真正守「敗不發獎券」的鑑別力，在「獎券公式 × hpRatio」這條前提成立時，由公式本身（hpRatio=0）保證。
  ⚠️ 待顧問定調：這種「玩家可觀察等價、但 call-count 可鑑別」的點，要用 call-count 寫測試、還是留清單？

## 5. 二段變身「被打不斷 COMBO」保護 — 第三種等價：功能修飾符等價（要修飾的 base 行為還不存在）

> **第三種 conditional-equivalence（顧問裁定）**：功能修飾符（modifier）等價，**因為它要修飾的 base 行為還不存在**。
> 二段變身要「保護 COMBO 不被打斷」，但 COMBO 目前本來就不因被打而斷 → 「保護」無從鑑別。

- **等價點**：規格上二段變身有「被打不斷 COMBO」效果（`ChestSystem` L80 註記 + `console.info` 提「護COMBO」），
  但**完全無對應實作碼**。
- **🔴 hook 屬哪種（已查證 = 未接線 inert，風險較高的那種）**：
  - `ComboSystem` **零** `secondTransform`/`isSecondTransform`/`onDamage`/`takeHit`/`break` 參照——**根本沒有 hook slot**。
  - `Player.takeHit`、敵人打玩家的結算路徑（`EnemySpawner`）也**零**參照 combo/secondTransform。
  - 唯一痕跡是 ChestSystem 的**註解 + log 字串**。→ 這**不是**「已接線但暫時無事可做」，而是**未接線（inert）**：
    之後要人**主動把保護接上**攔截點。
- **為何留清單而非寫測試（用判準）**：要鑑別「二段變身保護 COMBO」需先構造「被打會斷 COMBO」的情境再證明它擋得住，
  但**目前沒有「被打斷 COMBO」的碼可觸發/可停用**（無論二段變身 active 與否，被打都不影響 COMBO）→
  在 ComboSystem 當前定義域上**寫不出鑑別測試** → 真等價、留清單。
- **依賴前提（＝分家條件）**：真等價身份依賴「ComboSystem 沒有 takeHit→break 路徑」這個當前事實。
  → **⚠️ 若之後 ComboSystem 加入「玩家被打 → COMBO 斷/歸零」機制：因為此保護是【未接線 inert】的，
    加該機制的人【必須主動把二段變身的保護接到那個攔截點】——否則二段變身的招牌效果會【靜默失效】
    （玩家有二段變身、被打，COMBO 照樣斷，沒人報錯）。** 屆時補對照：二段 active 被打 COMBO 不斷 / inactive 被打斷。
  （這正是本清單價值：日後有人做「被打斷 COMBO」時，清單提醒他「有個招牌保護在等這條、要接上並測」。）
- **驗證紀錄**：batch12（Buff/頭盔 harden）評估。全 src 搜 `secondTransform`：ComboSystem/Player.takeHit/EnemySpawner 皆無參照，確認 inert；「被打不斷」目前只是設計註記、無行為差異可測。

---

## 已從清單移出（改為防禦契約測試）

- **Chest `addCharge` 的 `if (amount <= 0) return` guard**（原 #4，batch8 曾列入）：
  依判準，負量在 `addCharge(amount)` 的**參數定義域**內可達、且可鑑別（傳負→拿掉 guard 會錯誤減 charge/誤觸連開），
  → batch10 已改為**防禦契約測試**（`chestSystem.test.ts`「防禦契約：addCharge(負量) 為 no-op」），移出本清單。
- **JP `notifyCreditSpent` 的 `if (creditAmount <= 0) return` guard**：同理，batch9 起即有防禦契約測試
  （`jpSystem.test.ts`「notifyCreditSpent(0/負) 不累積」），本來就不在清單。

（記錄這段是為了留痕：這兩個曾被誤判/差點誤判為「等價」，實際是「參數定義域可鑑別的防禦契約」→ 該寫測試。
清單只保留「整個定義域寫不出鑑別測試」的真等價。）

---

## 附註

- 此清單只裝「**測試本質上做不到的**」＝在函式定義域上寫不出鑑別測試的真等價；**不是**「懶得測的」。
- 入列前要先實測「改掉→全綠」；且要確認**不是**因為「呼叫端現在不傳」而不紅（那種要寫防禦契約測試），
  而是「整個定義域每個輸入都同輸出」的數學等價。
- 每筆的「何時變真回歸點」是**觸發補測的信號**：review 相關 PR（改到那個前提）時，對照這裡確認是否需要補 case。
- 相關規則：決策 `dfb08b5e`（判準＝定義域上能否寫出鑑別測試；等價 mutant 三層處理：root cause 證明為何等價／指出真鑑別力從哪來／預測何時變承重）。
