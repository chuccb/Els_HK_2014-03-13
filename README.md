# Els_HK_2014-03-13 — 艾爾之光香港版（2014-03-13）網頁復原

目標：以 **TypeScript + Bun + WebGPU** 重新實作 `data/x2.exe`（艾爾之光 HK 客戶端）的行為，讓原版 KOM 資產與 Lua 腳本**不經修改**地執行。
行為以 `data/x2.exe` 的 IDA 匯出（`data/x2.exe.c`、`data/x2.exe.h`）為準，並用原生 LuaJIT 2.0.2 當 oracle 做差異驗證。

已確認的範圍決策：

| 項目 | 決定 |
|---|---|
| 架構 | **hybrid**：C++ 引擎用 TypeScript 重寫；寫在客戶端 Lua 腳本裡的遊戲邏輯直接執行；伺服器是全新的 Bun 實作 |
| 交付方式 | **垂直切片**：開機 → 登入 → 角色選擇，再加一個場景/副本 |
| 伺服器資料庫 | `bun:sqlite` |
| 忠實度 | **faithful**：重現 exe 的行為（以反編譯結果驗證），不做「更合理」的修正 |

## 目前進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| 1a | `@els/kom`：KOM 封存檔讀取（173 個檔、97,891 個項目，大小與 Adler-32 全數正確） | 完成 |
| 1a | `@els/lua`：LuaJIT 2.0.2 位元碼載入器 + 直譯器 + 標準函式庫 | 部分完成（見下） |
| 1b | Lua 載入器與文字設定檔。**更正**：x2.exe 沒有 Lua 原始碼編譯器（`lj_parse` 未連結，`cpparser` 對任何非位元碼的內容直接丟出 `cannot load malformed bytecode`），所以不做編譯器；改為 ① `loadChunk`／`luaL_loadfilex(iEncoding)`／`dofile_UTF8` 與 exe 一致；② 移植 KOG 自製的文字設定檔直譯器 `KLuaManagerProxy`（`GameOption*.txt`、伺服器群組檔、教學系統檔、控制台指令） | 完成（`KLuaManagerProxy` 沒有原生 oracle，只能以反組譯碼手算驗證） |
| 2 | 資產解碼器（TGA/DDS/X/Y/XET/TET/粒子腳本/KIM/ESS/MPEG-1） | **完成（解碼端）**：圖片（TGA/DDS/BMP/PNG）、XET/TET、字串表（ESS）、物品資料庫（KIM）、X 檔容器（MSZIP）與通用 X 讀取器、KME/KSM/KAC、粒子與 XMeshPlayer 腳本（解析端，37 個檔案、13,882 個區塊與獨立讀取器逐欄位一致）、**AVI + MPEG-1 影片**（30 個 `data/movie/*.avi`、18,514 張畫面與 FFmpeg 逐取樣點完全相同）都已完成並以全部資產驗證；粒子／XMeshPlayer 執行期與播放影片的 Bandi 式播放器需要繪圖，留給後續階段（`CMovieData` 的腳本端——檔名與 render target——已在階段 4 移植，播放本身尚無播放器）；網格語意由階段 3 的 D3DX 實作承接 |
| 3 | WebGPU 的 D3D9 相容層（`packages/d3d9`） | **進行中，核心已完成**：`IDirect3DDevice9`（固定管線、全部狀態、貼圖格式、render target、可程式化的頂點階段）、D3DX 數學／貼圖／網格／骨架／動畫／影格階層載入器、`XRenderer.fx` 的 effect 模擬（19 個 technique、80 個 `vs_1_1` 著色器 → WGSL）；153 個測試在 Dawn + SwiftShader 上執行（`docs/img/d3d9-demo.png`）。引擎載入器已移植（`packages/engine`：`CKTDXDeviceXSkinMesh` 的影格清單與 KSM／KAC 載入器、`CKTDXDeviceXMesh` 的 KME／X 載入器、KAC 的 `OptimizeKeys`——**與 exe 逐位元相同**，見下）；`CKTDGXRenderer`／`CKTDGEffectStateManager` 尚未移植，也沒有真正的 D3D9／D3DX 可比對（假設列在 `docs/FINDINGS.md` 12.5） |
| 3＋ | **瀏覽器實測**（`apps/client` + `apps/server` + `tools/browser-test.ts`） | **完成（作為測試台）**：無頭 Chromium 153 + WebGPU（SwiftShader）可在沙箱執行；整個流程（HTTP Range 掛載 KOM → 解碼 → D3D9 層 → WebGPU canvas）有 22 項自動檢查：TGA 與 MPEG-1 畫面與 Bun 端解碼逐像素相同、蒙皮動畫網格會隨動畫時間改變、RGBA 與 BGRA 後緩衝逐像素相同（桌機瀏覽器偏好 BGRA）。**這證明瀏覽器端與 Bun 端一致，不證明畫面等同原版**（沒有參考截圖）；艾爾索德等角色（KSM + KAC）與 109 個 KME 靜態網格已能繪製並播放動畫 |
| 4 | UI 框架（`DLG_*.lua`，`packages/ui`） | **進行中，腳本端完成；Static／Button／RadioButton 的圖片、邊框與字串，ComboBox 的按鈕、文字框、選取的文字與下拉清單，ListBox 的外框、各列的反白與字串、群組列的加減號與捲軸，Slot 的圖片、附加圖片、邊框與字串（含被拖曳的那一格），CheckBox／Slider／Navigation／ControlList 的圖片與邊框已能經 `@els/d3d9` 畫出，畫格更新（`OnFrameMove`）已移植**：`CKTDGUIDialog` 與全部控制項（Static、Button、RadioButton、CheckBox、Slot、IME／一般 EditBox、ComboBox、ListBox、ScrollBar、Navigation、Slider、ControlList、`CMovieData`）、slot 管理器與擁有對話框的類別（`CX2PostBox`、`CX2CouponBox`、`CX2MapSelectWindow`）、字型管理器——`docs/UI_COVERAGE.md` 列的 22 個類別、**346 個已註冊的方法全部實作**（表中另列 `CX2Main`：註冊 46 個，只實作文字路徑要用的 `InstallFont`），註冊在 host binder 上，原版 `DLG_*.lua` 不經修改地執行。普查（`tools/ui-census.ts`）：1,024 支 DLG 腳本中有 992 支能在 host 層跑到結尾，**這 992 支全部完整移植，並在嚴格模式（註冊了卻沒人移植的方法就是錯誤）下無錯誤執行**；其餘 32 支屬於遊戲狀態（村莊／區域／世界地圖、商店、錄影、防禦副本獎勵），需要該狀態啟動時放進 Lua 的表或物件。754 個 UI 測試（含 host 共 789 個；另有 27 個要 GPU 的繪圖測試：23 個對話框、1 個拖曳中的 Slot、3 個文字）、保證普查數字不會倒退的測試，以及 99 個變異的檢查（97 個被測試抓到，2 個等價；`python3 tools/mutate-ui.py`），繪圖部分（含字串、ComboBox、ListBox 與 Slot）另有 960 個變異（944 個被抓到，16 個等價；`python3 tools/mutate-draw.py`），`OnFrameMove` 另有 440 個變異（434 個被抓到，6 個等價；`python3 tools/mutate-framemove.py`）。UI 沒有 exe oracle，行為來自反編譯，靠嚴格執行真腳本、單元測試與變異測試把關（`docs/FINDINGS.md` 17）。**已畫出**：`CKTDGUIDialog::OnFrameRender`、Static／Button／RadioButton／CheckBox／Slider／Navigation／ControlList（含 ScrollBar）的圖片，以及 `DrawEdge` 的邊框（`CKTDXDeviceTexture::Draw`）、Static／Button／RadioButton 的字串（`packages/ui/src/stringdraw.ts`，`docs/FINDINGS.md` 17.13；文字路徑見下一列）、ComboBox 的 `OnFrameRender`／`OnFrameRenderEnd`（`docs/FINDINGS.md` 17.14）、ListBox 的 `OnFrameRender`（17.15；它第一次讀滑鼠：`UIMouse`）、Slot 的 `OnFrameRender`／`DrawEdge`／`UpdateDraggingVertex`／`RenderDragSlot`（17.16；被拖曳的那一格畫在滑鼠位置，由對話框管理器在所有對話框之後呼叫，測試用 `drawDialog` 的 `after` hook 模擬）（`UIWorld({ device })`，狀態經 `CKTDGStateManager`、頂點經動態頂點緩衝區管理器，最後由 `Direct3DDevice9` 畫在 WebGPU；`packages/ui/test-gpu`：23 個真實對話框，每個 draw call 都依 Direct3D 9 的規則（含剔除與 alpha test）在 CPU 上重畫一遍，與裝置畫出的圖最多差 1 階）。普查：992 個對話框中有 911 個只含已能畫圖片的控制項類別，其餘含 IMEEditBox 或 EditBox。**畫格更新**（`OnFrameMove`，`docs/FINDINGS.md` 17.10）：控制項基底的 `Animate`／`ChangePoint`／`UpdateTexChangeData`、`CPictureData`（閃爍、抖動、淡入淡出）、13 個控制項類別各自的 `OnFrameMove`、`CKTDGUIDialog::OnFrameMove`／`SetShow(false)`、對話框管理器的 `CheckDlg`／`CheckFrontModalDlg`／`CountModalDialog`、鍵盤的 `GetKeyState`，`packages/ui/test/framemove.test.ts` 99 個測試，期望值都由反編譯手算。**繪圖普查**（`tools/ui-draw.ts` → `docs/UI_DRAW.md`、`docs/ui-draw.tsv`）：1,024 支 DLG 腳本在同一個 Lua 狀態與同一個 UI 世界裡逐一開啟、先跑一個沒有經過時間的畫格（`OnFrameMove(0, 0)`：沒有東西會動，但等著第一次 `ChangeState` 的控制項會做完它；RadioButton 的圖要靠這一步才有）、再畫在 1024 × 768 的後緩衝，**全部 1,024 個都畫完而沒有例外，裝置畫出的圖與 CPU 參考實作全部一致**（每個頻道最多差 1 階，容許值 3；共 16,738 個四邊形，外加字串的 26,982 個字形四邊形〔284 個對話框的 1,937 個字串，分成 3,874 次繪製：每個字串先畫外框再畫本體〕），其中 902 個至少畫出一個四邊形或字串（只算四邊形是 897 個；RadioButton 的圖要等第一個畫格才有，牽涉 17 個對話框），其餘 122 個什麼都不畫的對話框逐一歸類（腳本沒建立控制項 50、沒有控制項顯示 40、顯示的控制項沒有圖片也沒有文字 21、腳本沒跑 11）；7 個對話框的第一個畫格停在尚未移植的 `ShowGuideDesc`（RadioButton 由 MOUSEOVER 回到 NORMAL 後會向對話框要提示文字）。畫圖時由一張圖找到遊戲的繪圖狀態基線（`CKTDGManager::OnResetDevice` 設的 `akStates`：SRCALPHA／INVSRCALPHA、alpha test 開啟、取樣器 0 線性過濾…；Button 不推任何混合狀態，全靠這個基線，用 Direct3D 預設的 ONE／ZERO 時按鈕的透明部分會變成灰色方塊）。**尚未移植**：控制項的輸入（`MsgProc`／`HandleMouse`、Button 的 Enter、`SetShow(true)`）、`ShowGuideDesc`、對話框管理器的對話框清單與圖層、其餘繪製（EditBox／IMEEditBox 的 `OnFrameRender`，含它們的字串；影片）、IME 輸入、影片播放 |
| 4＋ | FreeType 2.4.11 的 TypeScript 移植（`packages/freetype`；階段 4 文字路徑的第一步） | **完成，與 exe 自己的 FreeType 逐位元相同**：x2.exe 靜態連結 FreeType（`FT_New_Library` 回報 2.4.11；沒有 `FT_LONG64`；自動微調器對它的 5 個字型永遠不會跑），文字的每個像素都由它的 TrueType 位元碼直譯器與平滑光柵器決定。移植的範圍：`FT_New_Memory_Face`、cmap 格式 4／6／12、`FT_Set_Char_Size`（含 Gulim 內嵌點陣尺寸的比對）、`TT_Load_Glyph`（簡單與複合字形）、**119 個指令的 TrueType 直譯器**、`FT_Render_Glyph` 的平滑光柵器（`ftgrays.c`）、`FT_Bitmap_Copy`／`FT_Bitmap_Embolden`。**驗證（規則 3b：exe 的機器碼就是答案）**：`tools/oracle-freetype.py` 在 Unicorn 模擬器上執行 exe 自己的 FreeType，`tools/verify-freetype.ts` 逐數字比對 9 個字型面——U+0 到 U+2FFFF 共 2,162,688 個字元碼的字形索引、UI 字型在 13／15／17 px（另有 8…48 px 的 21 種大小）的載入與轉成點陣（未微調與微調）、1,440 個合成輪廓、4,680 個加粗點陣、7 種整數運算各 4,000 筆：**全部 0 差異**；另有 3 個產生的字型（隨機的位元碼程式涵蓋**全部 119 個指令**——真實字型只用到 80 個——、複合字形的每個旗標、`INSTCTRL`、單色／灰階切換，依 exe 載入的順序）共 15,885 次載入，同樣 0 差異。204 個測試（`oracle.test.ts` 重播 976 KB 的 fixture，不需要 Python；其餘的期望值由 2.4.11 的 C 原文手算）；變異測試 376 個變異（`python3 tools/mutate-freetype.py`，約 22 分鐘）：358 個被抓到，18 個存活，各有理由（7 個等價、11 個 exe 的呼叫不可能走到）；`docs/FINDINGS.md` 17.11。exe 的 `CKTDGFreeTypeFont` 在下一列 |
| 4＋ | 文字路徑：字形字型、頁面貼圖與字型管理器（`packages/ui`：`CKTDGFreeTypeFont`、`CKTDGDynamicTexture`、`CUKFont`、`CKTDGFontManager`、`CX2Main::InstallFont`） | **進行中：字型這一側完成並已能畫出圖；Static、Button、RadioButton、ComboBox、ListBox、Slot 已用它畫字串，其餘用字串的控制項尚未移植**。已移植：`CKTDGFreeTypeFont` 全部 15 個函式（`Load`、字形快取與 LRU 淘汰、`CharToSystemTexture`、`Buffering`、`Flush`、`OutTextXY`、`OutTextMultiline`、量測、裝置遺失／重設、`UnLoad`）、`CKTDGDynamicTexture` 全部 7 個、`CUKFont` 15 個中的 9 個、`CKTDGFontManager` 9 個中的 8 個（`InstallFont`、`GetFontMemory`、`OnLostDevice`／`OnResetDevice`、解構式）與 `CX2Main::InstallFont`；**C++ 的解構式一律寫成 `Destroy()`**（`docs/PORTING_RULES.md` 2c）。字型在建立時就載入（`CUKFont` 的建構式直接呼叫 `Load`；7 個 UK 字型約 0.3 秒）。**exe 的錯誤照樣保留**：7 個字型中有 4 個（儲存格 19、27、37）的快取格數比四張頁面放得下的多（689／676、333／324、162／144），這些字型的第 677／325／145 個不同字元會讓 exe 當掉（移植版丟出錯誤）。**驗證**：新增 175 個單元測試（`freetypefont.test.ts` 139、`dynamictexture.test.ts` 22、`fontmanager.test.ts` 14，期望值由反編譯手算並以 Python 核對）；`python3 tools/mutate-font.py` 662 個變異（文字路徑、快取與雜湊表、四邊形、對齊與顏色碼、頁面、字型管理器、裝置生命週期），621 個被抓到，41 個存活且各有理由。**畫面**（`packages/ui/test-gpu/text-draw.test.ts`，3 個測試，需要 GPU）：7 個真實字型畫出拉丁、繁體中文與韓文（字面來自 `DFT_P7`、`GULIM`；`docs/img/ui-text-fonts.png`）、多行文字、顏色碼、置中與靠右、縮放（`docs/img/ui-text-multiline.png`），以及「字形格在場景進行到一半時被別的字元接手」；每張圖都與依 Direct3D 9 規則在 CPU 上重畫的結果一致（字形頁面在每次繪製的當下複製，因為它在同一個場景的兩次繪製之間會改變；關掉 `@els/d3d9` 的貼圖更名後第三個測試就會失敗）。**第一批用它的控制項**（`packages/ui/src/stringdraw.ts`，`docs/FINDINGS.md` 17.13）：Static、Button、RadioButton 在圖片之後畫字串——UK 字型取自 `m_mapUKFontList[fontIndex]`（沒有這個字型就是 exe 當掉的地方，移植版丟出錯誤）、顏色是（對話框 × 字串）× 控制項的各頻道浮點乘積、位置是（對話框位置 + 字串位置）+ 控制項偏移再取整，呼叫 `OutTextMultiline(x, y, 文字, 顏色, fontStyle, 外框色, 1.0, null, sortFlag, -1, 1.0, 1.0)`（不用 UK 字型的 Static 字串走字型對照表與 `Draw2DText`，會展開的字串只畫前 `iSpreadCount` 個字元）；**ComboBox**（17.14）用同一個呼叫畫選取的那一列與下拉清單的各列（位置改成列的角落，選取的文字依 `m_iTextLimit` 截短）；**ListBox**（17.15）用同一個呼叫畫每一列（位置是列的角落再加縮排；NOT_ENABLE 列的 alpha 減半、自訂顏色的列、逐字展開的列；群組列改用群組字型並先畫加減號圖示；行距是 0.8 而不是 1.0）；**Slot**（17.16）用同一個呼叫把整段訊息交給 UK 字型（不看 `USE_UK_FONT`、不展開，空字串也照樣呼叫一次；沒有字串資料就不畫字，這不是錯誤）；29 個單元測試（期望值由反編譯手算，浮點數以 Python 的 float32 核對）、23 個 GPU 對話框驗證字型被要求畫的字串與腳本一致且畫面與 CPU 重畫一致，繪圖普查把 1,024 個對話框的 1,937 個字串畫在同一個世界裡（26,982 個字形四邊形，全部與 CPU 一致；字形快取在每個對話框之後清空，否則 exe 的第五頁錯誤會先發生）。**尚未移植**：`CUKFont` 的另外 6 個函式（`DrawTextFont`、`DrawFontStyle`、`Push2DText`…）、`CKTDGFontManager::OnFrameMove`，以及其餘用字串畫圖的控制項（EditBox、IMEEditBox）；`docs/FINDINGS.md` 17.12 |
| 5 | `lua_tinker` 等價的 host API（`packages/host`） | **進行中，基礎完成**：binder（照反編譯讀出的 `lua_tinker` 語意：類別表當 metatable、`meta_get`／`meta_set`、`__parent`、`read<T>`／`push<T>`、原版的錯誤訊息）、由 `docs/host_api.tsv` 產生的型別化 API（128 個類別、1,418 個方法）、`KLuaManager`、`HostWorld`（`IncludeLua`、`LoadLuaEnum` 的腳本）、第一個真實的 host 類別 `KGCMassFileManager`。全部 4,498 支腳本在型別化 stub 上跑一遍（`docs/HOST_CENSUS.md`）：4,422 支跑到結尾，其餘 76 支需要 23 個連 `x2.exe` 字串表都沒有的名稱。UI 類別（階段 4）與 `KGCMassFileManager` 已移植：4,422 支腳本呼叫的 440 個方法中 263 個已實作，剩下 177 個分屬 42 個類別（`CX2World` 19、`CX2ItemManager` 14、`CX2WorldObjectSkinMesh` 12、`CX2Main` 12、`CKTDGSkyDome` 11⋯），一次移植一個管理器 |
| 6 | 開機／登入／角色選擇 + `apps/server` | 未開始 |

