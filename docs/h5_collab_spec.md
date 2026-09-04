# 《變身大亂鬥》H5 多人協作與架構規範 v1.0

> 本文件是**架構準則 + 檢核標準**，供開發手遵循、供 review 逐項對照。統籌=異靈；架構把關=變身-leader；審查=鐵騎。技術棧 Phaser 3.90 + TS(strict) + Vite 6，部署 GitHub Pages。

## 0. 一頁速覽
1. 邏輯放 systems/、資料放 config/、Phaser 組裝放 scenes/、物件放 entities/，四層不越界。
2. 改共用契約前先講：介面/結構經 leader、玩法/數值語意同步異靈。清單見 §4。
3. GameScene.ts 是撞車熱區：各系統自帶 init(scene)，GameScene 只呼叫。§5。
4. 數值一律 export const+型別集中 config/*.ts，對照 Unity 標來源，不寫死。§6。
5. 一任務一 feature 分支，合併前 pull --rebase 保線性，不製造 merge commit。commit 第一行人話。§7。
6. 平行開發手不能互相溝通 → 任務必須檔案層級不重疊。owner 表 §3。

## 1. 架構分層準則
依賴方向 scenes→entities→systems→config，不可逆向。
- scenes/：建場景/串主迴圈/接系統，不放演算法
- entities/：封裝單一物件狀態+行為，不放跨物件判定
- systems/：判定/演算法/輸入抽象，盡量零 Phaser 依賴，可單元測試+對照 Unity C#
- config/：數值集中，export const+型別，對照 Unity 標來源
核心：判定做成可重用純函式(範本 hitDetection/CharacterAnimator)；不自己發明玩法；strict 全開不用 any 繞。

## 2. 目錄結構（現況範本）
src/scenes(BootScene,GameScene)/systems(hitDetection,CharacterAnimator,AttackData,InputSystem,Projectile)/entities(Player,Enemy)/config(combatConfig,animationConfig,enemyConfig,gameConfig)/main.ts。public/assets/{images,audio,data}(data 目前僅 .gitkeep)。

## 3. 檔案層級 Owner 邊界
狀態：✅完成/維護中　🟡共用契約(改動先講)　⬜未開發
**已佔用：**
- 場景整合：scenes/GameScene.ts,BootScene.ts,main.ts ✅ 撞車熱區
- 輸入：systems/InputSystem.ts 🟡
- 角色動畫：systems/CharacterAnimator.ts+config/animationConfig.ts 🟡 新角色只加 config 一筆
- 戰鬥判定：systems/hitDetection.ts+AttackData.ts+config/combatConfig.ts 🟡
- 敵人AI：entities/Enemy.ts+config/enemyConfig.ts+systems/Projectile.ts ✅翼騎完成 對照 Unity AI_Rush/Ranged/Elite
- 玩家：entities/Player.ts ✅
- 基礎設定：config/gameConfig.ts 🟡 1920×1080/PPU=100/toPixels()
**未開發(擴編候選,最不撞優先)：**
- 攻擊特效VFX：新 systems/EffectSystem.ts+特效圖，僅加 animationConfig 條目 → 獨立度高
- 波次/關卡：新 systems/WaveSystem.ts+config/levelConfig.ts，由 GameScene init 呼叫 → 高
- UI/能量招式/變身/COMBO/抽獎/魂力：會動 Player/combatConfig(翼騎核心) → 中低，排後
分派原則(建議,交異靈判斷)：平行開兩手優先配「特效VFX＋波次」，檔案幾乎不重疊；能量招式排後。

## 4. 共用契約（改動前先講）
清單：hitDetection.ts(OBB+圓判定全套)、AttackData.ts(型別單一來源,對齊 Unity)、CharacterAnimator+animationConfig、InputSystem.ts、gameConfig(PPU=100)。
流程：介面/結構改動→經 leader 過一次(擋撞車)；玩法/數值語意→同步異靈(對照 Unity)；重疊處兩邊對一下。確定後異靈通知全體。

## 5. GameScene 防撞規則
①每系統自帶 init(scene) 自行註冊 ②GameScene 只做「依序 init + update 呼叫各系統」 ③不把邏輯往裡塞 ④新系統對 GameScene 的改動應只有「多一次 init/update 呼叫」，超出範圍 review 特別看。

## 6. 資料驅動硬規則
1. 數值集中 config/*.ts，export const+型別，不寫死魔術數字
2. **對照 Unity 標來源**：config 內註記對應 Unity asset/欄位(例 // 對應 Unity AI_Rush.moveSpeed)方便核對撈值
3. 邏輯讀 config 不反向
4. 新角色/敵人/關卡=加一筆 config,不複製邏輯
5. JSON 化觸發條件(目前不做)：現維持 TS 常數(型別安全);未來要接編輯器/讓非工程改數值再抽 public/assets/data/*.json+載入+schema,在那之前 data/ 保留空目錄。

## 7. Git 分支與 commit 規範
分支：main 隨時可部署不直接推(擴編後生效)；一任務一 feat/<模組>-<簡述>；PR→review 過合 main；合併前 pull --rebase 保線性不製造 merge commit；main 不 rebase，衝突在 feature 解。
commit：
```
[操作類型] 讓人看到什麼差別

技術：技術細節
```
四類 [New]/[Modify]/[Fix]/[Delete]；第一行≤30字寫人話；第一行與技術行必須空一行(否則 --oneline 接成一串)；技術行講不清才寫，不為補而補；不寫誰指示。

## 8. 審查流程與檢核表
流程：開發手完成→report 異靈→異靈驗(build/跑)→鐵騎 review→2 來回內結束；小改異靈驗過直收。
鐵騎檢核表：□分層正確無逆向依賴 □未破壞共用契約(動到有走§4) □GameScene 改動僅 init/update 呼叫 □數值走 config 無魔術數字 □未自創玩法對照 Unity □strict 通過無 any 繞 □commit 格式對 □自己 build 過跑過。

## 9. 協作紀律
交任務一次一個等回報；平行開發手不能互通→任務必須獨立(改不同檔)，相依由異靈排序；不確定先問不猜不擴玩法；改完自己 build 過跑過再回報。

## 10. 待補(擴編前)
開幾個開發手各認領哪模組(異靈定,參 §3 原則)；多人推同 repo 認證方式(目前 fine-grained PAT)；鐵騎正式納入 H5 review 範圍時機。

## 11. 測試與 QA
> 核心信念：測試最大的風險不是「沒測試」，是「一整排綠燈卻對真正的行為結構性失明」。所有規則都為防這個。

### 11.1 三層測試策略（各自誠實標範圍）
| 層 | 工具 | 測什麼 | 證明什麼／證明不了 | 現在做嗎 |
|---|---|---|---|---|
| 單元 | vitest | 純邏輯(systems/config)：命中判定/validateLevels/傷害/spawn 權重/能量數學 | ✅抓邏輯回歸 ❌不證明畫面/整合/手感 | ✅現在 |
| Boot smoke | vitest(jsdom/happy-dom或node) | 遊戲能否 boot 不丟例外：實例化→跑N幀→assert無throw | ✅抓接線斷 ❌不證明畫面/玩法對 | ✅很快 |
| E2E | Playwright | 遊戲載入/波次生怪/編輯器CRUD匯出/試玩交握 | ✅抓端到端斷裂 ❌建置維護貴易flaky | ⬜延後 |

🔴 誠實紅線：測試全綠 ≠ 遊戲沒問題。單元+smoke 接住邏輯回歸與接線斷；畫面/手感仍需人看。不得以「測試全過」宣稱畫面或體驗無虞。

### 11.2 🔴 壞版必紅鐵律
每個測試要證明它在壞版本上會失敗，不是只在好版本上通過。好壞都綠的測試=測空氣。交付附負向對照(把X改壞這顆確實紅)+保留陽性對照(好版綠)。來源消失明說未檢查。對所有層適用。

### 11.3 測試撰寫約束
- 勿 assert 錯誤訊息字面(給人看的輸出會潤字)；驗錯誤數量或針對哪欄位。需機器辨識用 code 欄位不用 message 字面。
- 優先測純邏輯層；需 Phaser 的走 smoke/E2E 不硬塞單元。
- 測試檔 *.test.ts，源碼旁或 tests/ 鏡像。

### 11.4 CI
- Actions 在 PR 跑測試+顯示紅綠。
- 🔴 因 main push 自動部署，測試結果部署前必須可見(紅 main 會推壞 build 上線)。
- 是否硬擋 PR=政策決定由用戶拍板(現行 advisory：跑+顯示不硬擋+鐵騎人審；要硬擋再加)。
- 註：SpinningTop 曾裁示不做 push 前硬擋，那是該專案獨立決定不自動套用本專案。

### 11.5 角色邊界(QA/鐵騎/開發手/架構顧問)
判準=證明的對象+時機，四者不重疊：
| 角色 | 證明什麼 | 方式 | 時機 |
|---|---|---|---|
| 開發手自測 | 我這改動 build 過跑得起來 | 自跑 | per-change |
| 鐵騎審查 | 這次 PR 的 code 對不對 | 人眼讀 code 對照 spec/架構 | per-PR |
| QA agent | 跨時間回歸有沒被自動接住 | 維護+執行自動測試套件 | 持續 suite 層級 |
| 架構顧問 | 介面/契約/結構決策對不對 | 設計期把關 | 動手前 |

一句話：鐵騎審「這次改動的 code」(人讀)；QA 維護「跨時間自動抓回歸的網」(機器跑)。QA 不審 code 風格/架構(鐵騎/顧問)；鐵騎不維護測試框架(QA)。⚠️防墮落：QA 不得變橡皮圖章，每批測試要展示鑑別力(壞版會紅)否則違反 11.2。

*v1.0，owner 表以 2026-09-04 實際 src 檔為準。作者：變身-leader（架構顧問），異靈核可。*
