# PRD：自然語言設計系統產生器

狀態：v0.3（2026-10-27）。第一個可用版本的範圍；之後依實際使用修改。下面的需求表多一欄「現況」，標出已實作（✅）、部分（🟡）與尚未實作（⬜）。範圍不因尚未實作而縮小。

## 一句話

在本機網頁介面（由 Claude Code 驅動）用自然語言或圖片描述想要的樣子，產生一套多品牌的 design token、設計準則、寫作規範與元件庫，在本機網頁介面中瀏覽，並一鍵發佈成 Storybook、版本控制在 GitHub。

## 使用者與驅動方式

- 使用者：不需要懂設計或程式的人，例如 PM、個人開發者、小團隊。
- 唯一驅動方式是 Claude Code。產品本身不帶模型，也不接 API 金鑰或本機模型；思考由使用者的 Claude 負責，用量算在使用者自己的 Claude 方案。
- 主要入口是本機網頁介面：在空資料夾執行一個指令（`npx -y github:jiashengchen610/Plinth`）就打開，整個流程（描述、審核、套用、檢查、發佈）都在裡面完成。網頁的對話框每送一則訊息，就由本機 server 以 headless 模式執行一次 Claude Code（`claude -p`），載入 Plinth plugin、只允許 Plinth 工具與唯讀檔案工具；同一個對話以 session id 續接，關掉重開也接得上。啟動指令會先檢查 git、Claude Code（是否登入）與 GitHub（是否連線、權限是否足夠），缺什麼就在終端機裡詢問後協助安裝或登入；GitHub 也可以之後在發佈視窗連線。之後整個流程都在網頁裡，不需要再操作終端機。
- 同一套東西也以 Claude Code plugin 形式發佈（skills、本機 MCP server、由 MCP server 啟動的同一個網頁介面），給想在終端機對話、用網頁審核的人；兩種方式可以對同一個資料夾混用。
- 介面只提供英文。

## 輸入

| 輸入 | 說明 | 第一版 | 現況 |
|---|---|---|---|
| 自然語言 | 在網頁或 Claude Code 對話中描述，例如 "A budgeting app for young professionals, warm and trustworthy" | 是 | ✅ |
| 圖片 | 貼進對話中的截圖、草圖、品牌素材 | 是 | ✅ |
| 應用情境 | Mobile app、SaaS dashboard、E-commerce、Marketing site；決定命名慣例、預設元件與檢查規則 | 是 | 🟡 記錄在 design-system.json、影響 Claude 的版面準則；命名、元件、檢查尚未依情境改變 |
| 參考檔案：DESIGN.md、DTCG 或 Tokens Studio 檔 | 直接解析，一次性匯入 | 是 | ⬜ |
| 參考檔案：GitHub repo、HTML、網址、PDF | 抽取數值後列給使用者確認，一次性匯入 | 第二版 | ⬜ |
| 修改指令 | 對既有結果繼續用自然語言或圖片要求修改 | 是 | ✅ |

## 輸出：使用者的 repo

使用者帶走的就是這個 repo。結構如下：

```
my-design-system/
├── tokens/
│   └── base.tokens.json          共用的基礎值：色階、間距尺度、字級尺度、圓角、動態
├── brands/
│   ├── acme/
│   │   ├── tokens.json           品牌的語意層 token，含 light 與 dark
│   │   ├── DESIGN.md             品牌風格、設計意圖、Do's and Don'ts
│   │   └── WRITING.md            （選用）覆寫共用寫作規範的品牌差異
│   └── acme-kids/ …
├── WRITING.md                    共用寫作規範：語氣、用詞表、介面文案規則
├── design-system.json            應用情境、命名慣例、元件底層、品牌清單、接受的例外
├── src/
│   ├── styles/tokens.css         由 token 產生，不手改
│   ├── styles/fonts.css          由字體 token 產生（Google Fonts 載入），不手改
│   ├── foundations/              Storybook 的 Introduction、Colors、Typography、Shape、Guidelines 頁面（由 Plinth 維護，直接讀 token 與準則檔）
│   └── components/<name>/
│       ├── <name>.tsx
│       ├── <name>.stories.tsx
│       └── <name>.spec.md        元件規格：組成、狀態、props、使用的 token、無障礙要求
├── exports/<brand>/DESIGN.md      發佈時產生：每個品牌一份完整、符合 Google 格式的 DESIGN.md
├── .storybook/                   含品牌與模式切換工具列
├── .github/workflows/storybook.yml   型別檢查與 story 測試通過後發佈到 GitHub Pages
└── CHANGELOG.md                  每次發佈自動追加（尚未實作）
```