![資產檢視器：Sonogong 寵物（`Motion_PET_SONOGONG_STEB_1.X`，蒙皮動畫「Walk」）由原版 KOM 資產經 D3D9 層畫在 WebGPU canvas（無頭 Chromium + SwiftShader 截圖）](docs/img/web-viewer-pet.png)

![資產檢視器：艾爾索德（`Motion_Elsword.x`，KSM 骨架 + KAC 動畫「Walk」，0.2 秒；key 經 `OptimizeKeys`）](docs/img/web-viewer-elsword-walk.png)

![資產檢視器：KME 靜態網格 `Elder_Village_bigsang.Y`（693 個頂點、30 個子集、9 張貼圖）](docs/img/web-viewer-kme.png)

![UI：原版 `DLG_UI_EVENT_BINGO_MAIN.LUA` 不經修改地跑在 Lua VM 上，建出移植的 `CKTDGUIDialog`／Static／Button，再經 `CKTDGStateManager`、動態頂點緩衝區與 `Direct3DDevice9`（WebGPU，SwiftShader）畫在 1024×768 的後緩衝區（75 個四邊形；右下角的 PUSH 按鈕與兩個圖示按鈕的透明邊緣正確；韓文標題與說明字寫在貼圖裡，小方框旁的七個「物理」標籤是 UK 字型畫的字串〔14 次繪製、28 個字形四邊形〕）](docs/img/ui-DLG_UI_EVENT_BINGO_MAIN.png)

