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

## 🔑 判準（顧問定調，決策 `dfb08b5e`）：在這個函式的【定義域】上，寫不寫得出一個能鑑別這個改動的測試？

- **寫得出 → 寫測試（不進清單）**。特別是**防禦 guard**（如 `if (amount <= 0) return;`）：
  負數在該函式的**定義域**裡是可達的（是呼叫端現在不傳、**不是函式不接受**；作者用 guard 刻意把負輸入定義成 no-op＝一條契約）。
  傳負 → no-op 是**可鑑別**的（拿掉 guard 會錯誤累積/下溢）→ 寫一條**防禦契約測試**把「刻意擋它」釘成可執行契約。
- **寫不出（整個定義域每個輸入都同輸出＝數學等價）→ 進本清單**（如 Fan 上下對稱、整數域 ceil≡round）＋記分家條件。

判準是**「定義域上有沒有可鑑別差異」**，不是「呼叫端現在可不可達」。
為何不「一律不寫、全列清單」：那讓 guard 沒有測試網接住、全靠人讀清單＝靜默失效。
**清單是「提醒」不是「守衛」，只裝「測試本質上做不到的」（真等價），不是「懶得測的」**。

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
- **為何留清單而非寫測試（用判準）**：`consumeOnHit()` **不吃參數**，只讀內部狀態 `this.credit`；
  要讓這行 clamp 真的 clamp，需要在 `credit=0 且非耗盡` 的狀態下呼叫它——但開頭 `if (this.outOfCredit) return;`
  ＋歸 0 時**同幀原子** `enterOutOfCredit()`，使「credit 會走負」的狀態**透過任何公開 API 呼叫序列都不可達**。
  因此在此函式（經公開 API 可達）的定義域上，**寫不出鑑別測試** → 屬真等價、留清單。
  （對比 chest/jp 的 `amount<=0` guard：那是**參數**級契約，負數在參數定義域內、可直接傳入鑑別 → 寫防禦契約測試，不入清單。）
- **何時變真回歸點**：若 `if (outOfCredit) return` guard 被拿掉／或改成允許在 credit 可能為負的狀態下扣
  （＝讓「credit 走負」的狀態變可達），這個 clamp 就成為唯一防負值的承重碼、且變可鑑別 → 屆時補「扣到負值被 clamp 回 0」對照。
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
