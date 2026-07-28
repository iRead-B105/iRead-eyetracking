"use strict";

const els = {
  calibrationView: document.querySelector("#calibrationView"),
  calibrationSurface: document.querySelector("#calibrationSurface"),
  calibrationDot: document.querySelector("#calibrationDot"),
  calibrationStatus: document.querySelector("#calibrationStatus"),
  calibrationProgress: document.querySelector("#calibrationProgress"),
  readingText: document.querySelector("#readingText"),
  strokeWritingView: document.querySelector("#strokeWritingView"),
  strokeSvg: document.querySelector("#strokeSvg"),
  strokeInstruction: document.querySelector("#strokeInstruction"),
  gazeCursor: document.querySelector("#gazeCursor"),
  socketState: document.querySelector("#socketState"),
  trackerState: document.querySelector("#trackerState"),
  currentWord: document.querySelector("#currentWord"),
  summaryLine: document.querySelector("#summaryLine"),
  sessionLine: document.querySelector("#sessionLine"),
  debugLine: document.querySelector("#debugLine"),
  metricsTable: document.querySelector("#metricsTable"),
  studentId: document.querySelector("#studentId"),
  tobiiProfile: document.querySelector("#tobiiProfile"),
  contentType: document.querySelector("#contentType"),
  contentId: document.querySelector("#contentId"),
  sentenceInput: document.querySelector("#sentenceInput"),
  calibrationMode: document.querySelector("#calibrationMode"),
  calibrationTabButton: document.querySelector("#calibrationTabButton"),
  readingTabButton: document.querySelector("#readingTabButton"),
  writingTabButton: document.querySelector("#writingTabButton"),
  calibrationBadge: document.querySelector("#calibrationBadge"),
  startFivePointButton: document.querySelector("#startFivePointButton"),
  openTobiiCalibrationButton: document.querySelector("#openTobiiCalibrationButton"),
  goReadingButton: document.querySelector("#goReadingButton"),
  startButton: document.querySelector("#startButton"),
  saveButton: document.querySelector("#saveButton"),
  writingChar: document.querySelector("#writingChar"),
  startWritingButton: document.querySelector("#startWritingButton"),
  resetWritingButton: document.querySelector("#resetWritingButton"),
  writingStatus: document.querySelector("#writingStatus"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  coordSource: document.querySelector("#coordSource"),
  flipX: document.querySelector("#flipX"),
  flipY: document.querySelector("#flipY"),
  sequenceAssist: document.querySelector("#sequenceAssist"),
  calibrationTarget: document.querySelector("#calibrationTarget"),
  calibrateButton: document.querySelector("#calibrateButton"),
  offsetX: document.querySelector("#offsetX"),
  offsetY: document.querySelector("#offsetY"),
  hitPadding: document.querySelector("#hitPadding"),
  offsetXLabel: document.querySelector("#offsetXLabel"),
  offsetYLabel: document.querySelector("#offsetYLabel"),
  paddingLabel: document.querySelector("#paddingLabel")
};

const API_ORIGIN = location.protocol.startsWith("http") && location.port === "8765"
  ? location.origin
  : "http://127.0.0.1:8765";
const APP_VERSION = "1.0.2";
const WEB_CALIBRATION_ENABLED = false;

function apiUrl(path) {
  return new URL(path, API_ORIGIN).toString();
}

function wsUrl(path) {
  const url = new URL(path, API_ORIGIN);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

let socket = null;
let sessionId = null;
let backendGazeSessionId = null;
let wordBoxes = [];
let lastSampleAt = null;
let lastWordIndex = null;
let maxWordIndexSeen = -1;
let smoothPoint = null;
let candidate = null;
let candidateHits = 0;
let startedAt = null;
let invalidStreak = 0;
let droppedFrames = 0;
let rejectedGazeStreak = 0;
let lastPointWithoutOffset = null;
let calibrationJob = null;
let wordAnchors = new Map();
let metricsActive = false;
let activeTab = WEB_CALIBRATION_ENABLED ? "calibration" : "reading";
let fivePointJob = null;
let fivePointModel = null;
let writingModel = null;
let writingActive = false;
let writingCurrentTarget = 0;
let writingDwellStartedAt = null;
let writingTraceProgress = 0;
let readingSessionRequest = null;
let headPoseBaseline = null;
let lastHeadPoseDelta = null;

const fivePointTargets = [
  { id: "center", label: "중앙", xRatio: 0.5, yRatio: 0.5 },
  { id: "top-left", label: "좌상단", xRatio: 0.17, yRatio: 0.18 },
  { id: "top-right", label: "우상단", xRatio: 0.83, yRatio: 0.18 },
  { id: "bottom-left", label: "좌하단", xRatio: 0.17, yRatio: 0.82 },
  { id: "bottom-right", label: "우하단", xRatio: 0.83, yRatio: 0.82 }
];
const ninePointTargets = [
  { id: "top-left", label: "좌상단", xRatio: 0.17, yRatio: 0.18 },
  { id: "top-center", label: "상단", xRatio: 0.5, yRatio: 0.18 },
  { id: "top-right", label: "우상단", xRatio: 0.83, yRatio: 0.18 },
  { id: "middle-left", label: "좌중단", xRatio: 0.17, yRatio: 0.5 },
  { id: "center", label: "중앙", xRatio: 0.5, yRatio: 0.5 },
  { id: "middle-right", label: "우중단", xRatio: 0.83, yRatio: 0.5 },
  { id: "bottom-left", label: "좌하단", xRatio: 0.17, yRatio: 0.82 },
  { id: "bottom-center", label: "하단", xRatio: 0.5, yRatio: 0.82 },
  { id: "bottom-right", label: "우하단", xRatio: 0.83, yRatio: 0.82 }
];
const fivePointDwellMs = 1050;
const fivePointHitRadius = 320;
const writingDwellMs = 480;
const writingHitRadius = 66;
const writingTraceRadius = 54;
const writingTraceCompleteThreshold = 0.86;
const writingTraceMaxJump = 0.22;
const smoothingResetRejectCount = 5;
const headRotationLimitDeg = 7.5;
const headPositionLimit = 0.22;
const headPositionComparableRange = 4;

const hangulInitials = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const hangulMedials = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const hangulFinals = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const compositeJamo = {
  "ㄲ": ["ㄱ", "ㄱ"],
  "ㄸ": ["ㄷ", "ㄷ"],
  "ㅃ": ["ㅂ", "ㅂ"],
  "ㅆ": ["ㅅ", "ㅅ"],
  "ㅉ": ["ㅈ", "ㅈ"],
  "ㄳ": ["ㄱ", "ㅅ"],
  "ㄵ": ["ㄴ", "ㅈ"],
  "ㄶ": ["ㄴ", "ㅎ"],
  "ㄺ": ["ㄹ", "ㄱ"],
  "ㄻ": ["ㄹ", "ㅁ"],
  "ㄼ": ["ㄹ", "ㅂ"],
  "ㄽ": ["ㄹ", "ㅅ"],
  "ㄾ": ["ㄹ", "ㅌ"],
  "ㄿ": ["ㄹ", "ㅍ"],
  "ㅀ": ["ㄹ", "ㅎ"],
  "ㅄ": ["ㅂ", "ㅅ"],
  "ㅘ": ["ㅗ", "ㅏ"],
  "ㅙ": ["ㅗ", "ㅐ"],
  "ㅚ": ["ㅗ", "ㅣ"],
  "ㅝ": ["ㅜ", "ㅓ"],
  "ㅞ": ["ㅜ", "ㅔ"],
  "ㅟ": ["ㅜ", "ㅣ"],
  "ㅢ": ["ㅡ", "ㅣ"]
};
const jamoStrokeTemplates = {
  "ㄱ": [[[16, 18], [82, 18], [82, 76]]],
  "ㄴ": [[[18, 18], [18, 78], [82, 78]]],
  "ㄷ": [[[78, 18], [18, 18], [18, 78], [80, 78]]],
  "ㄹ": [[[18, 18], [78, 18], [78, 48], [20, 48], [20, 78], [78, 78]]],
  "ㅁ": [[[20, 18], [80, 18], [80, 78], [20, 78], [20, 18]]],
  "ㅂ": [[[20, 18], [20, 78]], [[78, 18], [78, 78]], [[20, 50], [78, 50]], [[20, 78], [78, 78]]],
  "ㅅ": [[[50, 18], [20, 78]], [[50, 18], [82, 78]]],
  "ㅇ": [[[50, 18], [76, 28], [82, 52], [72, 74], [50, 82], [26, 74], [18, 52], [26, 28], [50, 18]]],
  "ㅈ": [[[22, 18], [78, 18]], [[50, 22], [22, 78]], [[50, 22], [82, 78]]],
  "ㅊ": [[[50, 12], [50, 28]], [[22, 34], [78, 34]], [[50, 36], [22, 82]], [[50, 36], [82, 82]]],
  "ㅋ": [[[16, 18], [82, 18], [82, 76]], [[38, 48], [82, 48]]],
  "ㅌ": [[[18, 18], [82, 18]], [[18, 48], [74, 48]], [[18, 18], [18, 78], [82, 78]]],
  "ㅍ": [[[12, 20], [88, 20]], [[28, 20], [28, 80]], [[72, 20], [72, 80]], [[12, 80], [88, 80]]],
  "ㅎ": [[[50, 12], [50, 26]], [[24, 34], [76, 34]], [[50, 44], [72, 52], [78, 70], [66, 84], [50, 88], [32, 84], [22, 70], [28, 52], [50, 44]]],
  "ㅏ": [[[48, 14], [48, 86]], [[48, 48], [82, 48]]],
  "ㅐ": [[[34, 14], [34, 86]], [[34, 48], [58, 48]], [[70, 14], [70, 86]]],
  "ㅑ": [[[40, 14], [40, 86]], [[40, 38], [80, 38]], [[40, 62], [80, 62]]],
  "ㅒ": [[[28, 14], [28, 86]], [[28, 38], [58, 38]], [[28, 62], [58, 62]], [[76, 14], [76, 86]]],
  "ㅓ": [[[54, 14], [54, 86]], [[20, 48], [54, 48]]],
  "ㅔ": [[[30, 14], [30, 86]], [[20, 48], [52, 48]], [[70, 14], [70, 86]]],
  "ㅕ": [[[60, 14], [60, 86]], [[20, 38], [60, 38]], [[20, 62], [60, 62]]],
  "ㅖ": [[[58, 14], [58, 86]], [[24, 38], [58, 38]], [[24, 62], [58, 62]], [[80, 14], [80, 86]]],
  "ㅗ": [[[18, 62], [82, 62]], [[50, 20], [50, 62]]],
  "ㅛ": [[[18, 68], [82, 68]], [[38, 24], [38, 68]], [[62, 24], [62, 68]]],
  "ㅜ": [[[18, 34], [82, 34]], [[50, 34], [50, 82]]],
  "ㅠ": [[[18, 30], [82, 30]], [[38, 30], [38, 78]], [[62, 30], [62, 78]]],
  "ㅡ": [[[18, 54], [82, 54]]],
  "ㅣ": [[[50, 14], [50, 86]]]
};

initializeCalibrationMode();
setActiveTab(WEB_CALIBRATION_ENABLED ? "calibration" : "reading");
renderSentence();
renderWritingExercise();
renderMetrics();
syncCalibrationLabels();

els.calibrationTabButton.addEventListener("click", () => setActiveTab("calibration"));
els.readingTabButton.addEventListener("click", () => setActiveTab("reading"));
els.writingTabButton.addEventListener("click", () => setActiveTab("writing"));
els.calibrationMode.addEventListener("change", resetCalibrationModel);
els.startFivePointButton.addEventListener("click", startFivePointCalibration);
els.openTobiiCalibrationButton.addEventListener("click", openTobiiCalibration);
els.calibrationDot.addEventListener("click", advanceFivePointByClick);
els.goReadingButton.addEventListener("click", () => setActiveTab("reading"));
els.startButton.addEventListener("click", startSession);
els.saveButton.addEventListener("click", saveSession);
els.startWritingButton.addEventListener("click", startWritingExercise);
els.resetWritingButton.addEventListener("click", resetWritingExercise);
els.fullscreenButton.addEventListener("click", enterFullscreen);
els.calibrateButton.addEventListener("click", calibrateToSelectedWord);
els.writingChar.addEventListener("input", resetWritingExercise);
els.sentenceInput.addEventListener("change", () => {
  if (!sessionId) {
    renderSentence();
    renderMetrics();
  }
});
els.offsetX.addEventListener("input", syncCalibrationLabels);
els.offsetY.addEventListener("input", syncCalibrationLabels);
els.hitPadding.addEventListener("input", () => {
  syncCalibrationLabels();
  refreshWordBoxes();
});
window.addEventListener("resize", () => {
  refreshWordBoxes();
  renderFivePointTarget();
  renderWritingExercise({ preserveProgress: true });
});

async function startSession() {
  const backendContext = getBackendContext();
  if (!backendContext) return;

  setActiveTab("reading");
  renderSentence({ preserveAnchors: true });
  resetTrackingState({ keepSocket: true, keepAnchors: true });

  els.summaryLine.textContent = "Starting Tobii native mode";
  const nativeReady = await requestNativeMode("reading");
  if (!nativeReady) return;

  startedAt = performance.now();
  metricsActive = true;
  lastSampleAt = null;
  headPoseBaseline = null;
  lastHeadPoseDelta = null;
  els.sessionLine.textContent = "local session pending";
  els.summaryLine.textContent = "Reading";
  connectGazeSocket();

  readingSessionRequest = fetch(apiUrl("/api/reading/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: backendContext.studentId,
      contentType: backendContext.contentType,
      contentId: backendContext.contentId,
      calibrationStatus: WEB_CALIBRATION_ENABLED ? "SUCCESS" : "DISABLED",
      textId: `reading-${Date.now()}`,
      text: els.sentenceInput.value.trim(),
      tobiiProfile: els.tobiiProfile.value.trim() || "Default",
      metadata: {
        prototype: "single-sentence-word-gaze",
        appVersion: APP_VERSION,
        webCalibrationEnabled: WEB_CALIBRATION_ENABLED,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        hitPaddingPx: getHitPadding(),
        fivePointCalibration: getWebCalibrationMetadata()
      }
    })
  })
    .then((response) => response.json())
    .then((session) => {
      sessionId = session.sessionId;
      backendGazeSessionId = session.gazeSessionId || null;
      els.sessionLine.textContent = backendGazeSessionId
        ? `local #${sessionId} / gaze #${backendGazeSessionId}`
        : `local #${sessionId}`;
    })
    .catch((error) => {
      sessionId = null;
      backendGazeSessionId = null;
      els.sessionLine.textContent = "session start failed";
      els.summaryLine.textContent = `Session error: ${error.message}`;
    })
    .finally(() => {
      readingSessionRequest = null;
    });
}

