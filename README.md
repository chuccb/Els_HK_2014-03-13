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
| 2 | 資產解碼器（TGA/DDS/X/Y/XET/TET/粒子腳本/KIM/ESS/MPEG-1） | **完成（解碼端）**：圖片（TGA/DDS/BMP/PNG）、XET/TET、字串表（ESS）、物品資料庫（KIM）、X 檔容器（MSZIP）與通用 X 讀取器、KME/KSM/KAC、粒子與 XMeshPlayer 腳本（解析端，37 個檔案、13,882 個區塊與獨立讀取器逐欄位一致）、**AVI + MPEG-1 影片**（30 個 `data/movie/*.avi`、18,514 張畫面與 FFmpeg 逐取樣點完全相同）都已完成並以全部資產驗證；粒子／XMeshPlayer 執行期與播放影片的 Bandi 式播放器（`CMovieData`）需要繪圖與 UI，留給後續階段；網格語意由階段 3 的 D3DX 實作承接 |
| 3 | WebGPU 的 D3D9 相容層（`packages/d3d9`） | **進行中，核心已完成**：`IDirect3DDevice9`（固定管線、全部狀態、貼圖格式、render target、可程式化的頂點階段）、D3DX 數學／貼圖／網格／骨架／動畫／影格階層載入器、`XRenderer.fx` 的 effect 模擬（19 個 technique、80 個 `vs_1_1` 著色器 → WGSL）；153 個測試在 Dawn + SwiftShader 上執行（`docs/img/d3d9-demo.png`）。引擎載入器已移植（`packages/engine`：`CKTDXDeviceXSkinMesh` 的影格清單與 KSM／KAC 載入器、`CKTDXDeviceXMesh` 的 KME／X 載入器、KAC 的 `OptimizeKeys`——**與 exe 逐位元相同**，見下）；`CKTDGXRenderer`／`CKTDGEffectStateManager` 尚未移植，也沒有真正的 D3D9／D3DX 可比對（假設列在 `docs/FINDINGS.md` 12.5） |
| 3＋ | **瀏覽器實測**（`apps/client` + `apps/server` + `tools/browser-test.ts`） | **完成（作為測試台）**：無頭 Chromium 153 + WebGPU（SwiftShader）可在沙箱執行；整個流程（HTTP Range 掛載 KOM → 解碼 → D3D9 層 → WebGPU canvas）有 22 項自動檢查：TGA 與 MPEG-1 畫面與 Bun 端解碼逐像素相同、蒙皮動畫網格會隨動畫時間改變、RGBA 與 BGRA 後緩衝逐像素相同（桌機瀏覽器偏好 BGRA）。**這證明瀏覽器端與 Bun 端一致，不證明畫面等同原版**（沒有參考截圖）；艾爾索德等角色（KSM + KAC）與 109 個 KME 靜態網格已能繪製並播放動畫 |
| 4 | UI 框架（`DLG_*.lua`） | 未開始 |
| 5 | `lua_tinker` 等價的 host API | 已完成**地面實況分析**（`docs/HOST_API.md`），尚未實作 |
| 6 | 開機／登入／角色選擇 + `apps/server` | 未開始 |

![資產檢視器：Sonogong 寵物（`Motion_PET_SONOGONG_STEB_1.X`，蒙皮動畫「Walk」）由原版 KOM 資產經 D3D9 層畫在 WebGPU canvas（無頭 Chromium + SwiftShader 截圖）](docs/img/web-viewer-pet.png)

![資產檢視器：艾爾索德（`Motion_Elsword.x`，KSM 骨架 + KAC 動畫「Walk」，0.2 秒；key 經 `OptimizeKeys`）](docs/img/web-viewer-elsword-walk.png)

![資產檢視器：KME 靜態網格 `Elder_Village_bigsang.Y`（693 個頂點、30 個子集、9 張貼圖）](docs/img/web-viewer-kme.png)

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
./node_modules/.bin/bun test packages   # 不需要 GPU 的單元測試（389 個通過，139 個需要 GPU 而自行略過）
./tools/gpu.sh ./node_modules/.bin/bun test packages   # 全部 528 個測試（含 153 個 d3d9 測試，在 Dawn + SwiftShader 上執行）
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
| `docs/SCRIPT_API_USAGE.md` | 4,498 個腳本實際用到的 host API |
| `docs/SCRIPT_GRAPH.md` | exe 載入哪些腳本（載入圖） |
| `docs/LEDGER.md` | 涵蓋帳本，以 IDA 位址為鍵（內嵌 LuaJIT 函式逐一列出；C++ 類別另有完整清單） |

## 以 stub 取代的平台模組

反作弊、BugTrap／KncCrashRpt／SMTP 當機回報、自動更新（WinINet）、機器識別碼、DirectX 裝置列舉、CPU/GPU 效能量測、登錄檔存取，皆以 stub 取代並列於 `docs/PORTING_RULES.md`；DirectInput／IMM32／Win32 視窗對應到 DOM 事件；FMOD 對應到 WebAudio。

## 需要你提供的參考資料

原版畫面截圖、遊戲影片與封包擷取（沒有的話，階段 3–6 的畫面與通訊協定只能依反編譯結果推測，無法對照驗證）。