![UI：`DLG_UI_PARTYLIST.LUA`（隊伍清單，146 個四邊形與 22 個字串〔332 個字形四邊形〕：12 個副本名稱、9 個隊伍名稱與底部的說明，都是 Static 的字串，由 `CUKFont::OutTextMultiline` 用 `DFT_P7` 字型畫出，每個字帶外框；標題、表頭與按鈕上的字寫在貼圖裡；與 CPU 重畫的結果最多差 1 階）](docs/img/ui-DLG_UI_PARTYLIST.png)

![UI：`DLG_MAP_SELECT_WINDOW.LUA`（49 個四邊形；與 CPU 上依 Direct3D 9 規則重畫的結果最多差 1 階）](docs/img/ui-DLG_MAP_SELECT_WINDOW.png)

![UI：`DLG_COMMAND_SKILL.LUA`（技能視窗，跑過一個 `OnFrameMove` 畫格後共 19 個四邊形〔其中 1 個沒有面積〕，含 5 個 RadioButton〔一個已選取；頁籤 JUMP／DASH／DASH JUMP 的圖要等第一個畫格把它們從 MOUSEOVER 換到 NORMAL 才有〕、不透明度 Slider〔範圍 50–255、值 255，所以滑塊在最右〕、兩個按鈕與 Static；標題與按鈕上的字寫在貼圖裡，沒有任何未畫出的項目；與 CPU 重畫的結果最多差 1 階）](docs/img/ui-DLG_COMMAND_SKILL.png)