async function saveSession() {
  if (readingSessionRequest) {
    els.summaryLine.textContent = "Waiting for session start...";
    await readingSessionRequest.catch(() => null);
  }
  if (!sessionId) return;
  const backendContext = getBackendContext();
  if (!backendContext) return;

  socket?.close();
  socket = null;
  metricsActive = false;

  const words = wordBoxes.map((word) => ({ ...word.metric }));
  const summary = summarize(words);
  const response = await fetch(apiUrl(`/api/reading/sessions/${sessionId}/metrics`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...backendContext,
      gazeSessionId: backendGazeSessionId,
      words,
      summary
    })
  });
  const result = await response.json();
  rememberBackendPayloadPreview(sessionId, result.payloadPreview);
  const backendText = result.backendSync?.ok
    ? " / backend synced"
    : result.backendSync?.skipped
      ? ""
      : " / backend sync failed";
  els.summaryLine.textContent = `Saved: ${result.savedWordCount} words${backendText}`;
  renderMetrics();
}

function rememberBackendPayloadPreview(localSessionId, payloadPreview) {
  if (!payloadPreview) return;
  const key = "iread-gaze-payload-preview";
  const record = {
    localSessionId,
    savedAt: new Date().toISOString(),
    payloadPreview
  };
  try {
    localStorage.setItem(key, JSON.stringify(record, null, 2));
  } catch {
    // Preview export is only a local debugging aid.
  }
}

function getBackendContext() {
  const studentId = Number(els.studentId.value);
  const contentId = Number(els.contentId.value);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    els.summaryLine.textContent = "Student ID must be a positive number.";
    return null;
  }
  if (!Number.isInteger(contentId) || contentId <= 0) {
    els.summaryLine.textContent = "Backend content ID must be a positive number.";
    return null;
  }
  return {
    studentId,
    contentType: els.contentType.value,
    contentId
  };
}

function getWebCalibrationMetadata() {
  if (!WEB_CALIBRATION_ENABLED) {
    return {
      enabled: false,
      appVersion: APP_VERSION,
      mode: "native-only"
    };
  }

  if (!fivePointModel) return null;
  return {
    enabled: true,
    createdAt: fivePointModel.createdAt,
    pointCount: fivePointModel.points.length,
    mode: fivePointModel.mode
  };
}

function initializeCalibrationMode() {
  if (WEB_CALIBRATION_ENABLED) return;

  fivePointJob = null;
  fivePointModel = null;
  els.calibrationMode.disabled = true;
  els.startFivePointButton.disabled = true;
  els.calibrationTarget.disabled = true;
  els.calibrateButton.disabled = true;
  els.readingTabButton.disabled = false;
  els.writingTabButton.disabled = false;
  els.goReadingButton.disabled = false;
  els.calibrationBadge.textContent = `v${APP_VERSION} 웹 보정 없음`;
  els.calibrationBadge.classList.add("is-ready");
  els.calibrationStatus.textContent = "웹 보정 없이 Tobii native 좌표로 진행합니다.";
  els.calibrationProgress.textContent = "-";
  els.calibrationDot.classList.add("is-idle");
}