各檔案的角色：

- **Token**（`*.tokens.json`）：DTCG 格式，是所有精確數值的唯一來源。分兩層：共用的基礎值，以及每個品牌自己的語意值。元件只引用語意值，所以同一套元件可以套用到任何品牌。
- **DESIGN.md**：遵循 Google 的 DESIGN.md 格式，讓其他 AI 工具也讀得懂。YAML 區塊由 token 自動產生，不手改；Markdown 部分寫品牌風格、設計意圖，以及 Do's and Don'ts 負面清單。
- **WRITING.md**：寫作規範。語氣固定，口吻依情境調整（例如錯誤訊息要比行銷文案沉穩）。內容包括用詞表、介面文案規則（按鈕用動詞、錯誤訊息說明原因與解法、句首大寫規則）和 Do's and Don'ts。
- **元件規格**（`<name>.spec.md`）：「先規格、後生成」的規格存檔，之後修改元件時以它為準。

## 命名慣例

Token 名稱預設跟隨使用者要做的產品類型，使用者可以覆寫。

| 應用情境 | 預設慣例 | 例子 |
|---|---|---|
| Mobile app（Android 風格） | Material 3 | `primary`、`on-primary`、`surface-container` |
| Mobile app（iOS 風格） | Apple HIG | `label`、`secondary-label`、`system-background`、`tint` |
| SaaS dashboard、E-commerce、Marketing site | shadcn | `primary`、`primary-foreground`、`muted` |

命名慣例存在 `design-system.json`。元件程式碼引用的工具類名稱，由 token 名稱自動產生。

現況：只實作 shadcn。Material 3 與 Apple HIG 需要對應的元件與檢查規則，尚未實作；建立時目前固定為 shadcn。

## 使用流程

1. 使用者在 Claude Code 描述想要的產品，可附圖片；Claude 開啟本機網頁介面。
2. 系統產生基礎 token、第一個品牌、DESIGN.md、WRITING.md 和一組基礎元件，介面顯示結果。
3. 使用者在對話中要求修改。修改以「舊值 → 新值」的待套用變更出現在介面上，按 Apply 才生效。
4. 使用者要求新元件。系統先產出規格，使用者確認後才生成；介面顯示可切換狀態的預覽。
5. 使用者要求新增品牌，例如 "Add a kids brand"。新品牌沿用同一套元件，只產生新的語意 token 與 DESIGN.md。
6. 使用者按 Publish：檢查通過後推到 GitHub、部署 Storybook、回傳兩個網址。

## 功能需求與驗收