![UI：`DLG_CASH_SHOP_POPUP_BUY_HK.LUA`（購買道具視窗，25 個四邊形；清單標題列左側的「全部選擇」核取方塊是已勾選的 CheckBox；文字都寫在貼圖裡，沒有未畫出的項目；與 CPU 重畫的結果最多差 1 階）](docs/img/ui-DLG_CASH_SHOP_POPUP_BUY_HK.png)

![UI：`DLG_UI_OPTION_CAM_EX.LUA`（使用者選項設定，39 個四邊形與 11 個字串〔62 個字形四邊形〕；四個 ComboBox 各畫出灰色的文字框與右側的箭頭按鈕，下拉清單是關著的所以沒有畫，其餘是 Static、RadioButton 與 Button；與 CPU 重畫的結果最多差 1 階）](docs/img/ui-DLG_UI_OPTION_CAM_EX.png)

![UI：`DLG_MESSENGER_WINDOW.LUA`（訊息視窗；ListBox 的列是測試放進去的：「Friends (3)」群組列〔黃色減號〕與三位好友——被選取的 Aisha 有深色底、NOT_ENABLE 的 Rena 變暗、自訂紅色的 Raven——接著是「Guild (12)」群組列〔綠色加號〕與 40 列公會成員，右側是 ListBox 自己的捲軸與滑塊；輸入框的文字尚未移植；每個 draw call 都在 CPU 上重畫，與裝置畫出的圖全部相符〔容許值 3〕）](docs/img/ui-DLG_MESSENGER_WINDOW.png)

