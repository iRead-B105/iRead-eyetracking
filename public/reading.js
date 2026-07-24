"use strict";

const els = {
  calibrationView: document.querySelector("#calibrationView"),
  calibrationSurface: document.querySelector("#calibrationSurface"),
  calibrationDot: document.querySelector("#calibrationDot"),
  calibrationStatus: document.querySelector("#calibrationStatus"),
  calibrationProgress: document.querySelector("#calibrationProgress"),
  readingText: document.querySelector("#readingText"),
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
  sentenceInput: document.querySelector("#sentenceInput"),
  calibrationTabButton: document.querySelector("#calibrationTabButton"),
  readingTabButton: document.querySelector("#readingTabButton"),
  calibrationBadge: document.querySelector("#calibrationBadge"),
  startFivePointButton: document.querySelector("#startFivePointButton"),
  goReadingButton: document.querySelector("#goReadingButton"),
  startButton: document.querySelector("#startButton"),
  saveButton: document.querySelector("#saveButton"),
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

let socket = null;
let sessionId = null;
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
let lastPointWithoutOffset = null;
let calibrationJob = null;
let wordAnchors = new Map();
let metricsActive = false;
let activeTab = "calibration";
let fivePointJob = null;
let fivePointModel = null;

const fivePointTargets = [
  { id: "center", label: "중앙", xRatio: 0.5, yRatio: 0.5 },
  { id: "top-left", label: "좌상단", xRatio: 0.17, yRatio: 0.18 },
  { id: "top-right", label: "우상단", xRatio: 0.83, yRatio: 0.18 },
  { id: "bottom-left", label: "좌하단", xRatio: 0.17, yRatio: 0.82 },
  { id: "bottom-right", label: "우하단", xRatio: 0.83, yRatio: 0.82 }
];
const fivePointDwellMs = 1050;
const fivePointHitRadius = 320;

setActiveTab("calibration");
renderSentence();
renderMetrics();
syncCalibrationLabels();

els.calibrationTabButton.addEventListener("click", () => setActiveTab("calibration"));
els.readingTabButton.addEventListener("click", () => setActiveTab("reading"));
els.startFivePointButton.addEventListener("click", startFivePointCalibration);
els.calibrationDot.addEventListener("click", advanceFivePointByClick);
els.goReadingButton.addEventListener("click", () => setActiveTab("reading"));
els.startButton.addEventListener("click", startSession);
els.saveButton.addEventListener("click", saveSession);
els.fullscreenButton.addEventListener("click", enterFullscreen);
els.calibrateButton.addEventListener("click", calibrateToSelectedWord);
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
});

async function startSession() {
  if (!fivePointModel) {
    setActiveTab("calibration");
    els.summaryLine.textContent = "5점 보정을 먼저 완료하세요";
    return;
  }

  setActiveTab("reading");
  renderSentence({ preserveAnchors: true });
  resetTrackingState({ keepSocket: true, keepAnchors: true });

  els.summaryLine.textContent = "Starting Tobii native mode";
  await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "native" })
  });

  const response = await fetch("/api/reading/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: els.studentId.value.trim() || "student-demo",
      textId: `reading-${Date.now()}`,
      text: els.sentenceInput.value.trim(),
      tobiiProfile: els.tobiiProfile.value.trim() || "Default",
      metadata: {
        prototype: "single-sentence-word-gaze",
        viewport: { width: window.innerWidth, height: window.innerHeight },
        hitPaddingPx: getHitPadding(),
        fivePointCalibration: {
          createdAt: fivePointModel.createdAt,
          pointCount: fivePointModel.points.length
        }
      }
    })
  });
  const session = await response.json();
  sessionId = session.sessionId;
  startedAt = performance.now();
  metricsActive = true;
  lastSampleAt = null;
  els.sessionLine.textContent = `session #${sessionId}`;
  els.summaryLine.textContent = "Reading";

  connectGazeSocket();
}

async function saveSession() {
  if (!sessionId) return;
  socket?.close();
  socket = null;
  metricsActive = false;

  const words = wordBoxes.map((word) => ({ ...word.metric }));
  const summary = summarize(words);
  const response = await fetch(`/api/reading/sessions/${sessionId}/metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words, summary })
  });
  const result = await response.json();
  els.summaryLine.textContent = `Saved: ${result.savedWordCount} words`;
  renderMetrics();
}

function connectGazeSocket() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;

  socket?.close();
  socket = new WebSocket(`ws://${location.host}/gaze`);

  socket.addEventListener("open", () => {
    els.socketState.textContent = "WebSocket: connected";
  });

  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data);
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
  setActiveTab("calibration");
  metricsActive = false;
  fivePointModel = null;
  wordAnchors = new Map();
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
  lastSampleAt = null;

  els.readingTabButton.disabled = true;
  els.goReadingButton.disabled = true;
  els.calibrationBadge.textContent = "5점 보정 진행 중";
  els.calibrationBadge.classList.remove("is-ready");
  els.summaryLine.textContent = "Starting Tobii native mode for 5-point calibration";

  await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "native" })
  });
  connectGazeSocket();

  fivePointJob = {
    index: 0,
    samples: [],
    recentSamples: [],
    results: [],
    dwellStartedAt: null
  };
  renderFivePointTarget();
}

