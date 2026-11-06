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
| 1b | Lua **原始碼**編譯器（`lj_lex`/`lj_parse` 移植；`GameOption.txt`、`TutorSystem.lua`、`loadstring` 需要） | 未開始 |
| 2 | 資產解碼器（TGA/DDS/X/Y/XET/TET/粒子腳本/KIM/ESS/MPEG-1） | **進行中**：圖片（TGA/DDS/BMP/PNG）、XET/TET、X 檔容器（MSZIP）與通用 X 讀取器、KME/KSM/KAC 已完成並以全部資產驗證；網格語意、粒子腳本、KIM、ESS、MPEG-1 未做（見下） |
| 3 | WebGPU 的 D3D9 相容層 | 未開始 |
| 4 | UI 框架（`DLG_*.lua`） | 未開始 |
| 5 | `lua_tinker` 等價的 host API | 已完成**地面實況分析**（`docs/HOST_API.md`），尚未實作 |
| 6 | 開機／登入／角色選擇 + `apps/server` | 未開始 |

### Lua VM 的驗證結果（誠實版）

* 位元碼載入器與反組譯器：4,498 個腳本、26,565 個函式原型，與 oracle 的 `jit.bc` 輸出逐行相同。
* 9 個手寫差異測試（`tests/lua/`）：全數與原生 LuaJIT 輸出相同。
* **stub 環境全腳本差異測試**（`tools/corpus-diff.sh`）：4,498 個遊戲腳本 × 3 種 stub 回傳模式，原生 LuaJIT 與 TS VM 的記錄逐位元組相同。這個測試找出並修掉 3 個 VM 錯誤（`%q`、比較運算的運算元順序、NaN 比較）。
* **這只證明 VM 與標準函式庫在這些腳本的載入期行為上正確**；真正的引擎物件、長時間執行、GC 等不在其中。

已知缺口（也記錄於 `docs/FINDINGS.md` 第 4 節）：metamethod 內的 `yield` 不支援；`setfenv(0, t)` 為 no-op；`collectgarbage('step')` 恆回傳 false；weak table 與 `__gc` 不支援；`load/loadstring/loadfile/dofile` 只接受位元碼（沒有原始碼編譯器）；`debug/io/os/package` 為近似實作；`pow/exp/log/三角函數` 使用 V8 的 libm，與 exe 的 CRT/x87 最後一位可能不同；`tostring(table)`／`%p` 的位址不可能與 exe 相同。

### Phase 2（資產）的驗證結果

| 格式 | 驗證 |
|---|---|
| 圖片（TGA/DDS/BMP/PNG） | 55,377 個項目中 55,372 個可解碼；與 Pillow 逐像素比對 55,348 個完全相同（其餘 24 個是 16 bpp TGA，設計上不同）。JPEG（2 個）交給瀏覽器；`Q8W8V8U8` 凹凸貼圖（1 個）未支援；volume DDS（45 個）只解第 0 層。 |
| XET / TET | 5,799 個檔案全部解析，0 個結構問題（每個字串偏移、檔尾位置都對得上）。 |
| X/Y 檔容器（`bzip`/MSZIP） | 25,204 個壓縮項目全部解開；其中 25,153 個與 fflate 結果逐位元組相同，其餘 51 個含有 fflate/zlib 不接受的「沒有 NLEN 的 stored block」，由自寫的 inflate 處理。 |
| 通用 DirectX X 讀取器 | 25,313 個檔案（25,208 binary、105 text）全部解析，0 錯誤；1,049 萬個三角形面、1,205 萬個頂點（共 107,183 個網格）的索引與大小一致性檢查 0 違規。 |
| KME / KSM / KAC（KOG 自有格式） | 109 + 1,031 個檔案全部解析，0 錯誤、0 個不變量違規（索引、屬性、骨架、影格樹、時間遞增）；16,428 組動畫、967,449 條動畫、1.096 億個 key。 |

**誠實的限制**：以上只證明「檔案格式讀得對」。D3DX 載入網格時的語意（多網格檔案合併與 frame 矩陣、頂點 weld / optimize、X 檔四元數慣例、`OptimizeKeys`、動畫控制器的 track 混合）尚未實作，也沒有 D3DX 可以比對；這些假設與待確認項目列在 `docs/FINDINGS.md` 第 9 節。

## 倉庫結構

```
packages/kom      @els/kom   KOM 封存檔（zlib、XORCRC 演算法 2、Adler-32、HTTP range 來源）
packages/lua      @els/lua   LuaJIT 2.0.2 位元碼 VM 與標準函式庫（對照 x2.exe 內的 lj_* 實作）
packages/assets   @els/assets  圖片（TGA/DDS/BMP/PNG）、XET/TET、MSZIP、DirectX X 讀取器、KME/KSM/KAC 解碼器
tests/lua         差異測試（兩個 VM 執行同一份 luajit -b -s 位元碼）
tools             驗證、分析與產生文件的工具（見 docs/ARCHITECTURE.md）
docs              文件（見下）
data              原版客戶端（173 個 KOM、x2.exe、x2.exe.c/.h、字型、影片、音樂…）
apps/client, apps/server   預留（尚未實作）
```

## 快速開始

```sh
npm install --no-audit --no-fund        # 安裝 bun、typescript、fflate 到 node_modules（會產生 package-lock.json，可刪除）
./node_modules/.bin/bun run tools/verify-kom.ts          # 驗證全部 KOM（約 2 分鐘）
./tools/setup-oracle.sh                 # 建置 LuaJIT 2.0.2 oracle 到 /home/user/work/luajit-2.0
python3 tools/kom_extract.py /home/user/work/ex lua,LUA  # 取出 4,498 個腳本
./tools/lua-difftest.sh                 # 9 個差異測試
./node_modules/.bin/bun test packages/assets   # 資產解碼器單元測試（42 個）
./node_modules/.bin/bun run tools/verify-ksm.ts   # KME/KSM/KAC 全部資產驗證（約 45 秒）；其餘見 package.json 的 verify:*
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