![UI：`DLG_UI_KEY_SETTING.LUA`（按鍵設定，182 個四邊形：142 個 Slot 畫出鍵盤上各按鍵位置與下方面板裡的灰色方格，其餘是 Static 與 21 個 Button；對話框下方的灰色方塊是第一個鍵被拖曳到滑鼠位置 (600, 600) 的樣子：`RenderDragSlot` 以滑鼠為中心畫出 35 × 35 的圖，角落 581.5 與 616.5；與 CPU 重畫的結果完全相同，每個色版都差 0）](docs/img/ui-DLG_UI_KEY_SETTING-drag.png)

![UI：`DLG_GAME_SKILL_SLOT_NEW.LUA`（技能快捷列的 8 個 Slot；前四格有鎖頭圖示；數字 1 到 8 是測試替每個 Slot 放進去的字串資料〔字型 0、描邊〕，畫在圖片的右下角；與 CPU 重畫的結果完全相同，每個色版都差 0）](docs/img/ui-DLG_GAME_SKILL_SLOT_NEW.png)

### Lua VM 的驗證結果（誠實版）

* 位元碼載入器與反組譯器：4,498 個腳本、26,565 個函式原型，與 oracle 的 `jit.bc` 輸出逐行相同。
* 15 個差異測試（`tests/lua/`：t01–t09 手寫、t10–t14 模糊測試、t15 載入器）：全數與原生 LuaJIT 輸出相同。
* **stub 環境全腳本差異測試**（`tools/corpus-diff.sh`）：4,498 個遊戲腳本 × 3 種 stub 回傳模式，原生 LuaJIT 與 TS VM 的記錄逐位元組相同。這個測試找出並修掉 3 個 VM 錯誤（`%q`、比較運算的運算元順序、NaN 比較）。
* **這只證明 VM 與標準函式庫在這些腳本的載入期行為上正確**；真正的引擎物件、長時間執行、GC 等不在其中。

已知缺口（也記錄於 `docs/FINDINGS.md` 第 4 節）：metamethod 內的 `yield` 不支援；`setfenv(0, t)` 為 no-op；`collectgarbage('step')` 恆回傳 false；weak table 與 `__gc` 不支援；`load/loadstring/loadfile/dofile` 只接受位元碼（exe 本身沒有原始碼編譯器，文字一律回傳 `cannot load malformed bytecode`）；`debug/io/os/package` 為近似實作；`pow/exp/log/三角函數` 使用 V8 的 libm，與 exe 的 CRT/x87 最後一位可能不同；`tostring(table)`／`%p` 的位址不可能與 exe 相同。

### Phase 2（資產）的驗證結果

