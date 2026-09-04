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

**維護方式**：每次做壞版必紅遇到「改了卻不紅、且判定為等價」的點，順手在這裡加一筆（成本＝一行）。

每筆格式：
- **等價點**：哪個檔/哪行、當前是什麼防禦碼/實作細節。
- **依賴前提**：它為什麼在當前是等價的（依賴什麼成立）。
- **何時變真回歸點**：哪個未來改動會打破前提、讓它變承重 → 屆時要補的對照。
- **驗證紀錄**：實測「改掉→全綠」的批次（證明當前確為等價）。

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
- **依賴前提**：`consumeOnHit` 開頭有 `if (this.outOfCredit) return;`，且 credit 歸 0 時**同幀原子地**
  `enterOutOfCredit()`。所以只要非耗盡，credit ≥ 1，`credit - 1 ≥ 0`——clamp **永遠沒真的 clamp 到**。
- **何時變真回歸點**：若 `if (outOfCredit) return` guard 被拿掉／或改成允許在 credit 可能為負的狀態下扣，
  credit 就能走負 → 這個 clamp 變成唯一防止負值的承重碼 → 屆時補「扣到負值被 clamp 回 0」對照。
- **驗證紀錄**：batch6（Credit harden）實測「拿掉 clamp → 全綠」。真正守「不為負」的鑑別力現由
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

## 4. Chest addCharge 的 `if (amount <= 0) return` guard

- **等價點**：`src/systems/ChestSystem.ts` `addCharge(amount)` 的
  `if (amount <= 0) return;`
  ——拿掉這個 guard 不產生行為差異。
- **依賴前提**：唯一餵進 `addCharge` 的來源是 `chestChargeFor(enemyKey)`，回值恆 ≥ 0（表列 1/2/5，未知敵人 = 0）。
  **負數不可達**；`amount = 0` 時 `charge += 0` 不變、`while (charge >= 165)` 為 false 不誤開 → 無可觀察差異。
- **何時變真回歸點**：若日後新增「**扣寶盒能量**」之類的機制、可能對 `addCharge` 傳**負數**
  （或有其他呼叫端可能傳 ≤0 的量並期望被擋），guard 變成承重 → 屆時補「傳負量不減 charge／不誤觸連開」對照。
- **驗證紀錄**：batch8（Chest harden）實測「拿掉 guard → 全綠」。

---

## 附註

- 此清單只記「經實測確認當前等價」的點；**不是**「我猜可能等價」的清單（要先實測改掉→全綠才入列）。
- 每筆的「何時變真回歸點」是**觸發補測的信號**：review 相關 PR（改到那個前提）時，對照這裡確認是否需要補 case。
- 相關規則：決策 `dfb08b5e`（等價 mutant 三層處理：root cause 證明為何等價／指出真鑑別力從哪來／預測何時變承重）。
