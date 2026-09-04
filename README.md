# 變身大亂鬥 H5

《變身大亂鬥》的 H5 重寫版本 — 由原 Unity 專案改用 **Phaser 3 + TypeScript + Vite** 開發。

一款兒童街機抽獎／兌換機的 2D 動作遊戲。本 repo 目前為 **階段 0：專案骨架**，只有一個空場景，尚未實作任何玩法。

## 技術版本

| 項目       | 版本      |
| ---------- | --------- |
| Phaser     | ^3.90.0   |
| TypeScript | ^5.6.3    |
| Vite       | ^6.0.3    |
| Node       | v22 (建議) |

## 執行指令

```bash
npm install      # 安裝相依套件
npm run dev      # 開發伺服器（預設 http://localhost:5173）
npm run build    # 型別檢查 + 產出 dist/
npm run preview  # 預覽 build 產物
npm run typecheck # 只跑 tsc 型別檢查
```

## 目錄結構

```
.
├── index.html            # HTML 進入點（掛載 #game 容器）
├── vite.config.ts        # Vite 設定（含 @ → src 別名）
├── tsconfig.json         # TypeScript 設定（strict 全開）
├── public/
│   └── assets/           # 靜態資源（原樣複製到 dist）
│       ├── images/       # 美術（PNG）— 從 Unity 搬
│       ├── audio/        # 音效／音樂 — 從 Unity 搬
│       └── data/         # 數值／設定 JSON — 從 Unity 搬
└── src/
    ├── main.ts           # 遊戲進入點（建立 Phaser.Game）
    ├── config/           # 全域設定常數（解析度、顏色…）
    ├── scenes/           # Phaser 場景（BootScene、遊戲場景…）
    ├── systems/          # 遊戲系統邏輯（抽獎/計分/狀態機…），與場景解耦
    └── entities/         # 遊戲實體（玩家/敵人/道具…），包裝 GameObjects
```

## 目錄慣例

- **`scenes/`** — 一個 Phaser.Scene 一個檔，命名 `XxxScene.ts`。負責畫面組裝與輸入，邏輯盡量委派給 `systems/`。
- **`systems/`** — 純邏輯層，盡量不直接依賴 Phaser API，方便單元測試與從 Unity 對照搬移。
- **`entities/`** — 遊戲物件類別，封裝該實體的資料與行為。
- **`config/`** — 常數與設定集中管理，避免魔術數字散落。
- **`public/assets/`** — 美術/音效/JSON 直接放這裡；程式用 Phaser loader 或相對路徑載入。

## 匯入別名

`@/` 對應到 `src/`，例如 `import { BootScene } from '@/scenes/BootScene';`（已在 `tsconfig.json` 與 `vite.config.ts` 設定）。

## 設計解析度

目前設 `1920 x 1080`（橫式），使用 `Phaser.Scale.FIT` + `CENTER_BOTH` 自動縮放置中。可於 `src/config/gameConfig.ts` 調整。

## 自動部署（GitHub Pages）

已設定 `.github/workflows/deploy.yml`：push 到 `main` → `npm ci` + `npm run build` → 自動把 `dist/` 發佈到 GitHub Pages，拿到固定連結。

- Vite `base` 設為 `'./'`（相對路徑），因此不論 repo 名或 Pages 子路徑（`https://<帳號>.github.io/<repo>/`）都能正確載入資源，不用硬寫 repo 名。
- repo 建立後，需在 GitHub repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**（只需設定一次）。