function collectFivePointSample(rawPoint) {
  if (!fivePointJob || !rawPoint) return;

  const now = performance.now();
  const target = getFivePointTargetPosition(fivePointTargets[fivePointJob.index]);
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

  const target = getFivePointTargetPosition(fivePointTargets[fivePointJob.index]);
  const measured = averagePoints(samples);
  fivePointJob.results.push({
    id: fivePointTargets[fivePointJob.index].id,
    label: fivePointTargets[fivePointJob.index].label,
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

  if (fivePointJob.index >= fivePointTargets.length) {
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
    points,
    affine
  };
  fivePointJob = null;
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;

  els.calibrationDot.classList.add("is-idle");
  els.calibrationDot.style.transform = "translate(-50%, -50%) scale(1)";
  els.calibrationStatus.textContent = "5점 보정 완료";
  els.calibrationProgress.textContent = "5 / 5";
  els.calibrationBadge.textContent = "5점 보정 완료";
  els.calibrationBadge.classList.add("is-ready");
  els.readingTabButton.disabled = false;
  els.goReadingButton.disabled = false;
  els.summaryLine.textContent = "5-point calibration complete";
}

function renderFivePointTarget() {
  if (!fivePointJob) return;

  const target = fivePointTargets[fivePointJob.index];
  const rect = els.calibrationSurface.getBoundingClientRect();
  els.calibrationDot.classList.remove("is-idle");
  els.calibrationDot.style.left = `${rect.width * target.xRatio}px`;
  els.calibrationDot.style.top = `${rect.height * target.yRatio}px`;
  els.calibrationDot.style.transform = "translate(-50%, -50%) scale(1)";
  els.calibrationStatus.textContent = `${target.label} 점을 계속 바라보세요`;
  els.calibrationProgress.textContent = `${fivePointJob.index + 1} / ${fivePointTargets.length}`;
}

function getFivePointTargetPosition(target) {
  const rect = els.calibrationSurface.getBoundingClientRect();
  return {
    x: rect.left + rect.width * target.xRatio,
    y: rect.top + rect.height * target.yRatio
  };
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

  return {
    x: basePoint.x + residualX / totalWeight,
    y: basePoint.y + residualY / totalWeight
  };
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
  if (tab === "reading" && !fivePointModel) {
    tab = "calibration";
    els.summaryLine.textContent = "5점 보정을 먼저 완료하세요";
  }

  activeTab = tab;
  const isCalibration = activeTab === "calibration";
  els.calibrationView.classList.toggle("is-hidden", !isCalibration);
  els.readingText.classList.toggle("is-hidden", isCalibration);
  els.calibrationTabButton.classList.toggle("is-active", isCalibration);
  els.readingTabButton.classList.toggle("is-active", !isCalibration);

  if (!isCalibration) {
    renderSentence({ preserveAnchors: true });
    refreshWordBoxes();
  }
}

function consumeGaze(frame) {
  const now = performance.now();
  els.trackerState.textContent = `Tracker: ${frame.valid ? "valid" : "invalid"} / ${frame.presence ? "present" : "away"}`;

  if (!frame.valid) {
    invalidStreak += 1;
    lastSampleAt = now;
    candidate = null;
    candidateHits = 0;
    els.gazeCursor.style.opacity = invalidStreak > 8 ? "0.12" : "0.25";
    return;
  }
  invalidStreak = 0;

  const point = toClientPoint(frame);
  updateDebugLine(frame, point, null);
  if (fivePointJob) {
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
    droppedFrames += 1;
    els.trackerState.textContent += ` / dropped ${droppedFrames}`;
    lastSampleAt = now;
    return;
  }

  const accepted = stabilizePoint(point);
  if (!accepted) {
    droppedFrames += 1;
    lastSampleAt = now;
    return;
  }

  showGazeCursor(accepted, 0.92);
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

function toClientPoint(frame) {
  const rawPoint = toClientPointWithoutOffset(frame);
  lastPointWithoutOffset = rawPoint;
  const point = applyFivePointCalibration(rawPoint);
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
  const marginX = -window.innerWidth * 0.22;
  const marginY = -window.innerHeight * 0.22;
  if (
    point.x < marginX ||
    point.x > window.innerWidth - marginX ||
    point.y < marginY ||
    point.y > window.innerHeight - marginY
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
  const selected = word ? word.text : "-";
  const nearestText = nearest ? `${nearest.word.text} ${Math.round(nearest.distance)}px` : "-";

  els.debugLine.textContent = `${sdkRaw} | ${screen} | ${raw} | client ${Math.round(point.x)},${Math.round(point.y)} | hit ${selected} | near ${nearestText} | ${bounds}`;
}

function roundDebug(value) {
  return Math.abs(value) < 10 ? Math.round(value * 1000) / 1000 : Math.round(value);
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
  metricsActive = false;
  lastSampleAt = null;
  lastWordIndex = null;
  maxWordIndexSeen = -1;
  smoothPoint = null;
  candidate = null;
  candidateHits = 0;
  invalidStreak = 0;
  droppedFrames = 0;
  startedAt = null;
  calibrationJob = null;
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
  const selectedIndex = Number(els.calibrationTarget.value);
  renderSentence({ preserveAnchors: true });
  els.calibrationTarget.value = String(selectedIndex);
  const word = wordBoxes[selectedIndex];
  if (!word) return;

  els.summaryLine.textContent = "Starting Tobii native mode for calibration";
  await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "native" })
  });
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