| 編號 | 需求 | 驗收標準 | 第一版 | 現況 |
|---|---|---|---|---|
| F1 | 本機網頁介面 | 一個指令啟動（或由 plugin 的 MCP server 啟動）；英文；手機寬度到桌面都能使用；分頁：Tokens、Components、Guidelines、Changes、Checks、History，加上對話框與 Publish；依賴安裝、Storybook、測試、發佈的進度都在介面上 | 是 | ✅ |
| F2 | 生成 token | 合法 DTCG；含顏色、字體、間距、圓角、陰影、動態；light 與 dark；所有前景與背景對比達 WCAG AA，不達標時由程式自動修正 | 是 | 🟡 間距尺度沿用 Tailwind 預設，尚無 token；其餘已有 |
| F3 | 多品牌 | 一個 repo 可有多個品牌；所有元件在每個品牌、每種模式下都通過檢查；Storybook 可切換品牌與模式 | 是 | ✅ |
| F4 | 設計準則 | 每個品牌有 DESIGN.md，含風格說明與 Do's and Don'ts；負面清單預設包含常見的 AI 生成特徵，並盡量對應到自動檢查 | 是 | ✅ 能自動檢查的見 F10 |
| F5 | 寫作規範 | 產生 WRITING.md；元件中的範例文案與 story 內容遵守它 | 是 | 🟡 Claude 依 WRITING.md 寫文案；是否遵守沒有自動檢查 |
| F6 | 基礎元件 | 依應用情境產生；至少 Button、Input、Card、Badge、Label；只引用 token，沒有寫死的數值 | 是 | 🟡 五個元件與狀態色已有；尚未依情境變化；shadcn 原始元件豁免寫死數值檢查 |
| F7 | 瀏覽 | Tokens 分頁為樹狀檢視，含值、預覽、對比結果、被哪些元件使用；Components 分頁以真實元件渲染，可切換變體、狀態、品牌、模式；Guidelines 分頁顯示 DESIGN.md 與 WRITING.md | 是 | 🟡「被哪些元件使用」尚未實作；其餘已有 |
| F8 | 用 AI 修改 | 支援改值、新增、改名、重組群組、修改準則；變更先以待套用形式呈現；改名時自動更新引用它的元件 | 是 | ✅ 改名同時改寫 token alias 與元件的 class |
| F9 | 用 AI 生成元件 | 分四級：現成、組合、標準行為模式、全新；一律先出規格並存成 spec.md，確認後才生成；做不到時說明缺什麼 | 第 1 到 3 級是，第 4 級第二版 | ✅ 第 1 到 3 級 |
| F10 | 品質門檻 | 擋發佈的三項（客觀可驗）：token 一致性、WCAG 對比、元件無寫死數值；每次變更都檢查，提案時先預覽變更後的結果。發佈前本機再跑型別檢查與每個 story 的互動與無障礙測試；GitHub Actions 部署前再跑一次，不過不部署。「兩個語意色看起來一樣」只是提醒，不擋；使用者可標記為刻意 | 是 | ✅ |
| F11 | 發佈 | 一個動作完成：推到 GitHub（PR 或直接推送）、透過 GitHub Actions 部署到 GitHub Pages、回傳 Storybook 與 GitHub 兩個網址 | 是 | 🟡 直接推送、Pages、兩個網址已有；PR 發佈尚未實作；真實發佈只測過 dry run |
| F12 | 版本與復原 | 每次套用變更，都在本機 repo 產生一個 commit；介面可回到任一先前版本；發佈即推送這些 commit | 是 | ✅ |
| F13 | MCP 工具 | 工具涵蓋讀取、提出變更、套用、生成元件、執行檢查、執行測試、截圖預覽、發佈；Claude 只拿到工具回傳的資料 | 是（截圖預覽第二版） | 🟡 截圖預覽尚未實作；其餘已有 |
| F14 | 資料連動 | 改 token 時：CSS 與字體載入自動重生；改名自動改寫 token alias 與元件 class；提案預覽列出 DESIGN.md 中仍描述舊色相的句子，讓同一次變更一併改寫 | 是 | ✅ |

## 失敗情境

| 情況 | 使用者看到什麼 | 系統怎麼處理 |
|---|---|---|
| 生成到一半失敗 | 對話框顯示停在哪一步與原因 | 已完成的部分保留在最後一個 commit；可從該步重試 |
| 檢查沒通過 | Publish 按鈕停用，列出沒過的項目與所在品牌、模式 | 能由程式修的（例如對比）提供 Fix 按鈕；其餘交給 Claude 修 |
| 推上去了但 Actions 的測試沒過 | 顯示 GitHub 網址與失敗的測試 | Storybook 維持上一個成功版本；修好再發佈 |
| 改壞了 | 版本紀錄列出每一次變更 | 一個動作回到任一先前版本 |
| GitHub 沒登入或授權過期 | 發佈視窗顯示 Connect GitHub | 按下後顯示一次性代碼並開啟 GitHub 授權頁，使用者在瀏覽器授權即可，不需要終端機；本機的工作不受影響 |
| 免費方案選了 private | 發佈視窗說明 Pages 不支援，停用發佈按鈕 | 改選 public，或升級 GitHub 方案 |
| 只發佈成功一半（推上去了但 Pages 部署失敗） | 顯示 GitHub 網址與部署失敗的原因 | 提供 Retry deploy，不重複推送（尚未實作：目前再按一次 Publish） |
| Claude 提出的變更違反準則 | 變更旁標示違反哪一條 | 使用者可以退回，或明確選擇接受並記錄例外（存在 design-system.json，發佈時列出） |
| 沒安裝或沒登入 Claude Code | 對話框顯示安裝與登入步驟 | 介面其他功能（瀏覽、Apply、Checks、Publish）照常 |