| 格式 | 驗證 |
|---|---|
| 圖片（TGA/DDS/BMP/PNG） | 55,377 個項目中 55,372 個可解碼；與 Pillow 逐像素比對 55,348 個完全相同（其餘 24 個是 16 bpp TGA，設計上不同）。JPEG（2 個）交給瀏覽器；`Q8W8V8U8` 凹凸貼圖（1 個）未支援；volume DDS（45 個）只解第 0 層。 |
| XET / TET | 5,799 個檔案全部解析，0 個結構問題（每個字串偏移、檔尾位置都對得上）。 |
| 字串表 `general.ess` | 依 `CKTDXStringTable::LoadStringTable` 精確移植（`fgetws` 行讀取、XOR 0x10、索引檢查）；30,584 筆、0 個索引不符，另有獨立的 Python 實作得到相同筆數。 |
| 物品資料庫 `item.kim` | 依 `KItemFormatTemplet` 的存取函式移植：57,106 個物品、3,811 組套裝、321,726 個字串，0 個越界偏移；18.7 MB 的檔案全部有解釋（只剩對齊用的零位元組與 6 個沒人引用的字串）。同時是第 5 階段 `Item.lua` 的地面實況。 |
| X/Y 檔容器（`bzip`/MSZIP） | 25,204 個壓縮項目全部解開；其中 25,153 個與 fflate 結果逐位元組相同，其餘 51 個含有 fflate/zlib 不接受的「沒有 NLEN 的 stored block」，由自寫的 inflate 處理。 |
| 通用 DirectX X 讀取器 | 25,313 個檔案（25,208 binary、105 text）全部解析，0 錯誤；1,049 萬個三角形面、1,205 萬個頂點（共 107,183 個網格）的索引與大小一致性檢查 0 違規。 |
| KME / KSM / KAC（KOG 自有格式） | 109 + 1,031 個檔案全部解析，0 錯誤、0 個不變量違規（索引、屬性、骨架、影格樹、時間遞增）；16,428 組動畫、967,449 條動畫、1.096 億個 key。 |
| AVI + MPEG-1 影片（`data/movie`，原版由 Bandisoft 的 `bdvid32.dll` 播放） | 30 個檔案、18,514 張畫面（999 張 I、17,515 張 P；400×220、24 fps、無音訊）依 ISO 11172-2 自行實作解碼，與 FFmpeg（透過 PyAV）逐取樣點完全相同（Y/Cb/Cr 的 CRC-32 全數吻合，約 22 秒）。另有 9 個用 FFmpeg 編碼器產生的合成串流（B 畫面、非 16 倍數尺寸、大位移向量、每巨集區塊量化值變動、16 位元 escape、長跳過序列、全像素向量、自訂量化矩陣）與手工位元流（slice 從列中間開始、stuffing）一併比對，37 個測試、40 個變異測試全部殺死。**假設**：`bdvid32.dll` 內部的 YUV→RGB 轉換看不到，採 BT.601；原版的播放時序與 Bandi API 行為尚未實作。 |

### 引擎載入器與 `OptimizeKeys` 的驗證結果

| 項目 | 驗證 |
|---|---|
| KSM／KAC 載入器（`loadSkinnedMesh`） | 全部 1,031 個 KSM 載入成功並與解析結果一致（`tools/verify-ksm-load.ts`，87 秒）：52,964 個影格、8,936 個 mesh container（2,560 個蒙皮、25,763 根骨頭）、1,562,248 個頂點、16,428 組動畫、967,449 條動畫；key 由 109,641,891 個經 `OptimizeKeys` 縮減為 22,443,735 個（20.5 %），沒有任何通道變多或變空。瀏覽器內：站立的艾爾索德與 Walk 動作（`browser-test.ts`） |
| KME／X 靜態網格（`loadXMesh`） | 109 個 KME 全部載入（weld 後頂點 11,110 → 10,409、7,495 個面、279 個繪製範圍）；另抽樣每 50 個一個的 507 個 X／Y 檔（`tools/verify-xmesh-load.ts`，45 秒）；2 個檔案沒有網格，與 exe 相同（`D3DXERR_LOADEDMESHASNODATA`） |
| `OptimizeKeys`（KAC 的 key 縮減器） | **oracle 是 exe 自己的機器碼**：`tools/peemu.py` 在 Unicorn CPU 模擬器上執行 `data/x2.exe` 的 `OptimizeKeys`（import 以 stub 取代），逐位元比對（key 數與每個浮點數）：14,300 個合成案例、3,225 條實際動畫（36.4 萬個 key → 7.5 萬個）與 fixture 錄製時的 4,113 個案例全部相同。單元測試（`kac-keys.test.ts`，11 個）重播 202 個錄下的案例；22 個變異測試由單元測試殺死 18 個，其餘 4 個是等價變異（`tools/mutate-optimizekeys.py`） |

`OptimizeKeys` 的已知偏差與限制（詳見 `docs/FINDINGS.md` 16）：① exe 的縮放通道有**未初始化變數的 bug**（兩個符號累加器從堆疊取值），移植從 0 起算，在模擬器的堆疊內容下 3,225 條動畫中有 190 條（5.9 %）的縮放 key 數不同，動畫本身相同；② 超過 32 個且未排序、又含相同時間的 key 時，exe 的 introsort 不穩定（未移植；所有實際資料的 key 都已排序）；③ `D3DXQuaternionNormalize`／`Multiply` 在 oracle 裡是公式模型（真正的函式依 CPU 分派），所以比對的是縮減邏輯本身。

**誠實的限制**：以上只證明「檔案格式讀得對」。D3DX 載入網格時的語意（多網格檔案合併與 frame 矩陣、頂點 weld / optimize、X 檔四元數慣例、動畫控制器的 track 混合）已在階段 3 實作，但沒有 D3DX 可以比對：只有 Wine 的 native 測試（載入器結構、`D3DXFrameFind`、`UpdateSkinnedMesh`）可當 oracle，其餘假設列在 `docs/FINDINGS.md` 12.5（原始分析在第 9 節）。`OptimizeKeys` 已移植並以 exe 自己的機器碼驗證（見下）；該驗證**不涵蓋** `D3DXQuaternionNormalize`／`D3DXQuaternionMultiply`（以公式建模）。

## 倉庫結構

