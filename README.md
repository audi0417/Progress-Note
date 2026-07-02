# Progress Note — 醫病即時診斷筆記

醫師與病患共用的診間協作工具：問診過程即時語音轉文字（雙方都能看到逐字稿）、
醫師可即時或事後校對內容，問診結束後由 LLM 自動整理成「臨床摘要」與「病患易懂的
衛教說明（診斷、用藥、後續追蹤、警訊）」，經醫師確認後釋出給病患。

前端是單頁（無路由跳轉）、手機優先的 PWA：登入狀態存在 `localStorage`，整個
「建立/加入診間 → 即時錄音與逐字稿 → AI 摘要」流程都在同一個畫面內完成，
可以「加入主畫面」像原生 App 一樣全螢幕開啟。

## 架構總覽

```
frontend/  React + TypeScript + Vite + PWA (vite-plugin-pwa)
  - 單頁流程：登入狀態存 localStorage，App.tsx 依狀態切換「首頁」/「診間」畫面，無路由跳轉
  - 建立/加入診間、即時逐字稿顯示、醫師逐句校對
  - 麥克風擷取 → 16kHz PCM16 → WebSocket 串流至後端（點擊即跳出瀏覽器原生麥克風授權）
  - 問診結束後顯示 AI 整理摘要（醫師可編輯確認，病患看到白話版）
  - manifest + service worker：可安裝到手機主畫面，全螢幕獨立視窗開啟

backend/   FastAPI (Python)
  - REST API：建立/加入診間、逐字稿 CRUD、結束問診、產生與審閱臨床筆記
  - WebSocket：/ws/consultation/{session_id}，串流音訊 + 即時廣播逐字稿與筆記事件
  - ASR 服務抽象層（services/asr）：
      - mock：不需 GPU / 模型權重，以簡單語音活性偵測模擬分段輸出，方便本機開發與展示完整流程
      - nemotron：串接 nvidia/nemotron-3.5-asr-streaming-0.6b（NeMo streaming ASR）
  - LLM 分析服務（services/analysis_service.py）：呼叫 Anthropic API 將逐字稿整理成結構化 JSON；
    未設定金鑰時退回離線版摘要，方便展示其餘功能
  - SQLite（可換成其他 SQLAlchemy 支援的資料庫）儲存診間、逐字稿、筆記
```

### 資料流程

1. 醫師建立診間 → 取得 6 碼代碼；病患輸入代碼加入。
2. 雙方各自連上 WebSocket（`role=doctor` / `role=patient`），各自的麥克風音訊會標記對應角色送給後端 ASR。
3. ASR 產生 partial（即時顯示、可能變動）與 final（寫入資料庫、廣播給雙方）逐字稿片段。
4. 醫師可點擊任何一句即時校正內容（`PATCH /api/sessions/{id}/segments/{segment_id}`），校正結果即時同步給病患畫面。
5. 醫師按下「結束問診」→ `POST /api/sessions/{id}/end`：關閉診間、將完整逐字稿送給 LLM，產生：
   - `diagnosis_summary` / `treatment_plan`：醫師視角的臨床摘要與處置計畫
   - `patient_summary` / `medications` / `follow_up` / `warning_signs`：病患視角的白話說明、用藥、追蹤與警訊
6. 醫師可在確認畫面修改 AI 產生的內容，按下「確認並釋出給病患」後，病患畫面才會顯示最終版本。

## 重要說明：ASR 模型整合現況

`backend/app/services/asr/nemotron_asr.py` 是依照 NVIDIA NeMo cache-aware
streaming Conformer 系列模型的標準串流解碼模式（`conformer_stream_step` /
`get_initial_cache_state` 等）所撰寫的整合層。

**在撰寫這份程式碼時，此沙盒環境的對外網路政策封鎖了 huggingface.co**，因此
無法直接讀取 `nvidia/nemotron-3.5-asr-streaming-0.6b` 的模型卡以核對這個
特定 checkpoint 實際的 `from_pretrained` 呼叫方式、chunk size 等細節是否與
程式碼中的假設完全一致。正式部署前請務必：

1. 閱讀模型卡 https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b ，
   確認載入方式與串流參數（`att_context_size`、chunk/shift size 等）。
2. `pip install -r backend/requirements-asr.txt`（含 `torch`、`nemo_toolkit[asr]`，需要 CUDA GPU）。
3. 在 `backend/.env` 設定 `ASR_BACKEND=nemotron`。
4. 若安裝的 `nemo_toolkit` 版本 API 與程式碼不符，只需調整
   `nemotron_asr.py` 中的 `_load_model` / `_step`，其餘系統完全不受影響
   （所有程式都只依賴 `services/asr/base.py` 定義的介面）。

在未完成以上設定前，系統預設使用 `ASR_BACKEND=mock`：以簡單的音量式語音活性
偵測模擬逐句輸出（標示「模擬語音辨識」），讓其餘功能（即時同步、校對、
AI 摘要、醫病雙視角）可以完整展示與測試，但**不是真正的語音辨識結果**。

## 快速開始

### 後端

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 依需求調整（ASR_BACKEND、ANTHROPIC_API_KEY 等）
uvicorn app.main:app --reload --port 8000
```

跑測試：`pytest`

### 前端

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173，已內建 proxy 轉發 /api、/ws 至 :8000
```

開兩個瀏覽器分頁：一個以「醫師」身份建立診間並分享代碼，另一個以「病患」身份輸入代碼加入，即可體驗完整流程。

## PWA / 手機錄音體驗

- **關於「點擊觸發手機預設錄音 App」**：瀏覽器沒有標準 API 可以呼叫並取回手機
  內建錄音 App（如 iOS 語音備忘錄）的錄音結果，這是作業系統層級的沙盒限制。
  本專案改採網頁原生的 `getUserMedia()` 錄音——使用者點擊「開始語音辨識」時，
  瀏覽器會跳出系統原生的麥克風授權對話框，體感上接近呼叫系統功能，但錄音與
  串流全部在網頁內完成，不需要另開其他 App。
- 前端已設定 `vite-plugin-pwa`：build 後會產生 `manifest.webmanifest` 與
  service worker，手機瀏覽器開啟網址後可用「加入主畫面」安裝，全螢幕獨立
  視窗開啟，圖示為 `frontend/public/icons/`（純程式產生的暫用圖示，正式上線
  建議換成正式視覺）。
- 本機開發時 `npm run dev` 也會啟用 PWA（`devOptions.enabled: true`），方便
  直接用手機連到你電腦的區網位址測試安裝與錄音授權流程；正式環境仍以
  `npm run build` 產出的版本為準。
- API（`/api/*`）與 WebSocket（`/ws/*`）永遠即時連線，service worker 只快取
  前端靜態資源（JS/CSS/HTML/圖示），不會快取問診資料。

## LLM 分析設定

在 `backend/.env` 設定：

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
```

未設定 `ANTHROPIC_API_KEY` 時，`/api/sessions/{id}/end` 會回傳離線版摘要
（原始逐字稿摘錄 + 提示訊息），方便在沒有金鑰的環境下仍可測試其餘流程。

## 隱私與安全注意事項

- 這是一個功能示範／原型，**尚未包含病歷等級的存取控制、稽核紀錄或加密儲存**，
  正式導入臨床環境前需另行補強身分驗證、傳輸與靜態加密、存取控制與法規遵循（如 HIPAA / 個資法）評估。
- 診間代碼目前僅是 6 碼隨機字串，任何取得代碼者皆可加入；正式環境建議加上到期時間、一次性使用或更強的驗證機制。