function connectGazeSocket() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;

  socket?.close();
  socket = new WebSocket(wsUrl("/gaze"));

  socket.addEventListener("open", () => {
    els.socketState.textContent = "WebSocket: connected";
  });

  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data);
    if (frame.type === "hello") {
      els.socketState.textContent = `WebSocket: connected / ${frame.source}`;
      return;
    }
    if (frame.type === "gaze") consumeGaze(frame);
  });

  socket.addEventListener("close", () => {
    els.socketState.textContent = "WebSocket: closed";
  });

  socket.addEventListener("error", () => {
    els.socketState.textContent = "WebSocket: error";
  });
}

async function startFivePointCalibration() {
  if (!WEB_CALIBRATION_ENABLED) {
    fivePointJob = null;
    fivePointModel = null;
    els.calibrationBadge.textContent = `v${APP_VERSION} 웹 보정 없음`;
    els.calibrationBadge.classList.add("is-ready");
    els.calibrationStatus.textContent = "웹 보정은 비활성화되어 있습니다. Tobii 정식 보정을 사용하세요.";
    els.summaryLine.textContent = "Web calibration disabled; using native Tobii coordinates";
    return;
  }

  setActiveTab("calibration");
  metricsActive = false;
  fivePointModel = null;
  wordAnchors = new Map();
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
  lastSampleAt = null;

  els.readingTabButton.disabled = true;
  els.writingTabButton.disabled = true;
  els.goReadingButton.disabled = true;
  const targets = getCalibrationTargets();
  const mode = getCalibrationMode();
  els.calibrationBadge.textContent = `${mode}점 보정 진행 중`;
  els.calibrationBadge.classList.remove("is-ready");
  els.summaryLine.textContent = `Starting Tobii native mode for ${mode}-point calibration`;

  const nativeReady = await requestNativeMode("calibration");
  if (!nativeReady) return;
  connectGazeSocket();

  fivePointJob = {
    mode,
    targets,
    index: 0,
    samples: [],
    recentSamples: [],
    results: [],
    dwellStartedAt: null
  };
  renderFivePointTarget();
}

async function requestNativeMode(reason) {
  const modeUrl = apiUrl("/api/mode");
  try {
    const response = await fetch(modeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "native" })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.mode === "native") return true;

    const detail = result.detail || result.error || `HTTP ${response.status} from ${modeUrl}`;
    els.calibrationBadge.textContent = "Tobii 연결 필요";
    els.calibrationBadge.classList.remove("is-ready");
    els.calibrationStatus.textContent = `Native Tobii stream failed: ${detail}`;
    els.summaryLine.textContent = `${reason}: native mode failed`;
    return false;
  } catch (error) {
    els.calibrationBadge.textContent = "Tobii 연결 필요";
    els.calibrationBadge.classList.remove("is-ready");
    els.calibrationStatus.textContent = `Native Tobii stream failed: ${error.message} (${modeUrl})`;
    els.summaryLine.textContent = `${reason}: native mode failed`;
    return false;
  }
}

async function openTobiiCalibration() {
  els.summaryLine.textContent = "Opening Tobii calibration app";

  await launchTobiiTarget("eyexEngine");

  const portal = await launchTobiiTarget("portal");
  if (portal.ok) {
    els.calibrationStatus.textContent = `Tobii Eye Tracking Portal 실행 요청 완료: ${portal.path}`;
    return;
  }

  const first = await launchTobiiTarget("configuration");
  if (first.ok) {
    els.calibrationStatus.textContent = `Tobii 공식 보정 앱 실행 요청 완료: ${first.path}`;
    return;
  }

  const second = await launchTobiiTarget("experience");
  if (second.ok) {
    els.calibrationStatus.textContent = `Tobii Experience 실행 요청 완료: ${second.path}`;
    return;
  }

  const third = await launchTobiiTarget("gamehub");
  if (third.ok) {
    els.calibrationStatus.textContent = `Tobii Game Hub 실행 요청 완료: ${third.path}`;
    return;
  }

  els.calibrationStatus.textContent = "Tobii 보정 앱을 열지 못했습니다. config.json의 portal/configuration/experience/gamehub 경로를 확인하세요.";
  els.summaryLine.textContent = third.error || second.error || first.error || portal.error || "Tobii calibration app not found";
}

async function launchTobiiTarget(target) {
  try {
    const response = await fetch(apiUrl("/api/launch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target })
    });
    const result = await response.json();
    return { ok: response.ok && result.ok, ...result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function collectFivePointSample(rawPoint) {
  if (!fivePointJob || !rawPoint) return;

  const now = performance.now();
  const target = getFivePointTargetPosition(fivePointJob.targets[fivePointJob.index]);
  const distance = Math.hypot(rawPoint.x - target.x, rawPoint.y - target.y);
  fivePointJob.recentSamples.push({ ...rawPoint });
  if (fivePointJob.recentSamples.length > 45) fivePointJob.recentSamples.shift();

  if (distance > fivePointHitRadius) {
    fivePointJob.samples = [];
    fivePointJob.dwellStartedAt = null;
    els.calibrationDot.style.transform = "translate(-50%, -50%) scale(1)";
    return;
  }

  if (fivePointJob.dwellStartedAt === null) {
    fivePointJob.dwellStartedAt = now;
    fivePointJob.samples = [];
  }

  fivePointJob.samples.push({ ...rawPoint });
  const elapsed = now - fivePointJob.dwellStartedAt;
  const progress = clampNumber(elapsed / fivePointDwellMs, 0, 1);
  els.calibrationDot.style.transform = `translate(-50%, -50%) scale(${1 - progress * 0.62})`;

  if (elapsed < fivePointDwellMs || fivePointJob.samples.length < 12) return;

  advanceFivePoint(fivePointJob.samples);
}

function advanceFivePointByClick(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!fivePointJob) return;

  const samples = fivePointJob.samples.length >= 5
    ? fivePointJob.samples
    : fivePointJob.recentSamples;
  if (samples.length < 3) {
    els.calibrationStatus.textContent = "시선 샘플을 조금 더 모은 뒤 다시 클릭하세요";
    return;
  }

  advanceFivePoint(samples);
}

function advanceFivePoint(samples) {
  if (!fivePointJob || samples.length === 0) return;

  const target = getFivePointTargetPosition(fivePointJob.targets[fivePointJob.index]);
  const measured = averagePoints(samples);
  fivePointJob.results.push({
    id: fivePointJob.targets[fivePointJob.index].id,
    label: fivePointJob.targets[fivePointJob.index].label,
    target,
    measured,
    residual: {
      x: target.x - measured.x,
      y: target.y - measured.y
    }
  });

  fivePointJob.index += 1;
  fivePointJob.samples = [];
  fivePointJob.recentSamples = [];
  fivePointJob.dwellStartedAt = null;

  if (fivePointJob.index >= fivePointJob.targets.length) {
    finishFivePointCalibration();
    return;
  }

  renderFivePointTarget();
}

function finishFivePointCalibration() {
  const affine = buildAffineTransform(fivePointJob.results);
  const points = fivePointJob.results.map((point) => {
    const affinePoint = applyAffineTransform(point.measured, affine);
    return {
      ...point,
      affineResidual: {
        x: point.target.x - affinePoint.x,
        y: point.target.y - affinePoint.y
      }
    };
  });

  fivePointModel = {
    createdAt: Date.now(),
    mode: fivePointJob.mode,
    points,
    affine
  };
  fivePointJob = null;
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;

  els.calibrationDot.classList.add("is-idle");
  els.calibrationDot.style.transform = "translate(-50%, -50%) scale(1)";
  els.calibrationStatus.textContent = `${fivePointModel.mode}점 보정 완료`;
  els.calibrationProgress.textContent = `${fivePointModel.points.length} / ${fivePointModel.points.length}`;
  els.calibrationBadge.textContent = `${fivePointModel.mode}점 보정 완료`;
  els.calibrationBadge.classList.add("is-ready");
  els.readingTabButton.disabled = false;
  els.writingTabButton.disabled = false;
  els.goReadingButton.disabled = false;
  els.summaryLine.textContent = `${fivePointModel.mode}-point calibration complete`;
}

function renderFivePointTarget() {
  if (!fivePointJob) return;

  const target = fivePointJob.targets[fivePointJob.index];
  const rect = els.calibrationSurface.getBoundingClientRect();
  els.calibrationDot.classList.remove("is-idle");
  els.calibrationDot.style.left = `${rect.width * target.xRatio}px`;
  els.calibrationDot.style.top = `${rect.height * target.yRatio}px`;
  els.calibrationDot.style.transform = "translate(-50%, -50%) scale(1)";
  els.calibrationStatus.textContent = `${target.label} 점을 계속 바라보세요`;
  els.calibrationProgress.textContent = `${fivePointJob.index + 1} / ${fivePointJob.targets.length}`;
}

function getFivePointTargetPosition(target) {
  const rect = els.calibrationSurface.getBoundingClientRect();
  return {
    x: rect.left + rect.width * target.xRatio,
    y: rect.top + rect.height * target.yRatio
  };
}

function getCalibrationMode() {
  return els.calibrationMode.value === "9" ? 9 : 5;
}

function getCalibrationTargets() {
  return getCalibrationMode() === 9 ? ninePointTargets : fivePointTargets;
}

function resetCalibrationModel() {
  if (!WEB_CALIBRATION_ENABLED) {
    initializeCalibrationMode();
    return;
  }

  if (fivePointJob) return;
  fivePointModel = null;
  els.readingTabButton.disabled = true;
  els.writingTabButton.disabled = true;
  els.goReadingButton.disabled = true;
  els.calibrationBadge.textContent = `${getCalibrationMode()}점 보정 필요`;
  els.calibrationBadge.classList.remove("is-ready");
  els.calibrationStatus.textContent = `${getCalibrationMode()}점 보정을 시작하세요`;
  els.calibrationProgress.textContent = `0 / ${getCalibrationMode()}`;
  els.calibrationDot.classList.add("is-idle");
}

function applyFivePointCalibration(rawPoint) {
  if (!fivePointModel || fivePointModel.points.length === 0) return rawPoint;

  const basePoint = fivePointModel.affine
    ? applyAffineTransform(rawPoint, fivePointModel.affine)
    : rawPoint;
  let totalWeight = 0;
  let residualX = 0;
  let residualY = 0;

  for (const point of fivePointModel.points) {
    const distance = Math.hypot(rawPoint.x - point.measured.x, rawPoint.y - point.measured.y);
    const weight = 1 / Math.max(1600, distance * distance);
    const residual = point.affineResidual || point.residual;
    totalWeight += weight;
    residualX += residual.x * weight;
    residualY += residual.y * weight;
  }

  const calibratedPoint = {
    x: basePoint.x + residualX / totalWeight,
    y: basePoint.y + residualY / totalWeight
  };
  const localWeight = getLocalCalibrationWeight(rawPoint);
  return {
    x: rawPoint.x + (calibratedPoint.x - rawPoint.x) * localWeight,
    y: rawPoint.y + (calibratedPoint.y - rawPoint.y) * localWeight
  };
}

function getLocalCalibrationWeight(rawPoint) {
  if (!fivePointModel || fivePointModel.points.length === 0) return 0;

  const xs = fivePointModel.points.map((point) => point.measured.x);
  const ys = fivePointModel.points.map((point) => point.measured.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const marginX = Math.max(160, (maxX - minX) * 0.34);
  const marginY = Math.max(120, (maxY - minY) * 0.34);
  const outsideX = Math.max(minX - rawPoint.x, 0, rawPoint.x - maxX);
  const outsideY = Math.max(minY - rawPoint.y, 0, rawPoint.y - maxY);
  const outsideRatio = Math.max(outsideX / marginX, outsideY / marginY);
  return clampNumber(1 - outsideRatio, 0, 1);
}

function buildAffineTransform(points) {
  if (points.length < 3) return null;

  return {
    x: solveAffineCoefficients(points, "x"),
    y: solveAffineCoefficients(points, "y")
  };
}

function solveAffineCoefficients(points, axis) {
  const normal = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const vector = [0, 0, 0];

  for (const point of points) {
    const row = [point.measured.x, point.measured.y, 1];
    const target = point.target[axis];
    for (let r = 0; r < 3; r += 1) {
      vector[r] += row[r] * target;
      for (let c = 0; c < 3; c += 1) {
        normal[r][c] += row[r] * row[c];
      }
    }
  }

  return solveLinear3(normal, vector) || [axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, 0];
}

function solveLinear3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let bestRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][pivot]) > Math.abs(rows[bestRow][pivot])) bestRow = row;
    }

    if (Math.abs(rows[bestRow][pivot]) < 1e-6) return null;
    [rows[pivot], rows[bestRow]] = [rows[bestRow], rows[pivot]];

    const divisor = rows[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) rows[pivot][col] /= divisor;

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = rows[row][pivot];
      for (let col = pivot; col < 4; col += 1) {
        rows[row][col] -= factor * rows[pivot][col];
      }
    }
  }

  return [rows[0][3], rows[1][3], rows[2][3]];
}

