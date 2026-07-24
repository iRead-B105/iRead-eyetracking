"use strict";

const dot = document.querySelector("#gazeDot");
const canvas = document.querySelector("#trail");
const ctx = canvas.getContext("2d");
const connection = document.querySelector("#connection");
const source = document.querySelector("#source");
const coords = document.querySelector("#coords");
const trackerState = document.querySelector("#trackerState");
const statusBox = document.querySelector("#status");
const launchLog = document.querySelector("#launchLog");
const profileLog = document.querySelector("#profileLog");
const accountInput = document.querySelector("#account");
const profileNameInput = document.querySelector("#profileName");

let frames = 0;
let lastFpsAt = performance.now();
let reconnectTimer = null;
let lastPoint = null;
let smoothPoint = null;
let candidatePoint = null;
let candidateHits = 0;
let currentFps = 0;

resizeCanvas();
window.addEventListener("resize", resizeCanvas);
connect();
refreshStatus();
setInterval(refreshStatus, 2500);
requestAnimationFrame(fadeTrail);

document.querySelector("#launchAll").addEventListener("click", () => launch("all"));
document.querySelector("#fullscreen").addEventListener("click", enterFullscreen);
document.querySelector("#launchGhost").addEventListener("click", () => launch("ghost"));
document.querySelector("#launchGameHub").addEventListener("click", () => launch("gamehub"));
document.querySelector("#launchEngine").addEventListener("click", () => launch("eyexEngine"));
document.querySelector("#launchConfiguration").addEventListener("click", () => launch("configuration"));
document.querySelector("#launchExperience").addEventListener("click", () => launch("experience"));
document.querySelector("#simulationMode").addEventListener("click", () => setMode("simulation"));
document.querySelector("#nativeMode").addEventListener("click", () => setMode("native"));
document.querySelector("#idleMode").addEventListener("click", () => setMode("idle"));
document.querySelector("#saveProfile").addEventListener("click", saveProfile);
document.querySelector("#loadProfile").addEventListener("click", loadProfile);

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/gaze`);

  socket.addEventListener("open", () => {
    connection.textContent = "Connected";
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "gaze") updateGaze(payload);
    if (payload.type === "hello") source.textContent = payload.source;
  });

  socket.addEventListener("close", () => {
    connection.textContent = "Reconnecting";
    reconnectTimer = setTimeout(connect, 800);
  });

  socket.addEventListener("error", () => {
    connection.textContent = "Error";
  });
}

function updateGaze(frame) {
  const rect = canvas.getBoundingClientRect();
  source.textContent = frame.source;
  trackerState.textContent = `${frame.valid ? "valid" : "invalid"} / ${frame.presence ? "present" : "away"}`;

  if (!frame.valid) {
    candidatePoint = null;
    candidateHits = 0;
    dot.style.opacity = "0.24";
    coords.textContent = `invalid | ${currentFps}fps`;
    return;
  }

  const measuredX = frame.x * rect.width;
  const measuredY = frame.y * rect.height;

  if (!smoothPoint) {
    smoothPoint = { x: measuredX, y: measuredY };
  } else {
    const distance = Math.hypot(measuredX - smoothPoint.x, measuredY - smoothPoint.y);
    const maxDimension = Math.max(rect.width, rect.height);
    const jumpThreshold = maxDimension * 0.22;
    const candidateThreshold = maxDimension * 0.08;

    if (distance > jumpThreshold) {
      if (
        candidatePoint &&
        Math.hypot(measuredX - candidatePoint.x, measuredY - candidatePoint.y) < candidateThreshold
      ) {
        candidateHits += 1;
      } else {
        candidatePoint = { x: measuredX, y: measuredY };
        candidateHits = 1;
      }

      if (candidateHits < 3) {
        dot.style.opacity = "0.72";
        coords.textContent = `${frame.screenX}, ${frame.screenY} | rejected jump | ${currentFps}fps`;
        return;
      }
    } else {
      candidatePoint = null;
      candidateHits = 0;
    }

    const alpha = distance > jumpThreshold ? 0.16 : 0.32;
    smoothPoint.x += (measuredX - smoothPoint.x) * alpha;
    smoothPoint.y += (measuredY - smoothPoint.y) * alpha;
  }

  const x = smoothPoint.x;
  const y = smoothPoint.y;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  dot.style.opacity = "1";

  coords.textContent = `${frame.screenX}, ${frame.screenY} | ${currentFps}fps`;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(84, 214, 178, 0.82)";
  ctx.beginPath();
  ctx.arc(x * devicePixelRatio, y * devicePixelRatio, 5 * devicePixelRatio, 0, Math.PI * 2);
  ctx.fill();

  if (lastPoint) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(lastPoint.x * devicePixelRatio, lastPoint.y * devicePixelRatio);
    ctx.lineTo(x * devicePixelRatio, y * devicePixelRatio);
    ctx.stroke();
  }
  ctx.restore();

  lastPoint = { x, y };
  frames += 1;
  const now = performance.now();
  if (now - lastFpsAt >= 1000) {
    currentFps = frames;
    frames = 0;
    lastFpsAt = now;
  }
}

function fadeTrail() {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0, 0, 0, 0.035)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  requestAnimationFrame(fadeTrail);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

async function refreshStatus() {
  const response = await fetch("/api/status");
  const data = await response.json();
  statusBox.textContent = JSON.stringify(data, null, 2);
}

async function launch(target) {
  const response = await fetch("/api/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target })
  });
  const data = await response.json();
  launchLog.textContent = JSON.stringify(data, null, 2);
  refreshStatus();
}

async function setMode(mode) {
  const response = await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  const data = await response.json();
  if (!response.ok) {
    statusBox.textContent = JSON.stringify(data, null, 2);
    return;
  }
  statusBox.textContent = JSON.stringify(data, null, 2);
}

function saveProfile() {
  const account = accountInput.value.trim();
  const profileName = profileNameInput.value.trim();
  if (!account || !profileName) {
    profileLog.textContent = "Both fields are required.";
    return;
  }

  const mappings = readMappings();
  mappings[account] = {
    tobiiProfileName: profileName,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem("tobii-profile-mappings", JSON.stringify(mappings, null, 2));
  profileLog.textContent = JSON.stringify(mappings[account], null, 2);
}

function loadProfile() {
  const account = accountInput.value.trim();
  const mapping = readMappings()[account];
  if (!mapping) {
    profileLog.textContent = "No mapping saved for this account.";
    return;
  }

  profileNameInput.value = mapping.tobiiProfileName;
  profileLog.textContent = JSON.stringify(mapping, null, 2);
}

function readMappings() {
  try {
    return JSON.parse(localStorage.getItem("tobii-profile-mappings") || "{}");
  } catch {
    return {};
  }
}

async function enterFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  }
  resizeCanvas();
}