```
packages/kom      @els/kom   KOM 封存檔（zlib、XORCRC 演算法 2、Adler-32、HTTP range 來源）
packages/lua      @els/lua   LuaJIT 2.0.2 位元碼 VM 與標準函式庫（對照 x2.exe 內的 lj_* 實作）、`KLuaManagerProxy`（文字設定檔直譯器）
packages/assets   @els/assets  圖片（TGA/DDS/BMP/PNG）、XET/TET、字串表（general.ess）、物品資料庫（item.kim）、MSZIP、DirectX X 讀取器、KME/KSM/KAC 解碼器、粒子／XMeshPlayer 腳本解析器、AVI 解封裝與 MPEG-1 影片解碼器
packages/d3d9     @els/d3d9  Direct3D 9 + D3DX 建立在 WebGPU 上（裝置、固定管線、D3DX 數學／貼圖／網格／骨架／動畫、XRenderer.fx effect 模擬）
packages/host     @els/host  `lua_tinker` 等價層：binder、型別化 API（由 docs/host_api.tsv 產生）、`KLuaManager`、`HostWorld`（一個 Lua state + `IncludeLua`）、腳本普查
packages/ui       @els/ui    UI 類別（`CKTDGUIDialog` 與各控制項、slot 管理器、字型管理器、字形字型與頁面貼圖），註冊在 host binder 上讓原版 `DLG_*.lua` 不經修改地執行；`census` 為 1,024 支 DLG 腳本的普查
packages/freetype @els/freetype  FreeType 2.4.11（TrueType 位元碼直譯器、平滑光柵器、字形載入）逐函式移植；與 exe 自己的 FreeType（Unicorn 模擬器上的 oracle）逐位元相同
packages/engine   @els/engine  引擎類別（CKTDX*／CKTDG*）建立在 d3d9 之上，逐函式移植；目前有 CKTDXDeviceXSkinMesh（影格清單、KSM／KAC 載入器、`OptimizeKeys`）與 CKTDXDeviceXMesh（KME／X 載入器）
tests/lua         差異測試（兩個 VM 執行同一份 luajit -b -s 位元碼）
tools             驗證、分析與產生文件的工具（見 docs/ARCHITECTURE.md）
docs              文件（見下）
data              原版客戶端（173 個 KOM、x2.exe、x2.exe.c/.h、字型、影片、音樂…）
apps/server       @els/server  Bun 伺服器：提供客戶端頁面、即時打包的 bundle、支援 Range 的 /data/*（原版資料）與 /api/files；遊戲伺服器（封包協定、bun:sqlite）屬階段 6
apps/client       @els/client  目前是**資產檢視器**：以 HTTP Range 掛載 173 個 KOM（97,891 個項目），圖片／影片／音訊／Lua 位元碼清單／XET·TET／X·Y·KSM·KME 網格（貼圖、蒙皮、動畫，經 D3D9 層畫在 WebGPU canvas）；開機流程與遊戲狀態屬階段 6
```

## 快速開始