function applyAffineTransform(point, affine) {
  if (!affine) return point;
  return {
    x: affine.x[0] * point.x + affine.x[1] * point.y + affine.x[2],
    y: affine.y[0] * point.x + affine.y[1] * point.y + affine.y[2]
  };
}

function averagePoints(points) {
  const sum = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length
  };
}

function setActiveTab(tab) {
  if (WEB_CALIBRATION_ENABLED && (tab === "reading" || tab === "writing") && !fivePointModel) {
    tab = "calibration";
    els.summaryLine.textContent = "보정을 먼저 완료하세요";
  }

  activeTab = tab;
  const isCalibration = activeTab === "calibration";
  const isReading = activeTab === "reading";
  const isWriting = activeTab === "writing";
  els.calibrationView.classList.toggle("is-hidden", !isCalibration);
  els.readingText.classList.toggle("is-hidden", !isReading);
  els.strokeWritingView.classList.toggle("is-hidden", !isWriting);
  els.calibrationTabButton.classList.toggle("is-active", isCalibration);
  els.readingTabButton.classList.toggle("is-active", isReading);
  els.writingTabButton.classList.toggle("is-active", isWriting);

  if (isReading) {
    renderSentence({ preserveAnchors: true });
    refreshWordBoxes();
  }
  if (isWriting) renderWritingExercise({ preserveProgress: true });
}

function renderWritingExercise(options = {}) {
  const previousIndex = options.preserveProgress ? writingCurrentTarget : 0;
  writingModel = buildWritingModel(getWritingCharacter());
  writingCurrentTarget = Math.min(previousIndex, writingModel.targets.length);
  writingDwellStartedAt = null;

  els.strokeSvg.innerHTML = "";
  for (const stroke of writingModel.strokes) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", getStrokeClass(stroke));
    path.setAttribute("d", strokePathData(stroke.points));
    els.strokeSvg.append(path);
  }
  for (const segment of writingModel.segments) {
    if (segment.targetIndexes.every((index) => index < writingCurrentTarget)) {
      appendCompletedSegmentTrace(segment);
    }
  }

  const activeSegment = getActiveWritingSegment();
  if (activeSegment) {
    appendActiveSegmentTrace(activeSegment);
    appendSegmentDirection(activeSegment);
  }

  for (const target of writingModel.targets) {
    if (!activeSegment || target.segmentIndex !== activeSegment.index) continue;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", getTargetClass(target));
    circle.setAttribute("cx", target.x);
    circle.setAttribute("cy", target.y);
    circle.setAttribute("r", target.index === writingCurrentTarget ? "17" : "13");
    group.append(circle);

    if (target.index === writingCurrentTarget && writingActive) {
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("class", "stroke-progress-ring");
      ring.setAttribute("cx", target.x);
      ring.setAttribute("cy", target.y);
      ring.setAttribute("r", "20");
      ring.setAttribute("stroke-dasharray", "126");
      ring.setAttribute("stroke-dashoffset", "126");
      ring.setAttribute("data-progress-ring", "true");
      group.append(ring);
    }

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "stroke-target-label");
    label.setAttribute("x", target.x);
    label.setAttribute("y", target.y + 4);
    label.textContent = target.phase === "start" ? "S" : "E";
    group.append(label);
    els.strokeSvg.append(group);
  }

  updateWritingStatus();
}

async function startWritingExercise() {
  setActiveTab("writing");
  writingActive = true;
  writingCurrentTarget = 0;
  writingDwellStartedAt = null;
  writingTraceProgress = 0;
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
  renderWritingExercise();

  const nativeReady = await requestNativeMode("writing");
  if (!nativeReady) {
    writingActive = false;
    renderWritingExercise({ preserveProgress: true });
    return;
  }
  connectGazeSocket();
}

function resetWritingExercise() {
  writingActive = false;
  writingCurrentTarget = 0;
  writingDwellStartedAt = null;
  writingTraceProgress = 0;
  renderWritingExercise();
}