## 資料邊界

工具、使用者資料、模型上下文三者分開，互不混用。

| 區域 | 內容 | 可見範圍 |
|---|---|---|
| 工具 | 介面程式碼、確定性引擎、預覽伺服器、MCP server | 只有產品開發者 |
| 使用者資料 | 上面「使用者的 repo」裡的所有檔案，以及使用者的輸入 | 使用者；推送到使用者的 GitHub repo |
| 模型上下文 | 本次輸入、相關的 token、元件清單（名稱、props、可用值）、相關的準則與規格 | 使用者的 Claude |

- 模型上下文只從使用者資料取材，且只取當下任務需要的部分；工具程式碼永遠不進入模型上下文。
- 使用者的 repo 只含使用者資料，不含工具程式碼。
- 使用者的元件只在隔離的預覽環境（iframe）中渲染，不和工具介面共用 CSS 或 JavaScript。

## 原則

- Token 是唯一的設計事實來源；元件只引用語意 token。
- 模型提案，程式驗證並修正：能用程式確定性算出或檢查的，不交給模型猜。
- 所有變更先呈現、後套用；每次套用都是一個可復原的 commit。
- 負面清單要短、要具體、盡量能自動檢查；冗長的「不要做」清單會被 agent 略過。
- 使用者看得到、改得到所有產出，沒有黑箱格式。
- 參考來源的風格可以借用，商標與品牌識別不複製。

## 成功標準

- 一個不懂設計的人，從第一句描述到拿到已發佈的 Storybook 網址，在 30 分鐘內完成。
- 已發佈的元件 100% 通過品質門檻，在每個品牌與模式下都沒有寫死的數值、沒有對比不足。
- 任何變更都能在一個動作內復原。

## 授權

使用者產出的 token、準則、元件與 stories 歸使用者所有。元件以 shadcn/ui（MIT）為基礎。

## 不在這個專案範圍內

- 本機模型、API 金鑰，或 Claude Code 以外的驅動方式。
- 把 Storybook 或元件匯入 Figma。
- 與 Figma 或既有程式碼保持同步，或把結果寫回來源。
- 導入既有的設計系統或既有專案。
- 多人即時協作、權限管理。
- 非 React 框架；非英文介面。

## 試行中的決定

以下先照這樣做，實際用過後再調整。

1. **DESIGN.md 分兩層撰寫、合併輸出。** 根目錄的 `DESIGN.md` 寫所有品牌共用的部分（版面、元件、共用的 Do's and Don'ts）；`brands/<brand>/DESIGN.md` 只寫該品牌的風格與差異。發佈時由程式把兩者與 token 合併，為每個品牌輸出一份完整、符合 Google 格式的 `DESIGN.md`，供其他 AI 工具使用。撰寫時不重複，輸出時又完整。
2. **元件底層一律先用 Radix。** 和 shadcn 預設相同，第一版最省事。Mobile app 情境要不要換 React Aria，等實際生成過行動 App 的元件再決定。
3. **預設負面清單分兩種。** 能自動檢查的（寫死的數值、對比不足、觸控目標太小、所有元件同一種圓角與陰影）做成檢查程式；不能自動檢查的（標題只強調一個字、每段都加大寫小標、沒有意義的編號）寫進 DESIGN.md 的 Don'ts，並限制在 10 條以內。
4. **字體走 Google Fonts。** 字體 token 寫家族名稱，引擎生成 `src/styles/fonts.css` 的 `@import`；零安裝，代價是執行時連 Google。自託管（fontsource）等有人需要離線再做。
5. **狀態色進 template。** `success`、`warning`、`info`（各含 `-foreground`）跟 shadcn 原有的角色一起出貨，Badge 有對應 variant，避免第一個元件就撞到 token gap。
6. **對話用 headless Claude Code，不用 channels。** channels 是研究預覽、要旗標、沒驗證過；`claude -p` 是穩定介面，可以在這裡端到端測。代價：網頁對話和終端機對話是兩個 session。

## 非功能需求

先不定義，實際試用後再補。