```sh
npm install --no-audit --no-fund --prefix /home/user/work/boot bun@1.4.4   # npm 讀不懂本倉庫的 workspace: 規格，先把 bun 裝到暫存前綴
/home/user/work/boot/node_modules/.bin/bun install   # 由 bun 安裝 typescript、fflate、webgpu 並連結 @els/* 工作區
./tools/setup-gpu.sh                    # d3d9 測試用的軟體 Vulkan（SwiftShader），之後以 ./tools/gpu.sh <指令> 執行
./node_modules/.bin/bun run tools/verify-kom.ts          # 驗證全部 KOM（約 2 分鐘）
./tools/setup-oracle.sh                 # 建置 LuaJIT 2.0.2 oracle 到 /home/user/work/luajit-2.0
python3 tools/kom_extract.py /home/user/work/ex lua,LUA  # 取出 4,498 個腳本
./tools/lua-difftest.sh                 # 15 個差異測試（t10–t14 為模糊測試、t15 為載入器）
ELS_GPU_NATIVE=1 ./tools/test-packages.sh   # 不需要 GPU 的單元測試（1,421 個通過，166 個需要 GPU 而自行略過；約 1 分鐘）
./tools/test-packages.sh   # 全部 1,587 個測試（含 154 個 d3d9 測試，在 Dawn + SwiftShader 上執行）；分三個 bun 行程執行（771 + 789 + 27 個；最後一個是 `packages/ui/test-gpu` 的對話框與文字繪圖測試），因為單一行程在 4 GB 的機器上會被 OOM 殺掉
./node_modules/.bin/bun run tools/ui-census.ts --md docs/UI_COVERAGE.md   # 1,024 支 DLG 腳本：992 支跑到結尾、全部完整移植並嚴格執行，其中 911 支只含已能畫圖片的控制項類別（約 30 秒）
python3 tools/mutate-ui.py   # UI 類別的變異測試：99 個變異（約 5 分鐘；97 個被抓到，2 個等價）
python3 tools/mutate-draw.py   # 繪圖類別、它們的字串、ComboBox、ListBox、Slot 與 CPU 參考實作的變異測試：960 個變異（約 24 分鐘；944 個被抓到，16 個等價）
python3 tools/mutate-framemove.py   # OnFrameMove 的變異測試：440 個變異（約 6 分鐘；434 個被抓到，6 個等價）
python3 tools/mutate-font.py   # 文字路徑（字形字型、頁面貼圖、字型管理器）的變異測試：662 個變異（621 個被抓到，41 個存活且各有理由；`--list`、`--check`，名稱子字串可只跑一部分）
./node_modules/.bin/bun run tools/verify-freetype.ts --layers calc,face,chars,unhinted,hinted,render,render-unhinted,raster,embolden,synth --char-max 196607   # FreeType 移植與 exe 自己的 FreeType 逐數字比對（需要 unicorn、pefile、capstone：見 tools/oracle-freetype.py；全部約 15 分鐘）
python3 tools/mutate-freetype.py   # FreeType 移植的變異測試：376 個變異（約 22 分鐘；358 個被抓到，18 個存活且各有理由）
./tools/gpu.sh ./node_modules/.bin/bun run tools/ui-draw.ts --md docs/UI_DRAW.md --tsv docs/ui-draw.tsv   # 繪圖普查：1,024 支 DLG 腳本各跑一個畫格後逐一畫出，並與 CPU 參考實作比對（約 4 分鐘，約 1 GB；`--frames N` 改畫格數）
D3D9_TEST_OUT=/tmp/pics ./tools/gpu.sh ./node_modules/.bin/bun test packages/ui/test-gpu/text-draw.test.ts   # 文字的畫面測試（3 個，約 3 秒）；`D3D9_TEST_OUT` 資料夾會收到每個測試畫出的 PNG（`ui-text-fonts.png`、`ui-text-multiline.png`、`ui-text-evicted.png`）
./node_modules/.bin/bun run tools/verify-ksm.ts   # KME/KSM/KAC 全部資產驗證（約 45 秒）；其餘見 package.json 的 verify:*
./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-ksm-load.ts   # 1,031 個 KSM 全部經引擎載入器載入（約 90 秒）
pip install --target /home/user/work/pycap unicorn pefile capstone   # CPU 模擬器與 PE／反組譯函式庫（`ELS_PYLIBS` 可改目錄）
./node_modules/.bin/bun run tools/verify-optimizekeys.ts   # exe 的 OptimizeKeys（模擬執行）對照移植，逐位元（約 1 分鐘）；變異測試：python3 tools/mutate-optimizekeys.py
pip install --target /home/user/work/pyav av numpy   # PyAV 內含 FFmpeg：MPEG-1 影片的 oracle
PYTHONPATH=/home/user/work/pyav python3 tools/oracle-mpeg1.py --out /tmp/oracle.json data/movie/*.avi && ./node_modules/.bin/bun run tools/verify-mpeg1.ts --hashes /tmp/oracle.json   # 30 部影片、18,514 張畫面（約 22 秒）
./tools/setup-browser.sh                # puppeteer-core + 無頭 Chromium（WebGPU 走 SwiftShader），約 1 分鐘
./node_modules/.bin/bun run tools/browser-test.ts --shots /home/user/work/shots   # 瀏覽器內 22 項檢查（約 21 秒），截圖留在 --shots
./node_modules/.bin/bun run apps/server/src/main.ts --port 8080   # 資產檢視器 http://localhost:8080/（網格預覽需要支援 WebGPU 的瀏覽器）
./tools/corpus-diff.sh 1                # stub 環境全腳本差異測試（flavor 1/2/3，各約 3 分鐘）
./node_modules/.bin/tsc -p tsconfig.json --noEmit        # 型別檢查
```

沙箱重設只會保留倉庫目錄；`/home/user/work`（oracle、解出的腳本、分析檔）可用上面的指令與 `docs/ARCHITECTURE.md` 的「Reproducing the verification」整段重建。

## 文件

| 檔案 | 內容 |
|---|---|
| `docs/ROADMAP.md` | 各階段、驗收方式、目前狀態 |
| `docs/ARCHITECTURE.md` | 套件與工具地圖、設計重點、從乾淨 checkout 重現驗證的步驟 |
| `docs/FINDINGS.md` | 逆向發現（KOM、Lua、LuaJIT 行為、corpus 結果、host API 與腳本載入） |
| `docs/PORTING_RULES.md` | 移植規則（真相來源順序、移植規則、逐函式檢查表、平台邊界 stub） |
| `docs/HOST_API.md`、`docs/host_api.tsv` | 由反編譯結果產生的 `lua_tinker` 綁定目錄（122 個類別、1,418 個方法，含 IDA 位址） |
| `docs/HOST_CENSUS.md` | 4,498 支腳本在 host 層（型別化 stub）上的普查：哪些跑到結尾、各缺哪些方法 |
| `docs/UI_COVERAGE.md` | DLG 腳本的普查：1,024 支中 992 支完整移植並嚴格執行、其餘 32 支為遊戲狀態的腳本；各 UI 類別的方法數 |
| `docs/UI_DRAW.md`、`docs/ui-draw.tsv` | 繪圖普查：1,024 支 DLG 腳本各跑一個 `OnFrameMove` 畫格後逐一經整條繪圖堆疊畫出並與 CPU 參考實作比對；不畫圖的對話框與原因、畫格的例外、錯誤記錄、尚未移植的繪製 |
| `docs/SCRIPT_API_USAGE.md` | 4,498 個腳本實際用到的 host API |
| `docs/SCRIPT_GRAPH.md` | exe 載入哪些腳本（載入圖） |
| `docs/LEDGER.md` | 涵蓋帳本，以 IDA 位址為鍵（內嵌 LuaJIT 函式逐一列出；C++ 類別另有完整清單） |

## 以 stub 取代的平台模組

反作弊、BugTrap／KncCrashRpt／SMTP 當機回報、自動更新（WinINet）、機器識別碼、DirectX 裝置列舉、CPU/GPU 效能量測、登錄檔存取，皆以 stub 取代並列於 `docs/PORTING_RULES.md`；DirectInput／IMM32／Win32 視窗對應到 DOM 事件；FMOD 對應到 WebAudio。

## 需要你提供的參考資料

原版畫面截圖、遊戲影片與封包擷取（沒有的話，階段 3–6 的畫面與通訊協定只能依反編譯結果推測，無法對照驗證）。