function handleWritingGaze(point, now) {
  if (!writingModel || writingModel.targets.length === 0) return;
  if (!writingActive) {
    updateWritingStatus();
    return;
  }

  const target = writingModel.targets[writingCurrentTarget];
  if (!target) return;

  if (target.phase === "end") {
    const activeSegment = getActiveWritingSegment();
    const projected = activeSegment ? projectClientPointOnWritingSegment(point, activeSegment) : null;
    if (
      projected &&
      projected.distance <= writingTraceRadius &&
      projected.progress <= writingTraceProgress + writingTraceMaxJump
    ) {
      writingTraceProgress = Math.max(writingTraceProgress, projected.progress);
      updateWritingTrace(writingTraceProgress);
    }
  }

  const targetPoint = svgPointToClient(target);
  const distance = Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
  if (distance > writingHitRadius) {
    writingDwellStartedAt = null;
    updateWritingProgress(0);
    return;
  }

  if (target.phase === "end" && writingTraceProgress < writingTraceCompleteThreshold) {
    writingDwellStartedAt = null;
    updateWritingProgress(0);
    updateWritingStatus();
    return;
  }

  if (writingDwellStartedAt === null) writingDwellStartedAt = now;
  const progress = clampNumber((now - writingDwellStartedAt) / writingDwellMs, 0, 1);
  updateWritingProgress(progress);
  if (progress < 1) return;

  writingCurrentTarget += 1;
  writingDwellStartedAt = null;
  writingTraceProgress = 0;
  if (writingCurrentTarget >= writingModel.targets.length) {
    writingActive = false;
    writingCurrentTarget = writingModel.targets.length;
    els.summaryLine.textContent = `${writingModel.character} eye stroke complete`;
  }
  renderWritingExercise({ preserveProgress: true });
}

function buildWritingModel(character) {
  const jamos = decomposeForWriting(character);
  const layout = layoutWritingJamos(jamos);
  const strokes = [];
  const segments = [];
  const targets = [];

  layout.forEach((item) => {
    const template = jamoStrokeTemplates[item.jamo] || jamoStrokeTemplates["ㅇ"];
    template.forEach((strokePoints, strokeIndex) => {
      const points = strokePoints.map(([x, y]) => ({
        x: item.x + (x / 100) * item.width,
        y: item.y + (y / 100) * item.height
      }));
      const stroke = {
        index: strokes.length,
        jamo: item.jamo,
        strokeIndex,
        points,
        segmentIndexes: [],
        targetIndexes: []
      };

      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const segment = {
          index: segments.length,
          strokeIndex: stroke.index,
          jamo: item.jamo,
          from: points[pointIndex - 1],
          to: points[pointIndex],
          targetIndexes: []
        };
        stroke.segmentIndexes.push(segment.index);

        if (pointIndex === 1) {
          const startTarget = {
            x: segment.from.x,
            y: segment.from.y,
            phase: "start",
            index: targets.length,
            strokeIndex: stroke.index,
            segmentIndex: segment.index,
            jamo: item.jamo
          };
          segment.targetIndexes.push(startTarget.index);
          stroke.targetIndexes.push(startTarget.index);
          targets.push(startTarget);
        }

        const endTarget = {
          x: segment.to.x,
          y: segment.to.y,
          phase: "end",
          index: targets.length,
          strokeIndex: stroke.index,
          segmentIndex: segment.index,
          jamo: item.jamo
        };
        segment.targetIndexes.push(endTarget.index);
        stroke.targetIndexes.push(endTarget.index);
        targets.push(endTarget);
        segments.push(segment);
      }

      if (points.length === 1) {
        const target = {
          x: points[0].x,
          y: points[0].y,
          phase: "start",
          index: targets.length,
          strokeIndex: stroke.index,
          segmentIndex: null,
          jamo: item.jamo
        };
        stroke.targetIndexes.push(target.index);
        targets.push(target);
      }
      strokes.push(stroke);
    });
  });

  return { character, jamos, strokes, segments, targets };
}

function decomposeForWriting(character) {
  const code = character.codePointAt(0);
  if (Number.isInteger(code) && code >= 0xac00 && code <= 0xd7a3) {
    const offset = code - 0xac00;
    const initial = hangulInitials[Math.floor(offset / 588)];
    const medial = hangulMedials[Math.floor((offset % 588) / 28)];
    const final = hangulFinals[offset % 28];
    return [initial, medial, final].flatMap(expandJamo).filter(Boolean);
  }
  return expandJamo(character);
}

function expandJamo(jamo) {
  if (!jamo) return [];
  return compositeJamo[jamo] ? compositeJamo[jamo].flatMap(expandJamo) : [jamo];
}

function layoutWritingJamos(jamos) {
  const count = Math.max(1, jamos.length);
  const columns = count <= 2 ? count : 2;
  const rows = Math.ceil(count / columns);
  const gap = 8;
  const totalWidth = count === 1 ? 210 : 220;
  const totalHeight = rows === 1 ? 150 : 210;
  const cellWidth = (totalWidth - gap * (columns - 1)) / columns;
  const cellHeight = (totalHeight - gap * (rows - 1)) / rows;
  const startX = (320 - totalWidth) / 2;
  const startY = (320 - totalHeight) / 2;

  return jamos.map((jamo, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      jamo,
      x: startX + col * (cellWidth + gap),
      y: startY + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight
    };
  });
}

function strokePathData(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${roundSvg(point.x)} ${roundSvg(point.y)}`).join(" ");
}

function getStrokeClass(stroke) {
  const done = stroke.targetIndexes.every((index) => index < writingCurrentTarget);
  const active = stroke.targetIndexes.includes(writingCurrentTarget);
  return `stroke-guide${done ? " is-done" : ""}${active ? " is-active" : ""}`;
}

function getTargetClass(target) {
  if (target.index < writingCurrentTarget) return "stroke-target is-done";
  if (target.index === writingCurrentTarget) return "stroke-target is-active";
  return "stroke-target is-pending";
}

function appendSegmentDirection(segment) {
  const start = segment.from;
  const end = segment.to;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("class", "stroke-direction-line");
  line.setAttribute("d", `M ${roundSvg(start.x)} ${roundSvg(start.y)} L ${roundSvg(end.x)} ${roundSvg(end.y)}`);
  els.strokeSvg.append(line);

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const arrowLength = 18;
  const wing = Math.PI / 6;
  const left = {
    x: end.x - Math.cos(angle - wing) * arrowLength,
    y: end.y - Math.sin(angle - wing) * arrowLength
  };
  const right = {
    x: end.x - Math.cos(angle + wing) * arrowLength,
    y: end.y - Math.sin(angle + wing) * arrowLength
  };
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrow.setAttribute("class", "stroke-direction-arrow");
  arrow.setAttribute(
    "d",
    `M ${roundSvg(left.x)} ${roundSvg(left.y)} L ${roundSvg(end.x)} ${roundSvg(end.y)} L ${roundSvg(right.x)} ${roundSvg(right.y)}`
  );
  els.strokeSvg.append(arrow);
}

function appendActiveSegmentTrace(segment) {
  const target = writingModel.targets[writingCurrentTarget];
  if (!target || target.phase !== "end" || writingTraceProgress <= 0) return;

  const trace = document.createElementNS("http://www.w3.org/2000/svg", "path");
  trace.setAttribute("class", "stroke-trace is-active");
  trace.setAttribute("d", strokePathData([segment.from, segment.to]));
  trace.setAttribute("pathLength", "1");
  trace.setAttribute("stroke-dasharray", "1");
  trace.setAttribute("stroke-dashoffset", String(1 - writingTraceProgress));
  els.strokeSvg.append(trace);
}

function appendCompletedSegmentTrace(segment) {
  const trace = document.createElementNS("http://www.w3.org/2000/svg", "path");
  trace.setAttribute("class", "stroke-trace");
  trace.setAttribute("d", strokePathData([segment.from, segment.to]));
  els.strokeSvg.append(trace);
}

function getActiveWritingStroke() {
  return writingModel?.strokes.find((stroke) => stroke.targetIndexes.includes(writingCurrentTarget)) || null;
}

function getActiveWritingSegment() {
  const target = writingModel?.targets[writingCurrentTarget];
  if (!target || target.segmentIndex === null) return null;
  return writingModel?.segments[target.segmentIndex] || null;
}

function svgPointToClient(point) {
  const rect = els.strokeSvg.getBoundingClientRect();
  return {
    x: rect.left + (point.x / 320) * rect.width,
    y: rect.top + (point.y / 320) * rect.height
  };
}

function clientPointToSvg(point) {
  const rect = els.strokeSvg.getBoundingClientRect();
  return {
    x: ((point.x - rect.left) / rect.width) * 320,
    y: ((point.y - rect.top) / rect.height) * 320
  };
}

function projectClientPointOnWritingSegment(point, segment) {
  const svgPoint = clientPointToSvg(point);
  const projected = projectPointOnSegment(svgPoint, segment.from, segment.to);
  return {
    distance: projected.distance,
    progress: projected.t
  };
}

function projectPointOnSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : clampNumber(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared, 0, 1);
  const x = from.x + dx * t;
  const y = from.y + dy * t;
  return {
    t,
    distance: Math.hypot(point.x - x, point.y - y)
  };
}

function updateWritingProgress(progress) {
  const ring = els.strokeSvg.querySelector("[data-progress-ring='true']");
  if (!ring) return;
  ring.setAttribute("stroke-dashoffset", String(126 - progress * 126));
}

function updateWritingTrace(progress) {
  const trace = els.strokeSvg.querySelector(".stroke-trace.is-active");
  if (!trace) {
    renderWritingExercise({ preserveProgress: true });
    return;
  }
  trace.setAttribute("stroke-dashoffset", String(1 - progress));
}

function updateWritingStatus() {
  if (!writingModel) return;
  const total = writingModel.targets.length;
  const current = Math.min(writingCurrentTarget, total);
  const next = writingModel.targets[writingCurrentTarget];
  const stepName = next?.phase === "start" ? "start" : "end";
  const label = next ? `${next.jamo} ${stepName} ${current + 1}/${total}` : `${writingModel.character} complete`;
  els.writingStatus.textContent = writingActive ? label : `${writingModel.character}: ${current}/${total}`;
  els.strokeInstruction.textContent = writingActive
    ? `Look at the ${stepName} point, then follow the yellow arrow.`
    : `Target: ${writingModel.character}`;
}

function getWritingCharacter() {
  const value = els.writingChar.value.trim();
  return value ? Array.from(value)[0] : "가";
}

function roundSvg(value) {
  return Math.round(value * 10) / 10;
}

function consumeGaze(frame) {
  const now = performance.now();
  const source = frame.source || "unknown";
  els.trackerState.textContent = `Tracker: ${source} / ${frame.valid ? "valid" : "invalid"} / ${frame.presence ? "present" : "away"}`;

  if (!frame.valid) {
    invalidStreak += 1;
    lastSampleAt = now;
    candidate = null;
    candidateHits = 0;
    if (invalidStreak >= smoothingResetRejectCount) resetGazeStabilizer();
    els.gazeCursor.style.opacity = invalidStreak > 8 ? "0.12" : "0.25";
    return;
  }
  invalidStreak = 0;

  if (isNoisyGazeFrame(frame)) {
    rejectGazeFrame(frame.clamped ? "clamped" : "unstable", now);
    return;
  }

  const headPoseState = updateHeadPoseState(frame);
  if ((metricsActive || writingActive) && headPoseState?.unstable) {
    rejectGazeFrame(headPoseState.reason, now);
    return;
  }

  const point = toClientPoint(frame);
  updateDebugLine(frame, point, null);
  if (fivePointJob) {
    if (!isNativeGazeFrame(frame)) {
      els.calibrationStatus.textContent = `Native Tobii stream required. Current source: ${source}`;
      els.summaryLine.textContent = "Calibration paused until Tobii native stream is active";
      els.gazeCursor.style.opacity = "0.12";
      lastSampleAt = now;
      return;
    }
    collectFivePointSample(lastPointWithoutOffset);
    showGazeCursor(point, 0.78);
    lastSampleAt = now;
    return;
  }

  const calibrating = Boolean(calibrationJob);
  collectCalibrationSample();
  if (calibrating) {
    showGazeCursor(point, 0.82);
    lastSampleAt = now;
    return;
  }

  if (isUnsafePoint(point)) {
    rejectGazeFrame("out-of-view", now);
    return;
  }

  const accepted = stabilizePoint(point);
  if (!accepted) {
    rejectGazeFrame("jump", now);
    return;
  }

  rejectedGazeStreak = 0;
  showGazeCursor(accepted, 0.92);
  if (activeTab === "writing") {
    handleWritingGaze(accepted, now);
    updateDebugLine(frame, accepted, null);
    lastSampleAt = now;
    return;
  }

  const word = hitTestWord(accepted.x, accepted.y);
  updateDebugLine(frame, accepted, word);
  if (!word) {
    lastSampleAt = now;
    return;
  }

  if (!metricsActive) {
    lastSampleAt = now;
    return;
  }

  markActiveWord(word.index);

  const delta = lastSampleAt === null ? 0 : Math.min(now - lastSampleAt, 120);
  const metric = word.metric;
  metric.dwellMs += Math.round(delta);
  metric.lastSeenMs = Date.now();
  if (metric.firstSeenMs === null) metric.firstSeenMs = metric.lastSeenMs;

  if (lastWordIndex !== word.index) {
    metric.visitCount += 1;
    if (word.index < maxWordIndexSeen) {
      metric.regressionCount += 1;
      word.element.classList.add("regressed");
    }
    lastWordIndex = word.index;
    maxWordIndexSeen = Math.max(maxWordIndexSeen, word.index);
  }

  lastSampleAt = now;
  updateSummary();
  renderMetrics();
}

function isNativeGazeFrame(frame) {
  return frame.source === "tobii";
}

function isNoisyGazeFrame(frame) {
  if (frame.presence === false) return true;
  if (frame.clamped === true) return true;
  if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y)) return true;

  const edgeInset = 0.006;
  return (
    frame.x <= edgeInset ||
    frame.x >= 1 - edgeInset ||
    frame.y <= edgeInset ||
    frame.y >= 1 - edgeInset
  );
}

function updateHeadPoseState(frame) {
  const pose = getHeadPose(frame);
  if (!pose) {
    lastHeadPoseDelta = null;
    return null;
  }

  if (!headPoseBaseline) {
    headPoseBaseline = pose;
    lastHeadPoseDelta = {
      yaw: 0,
      pitch: 0,
      roll: 0,
      x: 0,
      y: 0,
      z: 0,
      unstable: false,
      reason: "head-stable"
    };
    return lastHeadPoseDelta;
  }

  const delta = {
    yaw: Math.abs(pose.yaw - headPoseBaseline.yaw),
    pitch: Math.abs(pose.pitch - headPoseBaseline.pitch),
    roll: Math.abs(pose.roll - headPoseBaseline.roll),
    x: Number.isFinite(pose.x) && Number.isFinite(headPoseBaseline.x) ? Math.abs(pose.x - headPoseBaseline.x) : 0,
    y: Number.isFinite(pose.y) && Number.isFinite(headPoseBaseline.y) ? Math.abs(pose.y - headPoseBaseline.y) : 0,
    z: Number.isFinite(pose.z) && Number.isFinite(headPoseBaseline.z) ? Math.abs(pose.z - headPoseBaseline.z) : 0,
    unstable: false,
    reason: "head-stable"
  };

  const rotationMoved = (
    delta.yaw > headRotationLimitDeg ||
    delta.pitch > headRotationLimitDeg ||
    delta.roll > headRotationLimitDeg
  );
  const positionMoved = hasComparableHeadPosition(pose, headPoseBaseline) && (
    delta.x > headPositionLimit ||
    delta.y > headPositionLimit ||
    delta.z > headPositionLimit
  );

  delta.unstable = rotationMoved || positionMoved;
  delta.reason = delta.unstable ? "head-moved" : "head-stable";
  lastHeadPoseDelta = delta;
  return delta;
}

function getHeadPose(frame) {
  if (frame.headPoseValid === false) return null;
  if (
    !Number.isFinite(frame.headYawDeg) ||
    !Number.isFinite(frame.headPitchDeg) ||
    !Number.isFinite(frame.headRollDeg)
  ) {
    return null;
  }

  return {
    yaw: Number(frame.headYawDeg),
    pitch: Number(frame.headPitchDeg),
    roll: Number(frame.headRollDeg),
    x: Number.isFinite(frame.headX) ? Number(frame.headX) : null,
    y: Number.isFinite(frame.headY) ? Number(frame.headY) : null,
    z: Number.isFinite(frame.headZ) ? Number(frame.headZ) : null
  };
}

function hasComparableHeadPosition(current, baseline) {
  return [current.x, current.y, current.z, baseline.x, baseline.y, baseline.z]
    .every((value) => Number.isFinite(value) && Math.abs(value) <= headPositionComparableRange);
}

function rejectGazeFrame(reason, now) {
  droppedFrames += 1;
  rejectedGazeStreak += 1;
  if (rejectedGazeStreak >= smoothingResetRejectCount) resetGazeStabilizer();
  els.trackerState.textContent += ` / ${reason} ${droppedFrames}`;
  els.gazeCursor.style.opacity = rejectedGazeStreak >= smoothingResetRejectCount ? "0.10" : "0.22";
  lastSampleAt = now;
}

function resetGazeStabilizer() {
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
}

function toClientPoint(frame) {
  const rawPoint = toClientPointWithoutOffset(frame);
  lastPointWithoutOffset = rawPoint;
  const point = WEB_CALIBRATION_ENABLED ? applyFivePointCalibration(rawPoint) : rawPoint;
  return {
    x: point.x + Number(els.offsetX.value),
    y: point.y + Number(els.offsetY.value)
  };
}

function toClientPointWithoutOffset(frame) {
  const xNorm = els.flipX.checked ? 1 - frame.x : frame.x;
  const yNorm = els.flipY.checked ? 1 - frame.y : frame.y;

  if (els.coordSource.value === "screen") {
    if (Number.isFinite(frame.screenX) && Number.isFinite(frame.screenY)) {
      const screenPoint = applyNativeScreenFlip(frame);
      const chromeLeft = document.fullscreenElement
        ? window.screenX
        : window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2);
      const chromeTop = document.fullscreenElement
        ? window.screenY
        : window.screenY + Math.max(0, window.outerHeight - window.innerHeight);

      return {
        x: screenPoint.x - chromeLeft,
        y: screenPoint.y - chromeTop
      };
    }

    const screenX = xNorm * window.screen.width;
    const screenY = yNorm * window.screen.height;
    const chromeLeft = document.fullscreenElement
      ? window.screenX
      : window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const chromeTop = document.fullscreenElement
      ? window.screenY
      : window.screenY + Math.max(0, window.outerHeight - window.innerHeight);

    return {
      x: screenX - chromeLeft,
      y: screenY - chromeTop
    };
  }

  return {
    x: xNorm * window.innerWidth,
    y: yNorm * window.innerHeight
  };
}

function applyNativeScreenFlip(frame) {
  let x = frame.screenX;
  let y = frame.screenY;

  if (els.flipX.checked && Number.isFinite(frame.trackingLeft) && Number.isFinite(frame.trackingRight)) {
    x = frame.trackingRight - (frame.screenX - frame.trackingLeft);
  }

  if (els.flipY.checked && Number.isFinite(frame.trackingTop) && Number.isFinite(frame.trackingBottom)) {
    y = frame.trackingBottom - (frame.screenY - frame.trackingTop);
  }

  return { x, y };
}

function stabilizePoint(measured) {
  if (!smoothPoint) {
    smoothPoint = measured;
    return smoothPoint;
  }

  const distance = Math.hypot(measured.x - smoothPoint.x, measured.y - smoothPoint.y);
  const maxDimension = Math.max(window.innerWidth, window.innerHeight);
  const jumpThreshold = maxDimension * 0.28;
  const candidateThreshold = maxDimension * 0.11;

  if (distance > jumpThreshold) {
    if (candidate && Math.hypot(measured.x - candidate.x, measured.y - candidate.y) < candidateThreshold) {
      candidateHits += 1;
    } else {
      candidate = measured;
      candidateHits = 1;
    }

    if (candidateHits < 2) return null;
  } else {
    candidate = null;
    candidateHits = 0;
  }

  const alpha = distance > jumpThreshold ? 0.22 : 0.42;
  smoothPoint = {
    x: smoothPoint.x + (measured.x - smoothPoint.x) * alpha,
    y: smoothPoint.y + (measured.y - smoothPoint.y) * alpha
  };
  return smoothPoint;
}

function isUnsafePoint(point) {
  const marginX = Math.max(36, window.innerWidth * 0.035);
  const marginY = Math.max(36, window.innerHeight * 0.035);
  if (
    point.x < -marginX ||
    point.x > window.innerWidth + marginX ||
    point.y < -marginY ||
    point.y > window.innerHeight + marginY
  ) {
    return true;
  }
  return false;
}

function clampPointToRect(point, rect, inset) {
  return {
    x: Math.max(rect.left + inset, Math.min(point.x, rect.right - inset)),
    y: Math.max(rect.top + inset, Math.min(point.y, rect.bottom - inset))
  };
}

function getWordCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function showGazeCursor(point, opacity = 0.92) {
  els.gazeCursor.style.opacity = String(opacity);
  els.gazeCursor.style.left = `${point.x}px`;
  els.gazeCursor.style.top = `${point.y}px`;
}

function updateDebugLine(frame, point, word) {
  if (!els.debugLine || !point) return;

  const nearest = getNearestWord(point.x, point.y);
  const raw = lastPointWithoutOffset
    ? `clientRaw ${Math.round(lastPointWithoutOffset.x)},${Math.round(lastPointWithoutOffset.y)}`
    : "clientRaw -";
  const sdkRaw = Number.isFinite(frame.rawX) && Number.isFinite(frame.rawY)
    ? `sdkRaw ${roundDebug(frame.rawX)},${roundDebug(frame.rawY)} ${frame.rawUnit || ""}`
    : "sdkRaw -";
  const screen = Number.isFinite(frame.screenX) && Number.isFinite(frame.screenY)
    ? `screen ${Math.round(frame.screenX)},${Math.round(frame.screenY)}`
    : "screen -";
  const bounds = Number.isFinite(frame.trackingLeft) && Number.isFinite(frame.trackingRight)
    ? `track ${Math.round(frame.trackingLeft)},${Math.round(frame.trackingTop)}-${Math.round(frame.trackingRight)},${Math.round(frame.trackingBottom)}`
    : "track -";
  const localCal = WEB_CALIBRATION_ENABLED
    ? roundDebug(getLocalCalibrationWeight(lastPointWithoutOffset || point))
    : "off";
  const quality = `clamped ${frame.clamped === true ? "yes" : "no"} | localCal ${localCal}`;
  const head = formatHeadDebug(frame);
  const selected = word ? word.text : "-";
  const nearestText = nearest ? `${nearest.word.text} ${Math.round(nearest.distance)}px` : "-";

  els.debugLine.textContent = `${sdkRaw} | ${screen} | ${raw} | client ${Math.round(point.x)},${Math.round(point.y)} | hit ${selected} | near ${nearestText} | ${quality} | ${head} | ${bounds}`;
}

function roundDebug(value) {
  return Math.abs(value) < 10 ? Math.round(value * 1000) / 1000 : Math.round(value);
}

function formatHeadDebug(frame) {
  const pose = getHeadPose(frame);
  if (!pose) return "head -";

  const current = `head r ${roundDebug(pose.yaw)},${roundDebug(pose.pitch)},${roundDebug(pose.roll)} p ${roundDebug(pose.x)},${roundDebug(pose.y)},${roundDebug(pose.z)}`;
  if (!lastHeadPoseDelta) return current;

  return `${current} d ${roundDebug(lastHeadPoseDelta.yaw)},${roundDebug(lastHeadPoseDelta.pitch)},${roundDebug(lastHeadPoseDelta.roll)} ${lastHeadPoseDelta.reason}`;
}

function getNearestWord(x, y) {
  let nearest = null;
  for (const word of wordBoxes) {
    const nearestX = Math.max(word.rect.left, Math.min(x, word.rect.right));
    const nearestY = Math.max(word.rect.top, Math.min(y, word.rect.bottom));
    const distance = Math.hypot(x - nearestX, y - nearestY);
    if (!nearest || distance < nearest.distance) nearest = { word, distance };
  }
  return nearest;
}

function hitTestWord(x, y) {
  const padding = getHitPadding();
  const anchored = hitTestAnchoredWord();
  if (anchored) return anchored;

  const direct = wordBoxes.find((word) => {
    const rect = word.rect;
    return (
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    );
  });
  if (direct) return direct;

  let nearest = null;
  for (const word of wordBoxes) {
    const rect = word.rect;
    const centerY = rect.top + rect.height / 2;
    if (Math.abs(y - centerY) > Math.max(82, padding * 2.4)) continue;

    const nearestX = Math.max(rect.left, Math.min(x, rect.right));
    const nearestY = Math.max(rect.top, Math.min(y, rect.bottom));
    const distance = Math.hypot(x - nearestX, y - nearestY);
    if (!nearest || distance < nearest.distance) nearest = { word, distance };
  }

  const nearestLimit = Math.max(220, padding * 5.5);
  if (nearest && nearest.distance <= nearestLimit) return applySequenceAssist(nearest.word, x, y);

  const rightEdge = hitTestRightEdgeWord(x, y);
  if (rightEdge) return rightEdge;

  if (!nearest || nearest.distance > Math.max(520, padding * 8)) return null;
  return applySequenceAssist(nearest.word, x, y);
}

function hitTestRightEdgeWord(x, y) {
  const textRect = els.readingText.getBoundingClientRect();
  if (x < textRect.right - Math.max(260, getHitPadding() * 5)) return null;

  const lines = [];
  for (const word of wordBoxes) {
    const centerY = word.rect.top + word.rect.height / 2;
    let line = lines.find((item) => Math.abs(item.centerY - centerY) < word.rect.height * 0.55);
    if (!line) {
      line = { centerY, words: [] };
      lines.push(line);
    }
    line.words.push(word);
  }

  let closestLine = null;
  for (const line of lines) {
    const distanceY = Math.abs(y - line.centerY);
    if (distanceY > Math.max(180, getHitPadding() * 3.2)) continue;
    if (!closestLine || distanceY < closestLine.distanceY) closestLine = { ...line, distanceY };
  }
  if (!closestLine) return null;

  const rightmost = closestLine.words.reduce((best, word) => (
    !best || word.rect.right > best.rect.right ? word : best
  ), null);
  return rightmost ? applySequenceAssist(rightmost, x, y) : null;
}

function hitTestAnchoredWord() {
  if (!lastPointWithoutOffset || wordAnchors.size === 0) return null;

  let nearest = null;
  for (const [index, anchor] of wordAnchors) {
    const word = wordBoxes[index];
    if (!word) continue;

    const distance = Math.hypot(
      lastPointWithoutOffset.x - anchor.x,
      lastPointWithoutOffset.y - anchor.y
    );
    if (distance <= anchor.radius && (!nearest || distance < nearest.distance)) {
      nearest = { word, distance };
    }
  }

  return nearest ? nearest.word : null;
}

function applySequenceAssist(candidateWord, x, y) {
  if (!els.sequenceAssist.checked || lastWordIndex === null) return candidateWord;

  const current = wordBoxes[lastWordIndex];
  const next = wordBoxes[lastWordIndex + 1];
  const previous = wordBoxes[lastWordIndex - 1];

  const indexGap = candidateWord.index - lastWordIndex;
  if (Math.abs(indexGap) > 2) return candidateWord;

  if (next && current && isSameLine(current.rect, next.rect)) {
    const lineTop = Math.min(current.rect.top, next.rect.top) - getHitPadding() * 2;
    const lineBottom = Math.max(current.rect.bottom, next.rect.bottom) + getHitPadding() * 2;
    const currentRightZone = current.rect.left + current.rect.width * 0.56;
    const nextApproachZone = next.rect.left - Math.max(180, getHitPadding() * 5);

    if (y >= lineTop && y <= lineBottom && x >= currentRightZone && x >= nextApproachZone) {
      return next;
    }
  }

  if (previous && current && isSameLine(previous.rect, current.rect)) {
    const lineTop = Math.min(previous.rect.top, current.rect.top) - getHitPadding() * 2;
    const lineBottom = Math.max(previous.rect.bottom, current.rect.bottom) + getHitPadding() * 2;
    const currentLeftZone = current.rect.left + current.rect.width * 0.34;
    const previousApproachZone = previous.rect.right + Math.max(140, getHitPadding() * 4);

    if (y >= lineTop && y <= lineBottom && x <= currentLeftZone && x <= previousApproachZone) {
      return previous;
    }
  }

  return candidateWord;
}

function isSameLine(a, b) {
  const centerA = a.top + a.height / 2;
  const centerB = b.top + b.height / 2;
  return Math.abs(centerA - centerB) <= Math.max(a.height, b.height) * 0.55;
}

function renderSentence(options = {}) {
  const text = els.sentenceInput.value.trim();
  const tokens = text ? text.split(/\s+/) : [];
  const previousAnchors = options.preserveAnchors ? new Map(wordAnchors) : new Map();
  wordAnchors = new Map();
  els.readingText.innerHTML = "";
  tokens.forEach((token, index) => {
    const span = document.createElement("span");
    span.className = "word-token";
    span.dataset.index = String(index + 1);
    span.textContent = token;
    els.readingText.append(span);
  });
  refreshWordBoxes();
  if (options.preserveAnchors) {
    for (const [index, anchor] of previousAnchors) {
      const word = wordBoxes[index];
      if (!word || (anchor.text && anchor.text !== word.text)) continue;
      wordAnchors.set(index, anchor);
      word.element.classList.add("calibrated");
    }
  }
  renderCalibrationTargets();
}

function refreshWordBoxes() {
  const previous = new Map(wordBoxes.map((word) => [word.index, word.metric]));
  wordBoxes = Array.from(document.querySelectorAll(".word-token")).map((element, index) => ({
    element,
    index,
    text: element.textContent || "",
    rect: element.getBoundingClientRect(),
    metric: previous.get(index) || {
      index,
      text: element.textContent || "",
      dwellMs: 0,
      visitCount: 0,
      regressionCount: 0,
      firstSeenMs: null,
      lastSeenMs: null,
      metadata: {}
    }
  }));
}

function markActiveWord(index) {
  for (const word of wordBoxes) {
    word.element.classList.toggle("active", word.index === index);
    if (word.index === index) word.element.classList.add("visited");
  }
  const word = wordBoxes[index];
  els.currentWord.textContent = word ? `Word: ${word.text}` : "Word: -";
}

function renderMetrics() {
  els.metricsTable.innerHTML = "";
  for (const word of wordBoxes) {
    const row = document.createElement("div");
    row.className = "metric-row";
    row.innerHTML = `
      <strong>${escapeHtml(word.text)}</strong>
      <span>${word.metric.dwellMs}ms</span>
      <span>v ${word.metric.visitCount}</span>
      <span>r ${word.metric.regressionCount}</span>
    `;
    els.metricsTable.append(row);
  }
}

function summarize(words) {
  const totalDwellMs = words.reduce((sum, word) => sum + word.dwellMs, 0);
  const visitedWords = words.filter((word) => word.visitCount > 0).length;
  const totalRegressionCount = words.reduce((sum, word) => sum + word.regressionCount, 0);
  return {
    wordCount: words.length,
    visitedWords,
    skippedWords: words.filter((word) => word.visitCount === 0).map((word) => word.text),
    totalDwellMs,
    totalVisitCount: words.reduce((sum, word) => sum + word.visitCount, 0),
    totalRegressionCount,
    readingTimeMs: startedAt ? Math.round(performance.now() - startedAt) : 0
  };
}

function updateSummary() {
  const summary = summarize(wordBoxes.map((word) => word.metric));
  els.summaryLine.textContent = `${summary.visitedWords}/${summary.wordCount} words | regressions ${summary.totalRegressionCount}`;
}

function resetTrackingState(options = {}) {
  if (!options.keepSocket) {
    socket?.close();
    socket = null;
  }
  sessionId = null;
  backendGazeSessionId = null;
  metricsActive = false;
  lastSampleAt = null;
  lastWordIndex = null;
  maxWordIndexSeen = -1;
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
  invalidStreak = 0;
  droppedFrames = 0;
  rejectedGazeStreak = 0;
  startedAt = null;
  calibrationJob = null;
  headPoseBaseline = null;
  lastHeadPoseDelta = null;
  if (!options.keepAnchors) wordAnchors = new Map();
  resetWordMetrics();
  els.currentWord.textContent = "Word: -";
}

function resetWordMetrics() {
  for (const word of wordBoxes) {
    word.metric = {
      index: word.index,
      text: word.text,
      dwellMs: 0,
      visitCount: 0,
      regressionCount: 0,
      firstSeenMs: null,
      lastSeenMs: null,
      metadata: {}
    };
    word.element.classList.remove("active", "visited", "regressed");
    word.element.classList.toggle("calibrated", wordAnchors.has(word.index));
  }
  renderMetrics();
}

async function enterFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  }
  refreshWordBoxes();
  renderFivePointTarget();
}

function syncCalibrationLabels() {
  els.offsetXLabel.textContent = `${els.offsetX.value}px`;
  els.offsetYLabel.textContent = `${els.offsetY.value}px`;
  els.paddingLabel.textContent = `${els.hitPadding.value}px`;
}

function renderCalibrationTargets() {
  els.calibrationTarget.innerHTML = "";
  for (const word of wordBoxes) {
    const option = document.createElement("option");
    option.value = String(word.index);
    option.textContent = `${word.index + 1}. ${word.text}`;
    els.calibrationTarget.append(option);
  }
}

async function calibrateToSelectedWord() {
  if (!WEB_CALIBRATION_ENABLED) {
    els.summaryLine.textContent = "Word calibration disabled in v1.0.1";
    return;
  }

  const selectedIndex = Number(els.calibrationTarget.value);
  renderSentence({ preserveAnchors: true });
  els.calibrationTarget.value = String(selectedIndex);
  const word = wordBoxes[selectedIndex];
  if (!word) return;

  els.summaryLine.textContent = "Starting Tobii native mode for calibration";
  const nativeReady = await requestNativeMode("word calibration");
  if (!nativeReady) return;
  connectGazeSocket();

  calibrationJob = {
    word,
    samples: [],
    startedAt: performance.now()
  };
  els.summaryLine.textContent = `Look at ${word.text} for local calibration`;
}

function collectCalibrationSample() {
  if (!calibrationJob || !lastPointWithoutOffset) return;

  calibrationJob.samples.push({ ...lastPointWithoutOffset });
  const elapsed = performance.now() - calibrationJob.startedAt;
  if (elapsed < 800 && calibrationJob.samples.length < 18) return;

  if (calibrationJob.samples.length < 4) {
    els.summaryLine.textContent = "Calibration failed: not enough gaze samples";
    calibrationJob = null;
    return;
  }

  const word = calibrationJob.word;
  const average = calibrationJob.samples.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  average.x /= calibrationJob.samples.length;
  average.y /= calibrationJob.samples.length;

  const radius = Math.max(180, getHitPadding() * 4.4);
  wordAnchors = new Map();
  for (const item of wordBoxes) {
    item.element.classList.remove("calibrated");
  }
  wordAnchors.set(word.index, {
    x: average.x,
    y: average.y,
    radius,
    text: word.text
  });
  word.element.classList.add("calibrated");
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
  els.summaryLine.textContent = `Local calibrated: ${word.text}`;
  calibrationJob = null;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getHitPadding() {
  return Number(els.hitPadding.value);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
