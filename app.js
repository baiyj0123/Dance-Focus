const VISION_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const DETECTOR_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite";
const MP4_MUXER_URL =
  "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm";
const LOCAL_API_URL = "http://127.0.0.1:4818";
const HISTORY_KEY = "quiet-timeline-history-v1";

const state = {
  mode: "portrait",
  currentStep: 1,
  detectorKind: "efficientdet",
  vision: null,
  detector: null,
  detectorStatus: "idle",
  sourceFile: null,
  sourceUrl: "",
  sourceLoaded: false,
  metadata: null,
  tracks: [],
  inspectTrackId: null,
  selectedTrackId: null,
  heroAssignments: [],
  analysisFrames: [],
  analysisBusy: false,
  exportBusy: false,
  history: loadHistory(),
  lastPreviewBox: null,
  previewPlaying: false,
  previewLoop: 0,
  demoMode: false,
  lastAnalysisCount: 0,
  localApiReady: false,
};

const els = {
  sourceVideo: document.querySelector("#source-video"),
  previewCanvas: document.querySelector("#preview-canvas"),
  exportCanvas: document.querySelector("#export-canvas"),
  canvasWrap: document.querySelector("#canvas-wrap"),
  canvasEmpty: document.querySelector("#canvas-empty"),
  videoInput: document.querySelector("#video-input"),
  fileMeta: document.querySelector("#file-meta"),
  previewTitle: document.querySelector("#preview-title"),
  timeLabel: document.querySelector("#time-label"),
  timeline: document.querySelector("#timeline"),
  trimStart: document.querySelector("#trim-start"),
  trimEnd: document.querySelector("#trim-end"),
  sampleRate: document.querySelector("#sample-rate"),
  outputSize: document.querySelector("#output-size"),
  redactionStyle: document.querySelector("#redaction-style"),
  cropPadding: document.querySelector("#crop-padding"),
  safetyMargin: document.querySelector("#safety-margin"),
  smoothing: document.querySelector("#smoothing"),
  fps: document.querySelector("#fps"),
  trackList: document.querySelector("#track-list"),
  trackCount: document.querySelector("#track-count"),
  candidateIndicator: document.querySelector("#candidate-indicator"),
  candidatePrevButton: document.querySelector("#candidate-prev-button"),
  candidateNextButton: document.querySelector("#candidate-next-button"),
  historyList: document.querySelector("#history-list"),
  historyCount: document.querySelector("#history-count"),
  selectionSummary: document.querySelector("#selection-summary"),
  selectionCallout: document.querySelector("#selection-callout"),
  modelSelector: document.querySelector("#model-selector"),
  heroKeyframeList: document.querySelector("#hero-keyframe-list"),
  clearKeyframesButton: document.querySelector("#clear-keyframes-button"),
  samplingIndicator: document.querySelector("#sampling-indicator"),
  fpsIndicator: document.querySelector("#fps-indicator"),
  modelStatus: document.querySelector("#model-status"),
  analysisStatus: document.querySelector("#analysis-status"),
  exportStatus: document.querySelector("#export-status"),
  pipelineStatus: document.querySelector("#pipeline-status"),
  pipelineNote: document.querySelector("#pipeline-note"),
  progressBadge: document.querySelector("#progress-badge"),
  progressFill: document.querySelector("#progress-fill"),
  progressCopy: document.querySelector("#progress-copy"),
  playToggle: document.querySelector("#play-toggle"),
  downloadLink: document.querySelector("#download-link"),
  modeButtons: [...document.querySelectorAll(".mode-pill[data-mode]")],
  loadModelsButton: document.querySelector("#load-models-button"),
  analyzeButton: document.querySelector("#analyze-button"),
  exportButton: document.querySelector("#export-button"),
  goStep2Button: document.querySelector("#go-step-2-button"),
  goStep3Button: document.querySelector("#go-step-3-button"),
  goStep4Button: document.querySelector("#go-step-4-button"),
  demoButton: document.querySelector("#demo-button"),
  resetButton: document.querySelector("#reset-button"),
  workflowSteps: [...document.querySelectorAll("[data-step]")],
  stepPanels: [...document.querySelectorAll("[data-step-panel]")],
};

const ctx = els.previewCanvas.getContext("2d", { willReadFrequently: true });
const exportCtx = els.exportCanvas.getContext("2d", { willReadFrequently: true });
const scratchCanvas = document.createElement("canvas");
const scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true });

wireEvents();
renderHistory();
setStatus("model", "未加载");
setStatus("analysis", "等待视频");
setStatus("export", "未开始");
renderDemoFrame();
resizePreviewCanvas();
updateSelectionSummary();
updateIndicators();
renderHeroKeyframes();
renderWorkflow();
syncModeButtons();
updateActionAvailability();
void detectLocalApi();

function wireEvents() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".mode-pill[data-mode]");
    if (!button) return;
    state.mode = button.dataset.mode;
    syncModeButtons();
    state.lastPreviewBox = null;
    resizePreviewCanvas();
    renderTrackList();
    if (state.sourceLoaded) {
      renderCurrentFrame();
    } else {
      renderDemoFrame();
    }
  });

  els.videoInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    await loadVideoFile(file);
  });

  els.loadModelsButton.addEventListener("click", async () => {
    await ensureDetector();
  });

  els.modelSelector?.addEventListener("change", async () => {
    state.detectorKind = els.modelSelector.value;
    unloadDetector();
    setStatus("model", "未加载");
    updateModelStatusCopy();
    if (state.sourceLoaded) {
      await ensureDetector();
    }
  });

  els.analyzeButton.addEventListener("click", async () => {
    await analyzeVideo();
  });

  els.workflowSteps.forEach((stepButton) => {
    stepButton.addEventListener("click", () => {
      const step = Number(stepButton.dataset.step);
      navigateToStep(step);
    });
  });

  els.goStep2Button?.addEventListener("click", async () => {
    if (!state.sourceLoaded) {
      alert("请先导入视频素材。");
      return;
    }
    if (!state.analysisFrames.length) {
      await analyzeVideo();
      return;
    }
    navigateToStep(2);
  });

  els.goStep3Button?.addEventListener("click", () => {
    if (!state.selectedTrackId) {
      alert("请先选择一个要跟踪的主角。");
      return;
    }
    navigateToStep(3);
  });

  els.goStep4Button?.addEventListener("click", () => {
    if (!state.selectedTrackId) {
      alert("请先选择一个要跟踪的主角。");
      return;
    }
    navigateToStep(4);
  });

  els.candidatePrevButton?.addEventListener("click", async () => {
    await cycleInspectedTrack(-1);
  });

  els.candidateNextButton?.addEventListener("click", async () => {
    await cycleInspectedTrack(1);
  });

  els.timeline.addEventListener("input", async () => {
    if (!state.sourceLoaded) return;
    pausePreview();
    await seekVideo(Number(els.timeline.value));
    renderCurrentFrame();
  });

  els.trimStart.addEventListener("change", syncTrimInputs);
  els.trimEnd.addEventListener("change", syncTrimInputs);
  els.outputSize.addEventListener("change", () => {
    resizePreviewCanvas();
    renderCurrentFrame();
  });
  els.sampleRate.addEventListener("change", updateIndicators);
  els.cropPadding.addEventListener("input", renderCurrentFrame);
  els.safetyMargin.addEventListener("input", renderCurrentFrame);
  els.redactionStyle.addEventListener("change", () => {
    updateSelectionSummary();
    renderCurrentFrame();
  });
  els.fps.addEventListener("change", updateIndicators);
  els.smoothing.addEventListener("input", () => {
    state.lastPreviewBox = null;
    renderCurrentFrame();
  });

  els.playToggle.addEventListener("click", async () => {
    if (!state.sourceLoaded) return;
    if (state.previewPlaying) {
      pausePreview();
      return;
    }
    await playPreview();
  });

  els.exportButton.addEventListener("click", async () => {
    await exportProcessedVideo();
  });

  els.demoButton.addEventListener("click", () => {
    state.demoMode = true;
    state.sourceLoaded = false;
    state.tracks = [];
    state.inspectTrackId = null;
    state.selectedTrackId = null;
    state.heroAssignments = [];
    renderTrackList();
    renderHeroKeyframes();
    renderDemoFrame();
  });

  els.resetButton.addEventListener("click", resetProject);
  els.clearKeyframesButton.addEventListener("click", () => {
    if (!state.selectedTrackId) return;
    state.heroAssignments = [{ time: 0, trackId: state.selectedTrackId }];
    renderHeroKeyframes();
    renderTrackList();
    renderCurrentFrame();
  });
}

function syncModeButtons() {
  els.modeButtons.forEach((item) => {
    item.classList.toggle("active", item.dataset.mode === state.mode);
  });
}

async function loadVideoFile(file) {
  try {
    resetProject(false);
    state.demoMode = false;
    state.sourceFile = file;
    state.sourceUrl = URL.createObjectURL(file);
    els.previewTitle.textContent = "正在加载视频";
    els.fileMeta.textContent = `${file.name} · 正在读取元数据...`;
    setStatus("analysis", "加载视频中");
    els.progressBadge.textContent = "Loading Video";
    updateProgress(0.08, "正在读取视频信息");
    els.sourceVideo.preload = "metadata";
    els.sourceVideo.src = state.sourceUrl;
    els.sourceVideo.load();

    await waitForVideoMetadata(els.sourceVideo, 12000);
    state.sourceLoaded = true;
    state.metadata = {
      duration: els.sourceVideo.duration,
      width: els.sourceVideo.videoWidth,
      height: els.sourceVideo.videoHeight,
    };

    if (!Number.isFinite(state.metadata.duration) || !state.metadata.width || !state.metadata.height) {
      throw new Error("VIDEO_METADATA_INVALID");
    }

    els.timeline.max = state.metadata.duration.toFixed(2);
    els.timeline.value = "0";
    els.trimStart.value = "0";
    els.trimEnd.value = state.metadata.duration.toFixed(1);
    syncTrimInputs();
    resizePreviewCanvas();
    await seekVideo(0);
    renderCurrentFrame();

    els.canvasEmpty.style.display = "none";
    els.previewTitle.textContent = file.name;
    els.fileMeta.textContent =
      `${file.name} · ${state.metadata.width}×${state.metadata.height} · ${formatTime(state.metadata.duration)}`;
    setStatus("analysis", "待识别");
    els.progressBadge.textContent = "Video Ready";
    updateProgress(0, "视频已加载，可以开始识别");
    state.currentStep = 2;
    renderWorkflow();
    void ensureDetector();
  } catch (error) {
    console.error(error);
    resetProject(false);
    const message = explainVideoLoadError(error, file);
    els.previewTitle.textContent = "视频加载失败";
    els.fileMeta.textContent = message;
    setStatus("analysis", "加载失败");
    els.progressBadge.textContent = "Load Failed";
    updateProgress(0, message);
    alert(message);
  }
}

async function ensureDetector() {
  if (state.detector) return state.detector;
  if (state.detectorStatus === "loading") return null;

  try {
    state.detectorStatus = "loading";
    setStatus("model", "加载中");
    updateModelStatusCopy();
    els.progressBadge.textContent = "Loading Model";
    state.vision = state.vision || await import(VISION_BUNDLE_URL);
    const fileset = await state.vision.FilesetResolver.forVisionTasks(VISION_WASM_URL);
    state.detector = await Promise.race([createSelectedDetector(fileset), new Promise((_, reject) => {
      setTimeout(() => reject(new Error("MODEL_LOAD_TIMEOUT")), 15000);
    })]);
    state.detectorStatus = "ready";
    setStatus("model", "已就绪");
    updateModelStatusCopy();
    els.progressBadge.textContent = "Model Ready";
    return state.detector;
  } catch (error) {
    console.error(error);
    state.detectorStatus = "error";
    setStatus("model", "加载失败");
    updateModelStatusCopy();
    els.progressBadge.textContent = "Model Error";
    alert(explainModelLoadError(error));
    return null;
  }
}

async function createSelectedDetector(fileset) {
  return state.vision.ObjectDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: DETECTOR_MODEL_URL,
    },
    scoreThreshold: 0.25,
    runningMode: "VIDEO",
    maxResults: 6,
    categoryAllowlist: ["person"],
  });
}

function unloadDetector() {
  try {
    state.detector?.close?.();
  } catch {
    // noop
  }
  state.detector = null;
  state.detectorStatus = "idle";
}

function modelDisplayName(kind = state.detectorKind) {
  return "EfficientDet Lite0 Person Detector";
}

function updateModelStatusCopy() {
  if (!els.modelSelector) return;
  const base = modelDisplayName();
  const suffix = {
    idle: "待加载",
    loading: "加载中",
    ready: "已就绪",
    error: "加载失败",
  }[state.detectorStatus] || "待加载";
  els.modelSelector.title = `${base} · ${suffix}`;
}

async function detectLocalApi() {
  try {
    const response = await fetch(`${LOCAL_API_URL}/api/health`, { method: "GET" });
    state.localApiReady = response.ok;
  } catch {
    state.localApiReady = false;
  }
  if (els.pipelineStatus) {
    els.pipelineStatus.textContent = state.localApiReady ? "本地 FFmpeg 已连接" : "未连接本地 FFmpeg";
  }
  if (els.pipelineNote) {
    els.pipelineNote.textContent = state.localApiReady
      ? "正式导出会优先走本地 FFmpeg 逐帧渲染与 H.264 编码，避免浏览器导出卡顿发糊。"
      : "未检测到本地 FFmpeg 服务。运行 `python3 studio_server.py` 后，导出会自动切到本地高质量 MP4。";
  }
}

async function analyzeVideo() {
  if (!state.sourceLoaded || state.analysisBusy) return;
  const detector = await ensureDetector();
  if (!detector) return;

  state.analysisBusy = true;
  state.tracks = [];
  state.analysisFrames = [];
  state.lastPreviewBox = null;
  state.inspectTrackId = null;
  state.selectedTrackId = null;
  state.heroAssignments = [];
  setStatus("analysis", "识别中");
  els.progressBadge.textContent = "Analyzing";
  updateProgress(0, "正在抽样检测人物轨迹");

  const duration = state.metadata.duration;
  const step = Number(els.sampleRate.value);
  let trackId = 1;

  for (let t = 0; t <= duration; t += step) {
    await seekVideo(Math.min(t, duration));
    const detections = detectPersonsAtCurrentTime();
    const boxes = dedupeBoxes(detections.map(normalizeDetection).filter(Boolean));
    const assignments = assignToTracks(boxes, t, () => `P${trackId++}`);
    state.analysisFrames.push({ time: t, boxes: assignments });
    updateProgress(Math.min(t / duration, 1), `识别中 ${formatTime(t)} / ${formatTime(duration)}`);
  }

  finalizeTracks();
  state.analysisBusy = false;
  state.inspectTrackId = state.tracks[0]?.id ?? null;
  state.tracks.forEach((track) => {
    track.policy = "redact";
  });
  renderTrackList();
  renderHeroKeyframes();
  state.currentStep = 2;
  renderWorkflow();
  setStatus("analysis", state.tracks.length ? "已完成" : "未识别到人物");
  els.progressBadge.textContent = "Pick Main Subject";
  updateProgress(1, state.tracks.length ? "识别完成，请先从左侧候选列表中选择要跟踪的主角" : "没有检测到稳定人物轨迹");
  await seekVideo(Number(els.timeline.value || 0));
  renderCurrentFrame();
}

function detectPersonsAtCurrentTime() {
  if (!state.detector) return [];
  const video = els.sourceVideo;
  let result;
  try {
    result = state.detector.detectForVideo(video, performance.now());
  } catch {
    try {
      result = state.detector.detectForVideo(video);
    } catch {
      result = state.detector.detectForVideo(video, performance.now());
    }
  }
  return result?.detections || [];
}

function normalizeDetection(detection) {
  if ("x" in detection && "w" in detection) {
    return detection;
  }
  const bbox = detection.boundingBox;
  const label = detection.categories?.[0]?.categoryName;
  if (!bbox || (label && label !== "person")) return null;
  return {
    x: bbox.originX,
    y: bbox.originY,
    w: bbox.width,
    h: bbox.height,
    score: detection.categories?.[0]?.score || 0,
  };
}

function assignToTracks(boxes, time, nextId) {
  const current = [];
  const activeTracks = state.tracks.filter((track) => track.samples.length);

  for (const box of boxes) {
    let bestTrack = null;
    let bestScore = -Infinity;

    for (const track of activeTracks) {
      const previous = track.samples[track.samples.length - 1];
      if (!previous || time - previous.time > 1.25) continue;
      const iou = intersectionOverUnion(previous.box, box);
      const distance = centerDistance(previous.box, box) / Math.max(state.metadata.width, state.metadata.height);
      const areaRatio = Math.min(previous.box.w * previous.box.h, box.w * box.h) /
        Math.max(previous.box.w * previous.box.h, box.w * box.h);
      const score = iou * 2.6 + areaRatio * 0.35 - distance * 1.2;
      if (score > bestScore) {
        bestScore = score;
        bestTrack = track;
      }
    }

    if (!bestTrack || bestScore < 0.18) {
      bestTrack = {
        id: nextId(),
        policy: "redact",
        color: colorForIndex(state.tracks.length),
        samples: [],
        coverage: 0,
        averageArea: 0,
      };
      state.tracks.push(bestTrack);
      activeTracks.push(bestTrack);
    }

    bestTrack.samples.push({ time, box });
    current.push({ trackId: bestTrack.id, box });
  }

  return current;
}

function finalizeTracks() {
  state.tracks = mergeTracks(
    state.tracks
      .map((track) => {
        const coverage = track.samples.length;
        const averageArea =
          track.samples.reduce((sum, sample) => sum + sample.box.w * sample.box.h, 0) / Math.max(1, coverage);
        return { ...track, coverage, averageArea };
      })
      .filter((track) => track.coverage >= 2)
      .sort((a, b) => {
        if (b.coverage !== a.coverage) return b.coverage - a.coverage;
        return b.averageArea - a.averageArea;
      })
  )
    .filter((track) => track.coverage >= 3)
    .sort((a, b) => {
      const aPriority = a.coverage * 1.8 + a.averageArea / 10000;
      const bPriority = b.coverage * 1.8 + b.averageArea / 10000;
      return bPriority - aPriority;
    })
    .slice(0, 6);

  state.lastAnalysisCount = state.tracks.length;

  const allowed = new Set(state.tracks.map((track) => track.id));
  state.analysisFrames = state.analysisFrames.map((frame) => ({
    ...frame,
    boxes: frame.boxes.filter((item) => allowed.has(item.trackId)),
  }));
}

function renderTrackList() {
  const { trackList } = els;
  trackList.innerHTML = "";
  els.trackCount.textContent = String(state.tracks.length);

  if (!state.tracks.length) {
    trackList.innerHTML = '<div class="empty-state small">先完成识别，再从列表里选一个主角，其他人会自动统一处理。</div>';
    updateSelectionSummary();
    return;
  }

  state.tracks.forEach((track, index) => {
    const card = document.createElement("div");
    const activeTrackId = getActiveTrackIdAtTime(Number(els.timeline.value || 0));
    const selected = track.id === activeTrackId;
    const previewing = track.id === (state.inspectTrackId || state.selectedTrackId);
    card.className = `track-card${selected ? " active" : ""}${previewing ? " previewing" : ""}${index === 0 ? " primary-candidate" : ""}`;
    const coverSeconds = (track.coverage * Number(els.sampleRate.value || 0.35)).toFixed(1);
    const currentTime = Number(els.timeline.value || 0);
    const canSwitchHere = state.sourceLoaded && currentTime > 0.05;
    card.innerHTML = `
      <div class="track-row">
        <div class="track-meta">
          <span class="track-dot" style="background:${track.color}"></span>
          <div>
            <div class="track-name">${index === 0 ? "优先候选" : `人物 ${index + 1}`}</div>
            <div class="track-stats">覆盖 ${coverSeconds}s · 平均面积 ${(track.averageArea / 1000).toFixed(0)}k</div>
          </div>
        </div>
        <span class="track-rank">${selected ? "主角" : `#${index + 1}`}</span>
      </div>
      <div class="track-actions">
        <button class="track-select ${previewing ? "previewing" : ""}" data-action="preview" data-track="${track.id}">
          ${previewing ? "正在预览" : "看这个人"}
        </button>
        <button class="track-select ${selected && !canSwitchHere ? "active" : ""}" data-action="primary-all" data-track="${track.id}">
          ${selected && !canSwitchHere ? "当前主角" : "设为全程主角"}
        </button>
        <button class="track-select ${selected && canSwitchHere ? "active" : ""}" data-action="primary-from-here" data-track="${track.id}">
          ${selected && canSwitchHere ? "此刻主角" : "从此刻切换"}
        </button>
        ${selected ? '<span class="primary-chip">其他人自动处理</span>' : ""}
      </div>
    `;
    card.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const targetTrack = state.tracks.find((item) => item.id === button.dataset.track);
      if (!targetTrack) return;

      const action = button.dataset.action;
      if (action === "preview") {
        state.inspectTrackId = targetTrack.id;
        state.lastPreviewBox = null;
        renderTrackList();
        await renderCurrentFrame();
        return;
      }

      if (action === "primary-all") {
        state.selectedTrackId = targetTrack.id;
        state.inspectTrackId = targetTrack.id;
        state.heroAssignments = [{ time: 0, trackId: targetTrack.id }];
      }

      if (action === "primary-from-here") {
        const time = roundTime(Number(els.timeline.value || 0));
        state.selectedTrackId = targetTrack.id;
        state.inspectTrackId = targetTrack.id;
        upsertHeroAssignment(time, targetTrack.id);
      }

      if (action === "primary-all" || action === "primary-from-here") {
        state.tracks.forEach((item) => {
          item.policy = item.id === targetTrack.id ? "keep" : "redact";
        });
      }

      renderTrackList();
      renderHeroKeyframes();
      state.currentStep = action === "primary-all" ? 3 : 4;
      renderWorkflow();
      await renderCurrentFrame();
    });
    trackList.appendChild(card);
  });
  updateSelectionSummary();
  updateActionAvailability();
  updateCandidateIndicator();
}

function renderCurrentFrame() {
  if (!state.sourceLoaded) {
    renderDemoFrame();
    return;
  }
  drawFrame(ctx, els.previewCanvas, Number(els.timeline.value || 0), false);
  updateTimeLabel(Number(els.timeline.value || 0));
  if (state.tracks.length) {
    renderTrackList();
  } else {
    updateSelectionSummary();
  }
  renderHeroKeyframes();
}

function drawFrame(targetCtx, canvas, time, smoothForPlayback) {
  const video = els.sourceVideo;
  const output = parseSize(els.outputSize.value);
  fitCanvas(canvas, output.width, output.height);

  targetCtx.clearRect(0, 0, canvas.width, canvas.height);
  targetCtx.fillStyle = "#0f1722";
  targetCtx.fillRect(0, 0, canvas.width, canvas.height);

  const scene = buildScene(time, smoothForPlayback);
  if (!scene) {
    targetCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return;
  }

  if (state.mode === "portrait") {
    const crop = scene.crop;
    targetCtx.drawImage(
      video,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      0,
      0,
      canvas.width,
      canvas.height
    );
    for (const box of scene.redactions) {
      const mapped = mapBoxFromSourceToCrop(box, crop, canvas.width, canvas.height);
      redactRegion(targetCtx, video, box, mapped);
    }
  } else {
    targetCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const box of scene.redactions) {
      const mapped = mapBoxToCanvas(box, state.metadata.width, state.metadata.height, canvas.width, canvas.height);
      redactRegion(targetCtx, video, box, mapped);
    }
  }

  if (!smoothForPlayback) {
    drawGuides(targetCtx, scene);
  }
}

function buildScene(time, smoothForPlayback) {
  const boxes = getBoxesAtTime(time);
  const previewTrackId = state.currentStep === 2 ? state.inspectTrackId : null;
  const activeTrackId = previewTrackId || getActiveTrackIdAtTime(time) || state.selectedTrackId;
  const selectedTrack = state.tracks.find((item) => item.id === activeTrackId);
  const selectedBox = selectedTrack ? interpolateTrackBox(selectedTrack, time, true) : null;
  const selected = selectedBox
    ? { trackId: activeTrackId, box: selectedBox }
    : (!activeTrackId ? boxes[0] : null);
  if (!selected) return null;

  const keepTrackIds = new Set([selected.trackId]);
  const redactions = boxes
    .filter((item) => !keepTrackIds.has(item.trackId))
    .map((item) => expandBox(item.box, Number(els.safetyMargin.value)));

  if (state.mode === "privacy") {
    return { crop: null, selected, redactions };
  }

  let crop = makePortraitCrop(selected.box, parseSize(els.outputSize.value));
  if (smoothForPlayback && state.lastPreviewBox) {
    crop = smoothCrop(state.lastPreviewBox, crop, Number(els.smoothing.value));
  }
  state.lastPreviewBox = crop;
  return {
    crop,
    selected,
    redactions: redactions.map((box) => intersectBoxes(box, crop)).filter(Boolean),
  };
}

function getBoxesAtTime(time) {
  if (!state.analysisFrames.length) return [];
  const response = [];
  for (const track of state.tracks) {
    const box = interpolateTrackBox(track, time);
    if (box) response.push({ trackId: track.id, box });
  }
  return response;
}

function interpolateTrackBox(track, time, allowLoose = false) {
  const samples = track.samples;
  if (!samples.length) return null;
  let before = null;
  let after = null;

  for (const sample of samples) {
    if (sample.time <= time) before = sample;
    if (sample.time >= time) {
      after = sample;
      break;
    }
  }

  if (!before) before = samples[0];
  if (!after) after = samples[samples.length - 1];
  if (!before || !after) return null;
  const tolerance = allowLoose ? 3.2 : 1.25;
  if (Math.abs(before.time - time) > tolerance && Math.abs(after.time - time) > tolerance) return null;
  if (allowLoose && before && after && before !== after && Math.abs(before.time - time) > 1.25 && Math.abs(after.time - time) > 1.25) {
    return Math.abs(before.time - time) <= Math.abs(after.time - time) ? before.box : after.box;
  }
  if (before.time === after.time) return before.box;

  const ratio = (time - before.time) / (after.time - before.time);
  return {
    x: lerp(before.box.x, after.box.x, ratio),
    y: lerp(before.box.y, after.box.y, ratio),
    w: lerp(before.box.w, after.box.w, ratio),
    h: lerp(before.box.h, after.box.h, ratio),
  };
}

function makePortraitCrop(box, output) {
  const padding = Number(els.cropPadding.value);
  const source = state.metadata;
  const aspect = output.width / output.height;
  const targetH = clamp(box.h * (1 + padding * 1.2), source.height * 0.3, source.height);
  const targetW = targetH * aspect;
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2 - box.h * 0.1;

  let x = centerX - targetW / 2;
  let y = centerY - targetH / 2;
  x = clamp(x, 0, Math.max(0, source.width - targetW));
  y = clamp(y, 0, Math.max(0, source.height - targetH));

  return { x, y, w: targetW, h: targetH };
}

function smoothCrop(previous, next, amount) {
  return {
    x: lerp(next.x, previous.x, amount),
    y: lerp(next.y, previous.y, amount),
    w: lerp(next.w, previous.w, amount),
    h: lerp(next.h, previous.h, amount),
  };
}

function expandBox(box, marginRatio) {
  const mx = box.w * marginRatio;
  const my = box.h * marginRatio;
  const x = clamp(box.x - mx, 0, state.metadata.width);
  const y = clamp(box.y - my, 0, state.metadata.height);
  return {
    x,
    y,
    w: clamp(box.w + mx * 2, 1, state.metadata.width - x),
    h: clamp(box.h + my * 2, 1, state.metadata.height - y),
  };
}

function mapBoxFromSourceToCrop(box, crop, canvasWidth, canvasHeight) {
  return {
    x: ((box.x - crop.x) / crop.w) * canvasWidth,
    y: ((box.y - crop.y) / crop.h) * canvasHeight,
    w: (box.w / crop.w) * canvasWidth,
    h: (box.h / crop.h) * canvasHeight,
  };
}

function mapBoxToCanvas(box, sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  return {
    x: (box.x / sourceWidth) * canvasWidth,
    y: (box.y / sourceHeight) * canvasHeight,
    w: (box.w / sourceWidth) * canvasWidth,
    h: (box.h / sourceHeight) * canvasHeight,
  };
}

function redactRegion(targetCtx, video, sourceBox, destBox) {
  if (destBox.w <= 1 || destBox.h <= 1) return;
  const style = els.redactionStyle.value;

  if (style === "solid") {
    targetCtx.fillStyle = "rgba(18, 24, 34, 0.92)";
    targetCtx.fillRect(destBox.x, destBox.y, destBox.w, destBox.h);
    return;
  }

  if (style === "blur") {
    targetCtx.save();
    targetCtx.filter = "blur(18px)";
    targetCtx.drawImage(
      video,
      sourceBox.x,
      sourceBox.y,
      sourceBox.w,
      sourceBox.h,
      destBox.x,
      destBox.y,
      destBox.w,
      destBox.h
    );
    targetCtx.restore();
    return;
  }

  const pixelSize = Math.max(8, Math.floor(Math.min(destBox.w, destBox.h) / 8));
  scratchCanvas.width = Math.max(4, Math.floor(destBox.w / pixelSize));
  scratchCanvas.height = Math.max(4, Math.floor(destBox.h / pixelSize));
  scratchCtx.imageSmoothingEnabled = false;
  scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  scratchCtx.drawImage(
    video,
    sourceBox.x,
    sourceBox.y,
    sourceBox.w,
    sourceBox.h,
    0,
    0,
    scratchCanvas.width,
    scratchCanvas.height
  );
  targetCtx.save();
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(scratchCanvas, destBox.x, destBox.y, destBox.w, destBox.h);
  targetCtx.restore();
}

function drawGuides(targetCtx, scene) {
  if (scene.selected?.box) {
    const sourceBox = scene.selected.box;
    if (state.mode === "portrait" && scene.crop) {
      const mapped = mapBoxFromSourceToCrop(sourceBox, scene.crop, els.previewCanvas.width, els.previewCanvas.height);
      drawOutline(targetCtx, mapped, "#8dd1ff");
    } else {
      const mapped = mapBoxToCanvas(
        sourceBox,
        state.metadata.width,
        state.metadata.height,
        els.previewCanvas.width,
        els.previewCanvas.height
      );
      drawOutline(targetCtx, mapped, "#8dd1ff");
    }
  }
}

function drawOutline(targetCtx, box, color) {
  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = 3;
  targetCtx.setLineDash([10, 8]);
  targetCtx.strokeRect(box.x, box.y, box.w, box.h);
  targetCtx.restore();
}

async function playPreview() {
  if (!state.sourceLoaded) return;
  state.previewPlaying = true;
  els.playToggle.textContent = "暂停";
  els.sourceVideo.muted = true;
  await els.sourceVideo.play();

  const loop = () => {
    if (!state.previewPlaying) return;
    els.timeline.value = String(els.sourceVideo.currentTime);
    drawFrame(ctx, els.previewCanvas, els.sourceVideo.currentTime, true);
    updateTimeLabel(els.sourceVideo.currentTime);
    if (els.sourceVideo.ended || els.sourceVideo.currentTime >= Number(els.trimEnd.value)) {
      pausePreview();
      return;
    }
    state.previewLoop = requestVideoCallback(els.sourceVideo, loop);
  };

  state.previewLoop = requestVideoCallback(els.sourceVideo, loop);
}

function pausePreview() {
  state.previewPlaying = false;
  els.playToggle.textContent = "播放";
  els.sourceVideo.pause();
  cancelVideoCallback(els.sourceVideo, state.previewLoop);
  state.lastPreviewBox = null;
}

async function exportProcessedVideo() {
  if (!state.sourceLoaded || state.exportBusy) return;
  if (!state.selectedTrackId) {
    state.currentStep = 2;
    renderWorkflow();
    updateProgress(0, "请先从识别结果里选择一个要跟踪的主角");
    alert("请先选择一个要跟踪的主角，再导出视频。");
    return;
  }
  if (!state.localApiReady) {
    await detectLocalApi();
  }
  if (!state.analysisFrames.length) {
    await analyzeVideo();
    if (!state.analysisFrames.length) return;
  }

  state.exportBusy = true;
  pausePreview();
  setStatus("export", "导出中");
  els.progressBadge.textContent = "Exporting MP4";
  els.downloadLink.classList.add("disabled");
  try {
    const output = resolveOutputSize();
    fitCanvas(els.exportCanvas, output.width, output.height);
    const fps = Number(els.fps.value);
    const started = Number(els.trimStart.value);
    const ended = Number(els.trimEnd.value);
    updateProgress(0, "准备导出 MP4");

    let result;
    if (state.localApiReady) {
      result = await exportViaLocalRenderer(output, fps, started, ended);
    } else {
      const recorderMimeType = getSupportedMp4RecorderMimeType();
      result = recorderMimeType
        ? await exportMp4ViaMediaRecorder(output, fps, started, ended, recorderMimeType)
        : await exportMp4ViaWebCodecs(output, fps, started, ended);
    }

    const downloadUrl = result.downloadUrl || URL.createObjectURL(result.blob);
    const downloadName = createDownloadName("mp4");
    els.downloadLink.href = downloadUrl;
    els.downloadLink.download = downloadName;
    els.downloadLink.classList.remove("disabled");
    els.downloadLink.textContent = "下载 MP4";
    els.downloadLink.click();

    state.history.unshift({
      name: downloadName,
      mode: state.mode,
      source: state.sourceFile?.name || "未命名视频",
      time: new Date().toLocaleString("zh-CN"),
      size: result.sizeLabel || `${(result.blob.size / (1024 * 1024)).toFixed(1)} MB`,
    });
    state.history = state.history.slice(0, 8);
    saveHistory();
    renderHistory();

    state.exportBusy = false;
    setStatus("export", result.audioIncluded ? "已完成（MP4 含音频）" : "已完成（MP4 无音频）");
    els.progressBadge.textContent = "MP4 Ready";
    updateProgress(1, result.audioIncluded ? "MP4 导出完成，可下载结果" : "MP4 导出完成。当前回退链路未附带原始音频轨。");
    await seekVideo(Number(els.timeline.value || 0));
    state.lastPreviewBox = null;
    renderCurrentFrame();
  } catch (error) {
    console.error(error);
    state.exportBusy = false;
    setStatus("export", "导出失败");
    els.progressBadge.textContent = "MP4 Error";
    updateProgress(0, explainMp4ExportError(error));
    alert(explainMp4ExportError(error));
  }
}

async function exportViaLocalRenderer(output, fps, started, ended) {
  els.progressBadge.textContent = "Local FFmpeg";
  updateProgress(0.12, "上传视频到本地 FFmpeg 服务");
  const payload = buildProjectPayload(output, fps, started, ended);
  const formData = new FormData();
  formData.append("project", new Blob([JSON.stringify(payload)], { type: "application/json" }), "project.json");
  formData.append("video", state.sourceFile, state.sourceFile?.name || "source.mp4");

  const response = await fetch(`${LOCAL_API_URL}/api/render`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await response.text() || "LOCAL_RENDER_FAILED");
  }
  updateProgress(0.92, "本地 FFmpeg 已完成编码，准备下载");
  const result = await response.json();
  return {
    blob: new Blob(),
    audioIncluded: true,
    downloadUrl: `${LOCAL_API_URL}${result.download_url}`,
    sizeLabel: result.size_label,
  };
}

function buildProjectPayload(output, fps, started, ended) {
  return {
    mode: state.mode,
    detectorKind: state.detectorKind,
    trim: { start: started, end: ended },
    output,
    fps,
    redactionStyle: els.redactionStyle.value,
    cropPadding: Number(els.cropPadding.value),
    safetyMargin: Number(els.safetyMargin.value),
    smoothing: Number(els.smoothing.value),
    metadata: state.metadata,
    selectedTrackId: state.selectedTrackId,
    heroAssignments: state.heroAssignments,
    tracks: state.tracks.map((track) => ({
      id: track.id,
      color: track.color,
      policy: track.policy,
      samples: track.samples,
    })),
  };
}

function updateProgress(value, copy) {
  els.progressFill.style.width = `${Math.round(value * 100)}%`;
  els.progressCopy.textContent = copy;
}

function syncTrimInputs() {
  if (!state.metadata) return;
  const start = clamp(Number(els.trimStart.value) || 0, 0, state.metadata.duration);
  const end = clamp(Number(els.trimEnd.value) || state.metadata.duration, 0, state.metadata.duration);
  const fixedEnd = Math.max(start + 0.1, end);
  els.trimStart.value = start.toFixed(1);
  els.trimEnd.value = Math.min(fixedEnd, state.metadata.duration).toFixed(1);
}

function renderHistory() {
  els.historyCount.textContent = String(state.history.length);
  els.historyList.innerHTML = "";
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state small">还没有导出记录</div>';
    return;
  }

  state.history.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-card";
    card.innerHTML = `
      <strong>${item.mode === "portrait" ? "单人直拍" : "全画面打码"}</strong>
      <p>${item.source}</p>
      <p>${item.time} · ${item.size}</p>
    `;
    els.historyList.appendChild(card);
  });
}

function renderHeroKeyframes() {
  if (!els.heroKeyframeList) return;
  els.heroKeyframeList.innerHTML = "";
  if (!state.heroAssignments.length) {
    els.heroKeyframeList.innerHTML = '<div class="empty-state small">设定主角后，这里会显示全程主角和时间点切换记录。</div>';
    return;
  }

  state.heroAssignments.forEach((assignment, index) => {
    const track = state.tracks.find((item) => item.id === assignment.trackId);
    const item = document.createElement("div");
    item.className = "keyframe-item";
    item.innerHTML = `
      <div>
        <strong>${index === 0 ? "全程起始主角" : `切换点 ${index}`}</strong>
        <span>${track ? track.id : assignment.trackId}</span>
      </div>
      <strong>${formatTime(assignment.time)}</strong>
    `;
    els.heroKeyframeList.appendChild(item);
  });
}

function renderWorkflow() {
  const maxStep = getMaxAccessibleStep();
  els.workflowSteps.forEach((button) => {
    const step = Number(button.dataset.step);
    button.classList.toggle("active", step === state.currentStep);
    button.classList.toggle("locked", step > maxStep);
  });
  els.stepPanels.forEach((panel) => {
    const panelStep = Number(panel.dataset.stepPanel);
    const shouldShow =
      panelStep === state.currentStep ||
      (panelStep === 3 && state.currentStep === 4);
    panel.classList.toggle("active", shouldShow);
  });
}

async function exportMp4ViaMediaRecorder(output, fps, started, ended, mimeType) {
  const stream = els.exportCanvas.captureStream(fps);
  const audioSource = els.sourceVideo.captureStream ? els.sourceVideo.captureStream() : null;
  const audioTrack = audioSource?.getAudioTracks?.()[0];
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: recommendedVideoBitrate(output.width, output.height, fps),
  });
  const chunks = [];
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  await seekVideo(started);
  els.sourceVideo.muted = true;
  els.sourceVideo.playbackRate = 1;
  recorder.start(250);
  await els.sourceVideo.play();

  await new Promise((resolve) => {
    const tick = () => {
      const current = els.sourceVideo.currentTime;
      drawFrame(exportCtx, els.exportCanvas, current, true);
      const ratio = clamp((current - started) / Math.max(ended - started, 0.01), 0, 1);
      updateProgress(ratio, `正在导出 MP4 ${formatTime(current)} / ${formatTime(ended)}`);
      if (current >= ended || els.sourceVideo.ended) {
        els.sourceVideo.pause();
        recorder.stop();
        resolve();
        return;
      }
      requestVideoCallback(els.sourceVideo, tick);
    };
    requestVideoCallback(els.sourceVideo, tick);
  });

  return {
    blob: await stopped,
    audioIncluded: Boolean(audioTrack),
  };
}

async function exportMp4ViaWebCodecs(output, fps, started, ended) {
  if (!("VideoEncoder" in window) || !("VideoFrame" in window)) {
    throw new Error("MP4_EXPORT_UNSUPPORTED");
  }
  const { Muxer, ArrayBufferTarget } = await import(MP4_MUXER_URL);
  const encoderConfig = await getSupportedAvcEncoderConfig(output.width, output.height, fps);
  if (!encoderConfig) {
    throw new Error("MP4_ENCODER_UNSUPPORTED");
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
    video: {
      codec: "avc",
      width: output.width,
      height: output.height,
      frameRate: fps,
    },
  });

  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(encoderConfig);

  const duration = Math.max(ended - started, 0.01);
  const frameDurationUs = Math.round(1000000 / fps);
  const totalFrames = Math.max(1, Math.ceil(duration * fps));

  for (let frameIndex = 0; frameIndex <= totalFrames; frameIndex += 1) {
    const time = Math.min(started + frameIndex / fps, ended);
    await seekVideo(time);
    drawFrame(exportCtx, els.exportCanvas, time, true);
    const frame = new VideoFrame(els.exportCanvas, {
      timestamp: Math.round((time - started) * 1000000),
      duration: frameDurationUs,
    });
    encoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % Math.max(1, fps * 2) === 0 });
    frame.close();

    if (encoder.encodeQueueSize > 12) {
      await encoder.flush();
    }
    updateProgress(frameIndex / totalFrames, `逐帧编码 MP4 ${frameIndex}/${totalFrames}`);
  }

  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  muxer.finalize();

  return {
    blob: new Blob([target.buffer], { type: "video/mp4" }),
    audioIncluded: false,
  };
}

function renderDemoFrame() {
  resizePreviewCanvas();
  ctx.clearRect(0, 0, els.previewCanvas.width, els.previewCanvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, els.previewCanvas.height);
  gradient.addColorStop(0, "#eef4fb");
  gradient.addColorStop(1, "#dde7f2");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, els.previewCanvas.width, els.previewCanvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillRect(els.previewCanvas.width * 0.12, els.previewCanvas.height * 0.22, els.previewCanvas.width * 0.16, els.previewCanvas.height * 0.48);
  ctx.fillRect(els.previewCanvas.width * 0.42, els.previewCanvas.height * 0.18, els.previewCanvas.width * 0.18, els.previewCanvas.height * 0.52);
  ctx.fillRect(els.previewCanvas.width * 0.72, els.previewCanvas.height * 0.26, els.previewCanvas.width * 0.13, els.previewCanvas.height * 0.42);

  drawOutline(ctx, {
    x: els.previewCanvas.width * 0.39,
    y: els.previewCanvas.height * 0.14,
    w: els.previewCanvas.width * 0.22,
    h: els.previewCanvas.height * 0.58,
  }, "#8dd1ff");

  ctx.fillStyle = "rgba(18,24,34,0.88)";
  ctx.fillRect(els.previewCanvas.width * 0.1, els.previewCanvas.height * 0.2, els.previewCanvas.width * 0.16, els.previewCanvas.height * 0.48);
  ctx.fillRect(els.previewCanvas.width * 0.7, els.previewCanvas.height * 0.24, els.previewCanvas.width * 0.13, els.previewCanvas.height * 0.42);

  els.canvasEmpty.style.display = "none";
  els.previewTitle.textContent = "Quiet Timeline 预览";
  els.fileMeta.textContent = "演示状态：上传横屏舞蹈视频后即可开始识别人物。";
  updateSelectionSummary();
}

function getActiveTrackIdAtTime(time) {
  if (!state.heroAssignments.length) return state.selectedTrackId;
  let active = state.heroAssignments[0]?.trackId || state.selectedTrackId;
  for (const assignment of state.heroAssignments) {
    if (assignment.time <= time) active = assignment.trackId;
    else break;
  }
  return active;
}

function upsertHeroAssignment(time, trackId) {
  const normalized = roundTime(time);
  state.heroAssignments = state.heroAssignments
    .filter((item) => Math.abs(item.time - normalized) > 0.04)
    .concat({ time: normalized, trackId })
    .sort((a, b) => a.time - b.time);
}

function resetProject(resetInput = true) {
  pausePreview();
  state.sourceLoaded = false;
  state.sourceFile = null;
  state.metadata = null;
  state.tracks = [];
  state.inspectTrackId = null;
  state.analysisFrames = [];
  state.selectedTrackId = null;
  state.heroAssignments = [];
  state.lastAnalysisCount = 0;
  state.lastPreviewBox = null;
  if (state.sourceUrl) {
    URL.revokeObjectURL(state.sourceUrl);
  }
  state.sourceUrl = "";
  els.sourceVideo.removeAttribute("src");
  els.timeline.value = "0";
  els.timeline.max = "0";
  els.trimStart.value = "0";
  els.trimEnd.value = "0";
  els.downloadLink.href = "#";
  els.downloadLink.classList.add("disabled");
  els.previewTitle.textContent = "等待视频";
  els.fileMeta.textContent = "支持本地横屏舞蹈视频。建议时长 3 分钟内以获得更快导出。";
  setStatus("analysis", "等待视频");
  setStatus("export", "未开始");
  renderTrackList();
  renderHeroKeyframes();
  renderDemoFrame();
  updateSelectionSummary();
  state.currentStep = 1;
  renderWorkflow();
  updateActionAvailability();
  if (resetInput) els.videoInput.value = "";
}

function resizePreviewCanvas() {
  const output = resolvePreviewSize();
  if (state.mode === "privacy") {
    fitCanvas(els.previewCanvas, 1280, 720);
  } else {
    fitCanvas(els.previewCanvas, output.width, output.height);
  }
}

function fitCanvas(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
}

function parseSize(value) {
  const [width, height] = value.split("x").map(Number);
  return { width, height };
}

function resolvePreviewSize() {
  const value = els.outputSize.value;
  if (!state.metadata) {
    return value.includes("x") ? parseSize(value) : { width: 720, height: 1280 };
  }
  if (value === "source-portrait") {
    return {
      width: Math.round(state.metadata.height * 9 / 16),
      height: state.metadata.height,
    };
  }
  if (value === "source-landscape") {
    return { width: state.metadata.width, height: state.metadata.height };
  }
  return parseSize(value);
}

function resolveOutputSize() {
  const value = els.outputSize.value;
  if (!state.metadata) return value.includes("x") ? parseSize(value) : { width: 720, height: 1280 };
  if (value === "source-portrait") {
    return {
      width: roundEven(state.metadata.height * 9 / 16),
      height: roundEven(state.metadata.height),
    };
  }
  if (value === "source-landscape") {
    return { width: roundEven(state.metadata.width), height: roundEven(state.metadata.height) };
  }
  const parsed = parseSize(value);
  return { width: roundEven(parsed.width), height: roundEven(parsed.height) };
}

function updateTimeLabel(currentTime) {
  const duration = state.metadata?.duration || 0;
  els.timeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

function setStatus(slot, text) {
  if (slot === "model") els.modelStatus.textContent = text;
  if (slot === "analysis") els.analysisStatus.textContent = text;
  if (slot === "export") els.exportStatus.textContent = text;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function updateSelectionSummary() {
  if (!els.selectionSummary) return;
  if (!state.tracks.length) {
    els.selectionSummary.textContent = "识别后选择一个主角，其他人物会自动按上面的方式处理。";
    return;
  }
  const activeTrackId = getActiveTrackIdAtTime(Number(els.timeline.value || 0)) || state.selectedTrackId;
  const selected = state.tracks.find((track) => track.id === activeTrackId);
  if (!selected) {
    els.selectionSummary.textContent = `当前识别到 ${state.tracks.length} 个候选人物，请先选一个主角。`;
    return;
  }
  els.selectionSummary.textContent =
    `当前时间点主角已选定，其他 ${Math.max(0, state.tracks.length - 1)} 人会自动按“${redactionStyleLabel()}”处理。`;
}

function updateActionAvailability() {
  if (els.exportButton) {
    els.exportButton.disabled = !state.selectedTrackId;
    els.exportButton.classList.toggle("disabled", !state.selectedTrackId);
  }
  if (els.clearKeyframesButton) {
    els.clearKeyframesButton.disabled = !state.selectedTrackId;
    els.clearKeyframesButton.classList.toggle("disabled", !state.selectedTrackId);
  }
  if (els.selectionCallout) {
    els.selectionCallout.style.display = state.tracks.length && !state.selectedTrackId ? "block" : "none";
  }
  if (els.candidatePrevButton) {
    const disabled = state.tracks.length <= 1;
    els.candidatePrevButton.disabled = disabled;
    els.candidatePrevButton.classList.toggle("disabled", disabled);
  }
  if (els.candidateNextButton) {
    const disabled = state.tracks.length <= 1;
    els.candidateNextButton.disabled = disabled;
    els.candidateNextButton.classList.toggle("disabled", disabled);
  }
  if (els.goStep2Button) {
    const disabled = !state.sourceLoaded;
    els.goStep2Button.disabled = disabled;
    els.goStep2Button.classList.toggle("disabled", disabled);
  }
  if (els.goStep3Button) {
    const disabled = !state.selectedTrackId;
    els.goStep3Button.disabled = disabled;
    els.goStep3Button.classList.toggle("disabled", disabled);
  }
  if (els.goStep4Button) {
    const disabled = !state.selectedTrackId;
    els.goStep4Button.disabled = disabled;
    els.goStep4Button.classList.toggle("disabled", disabled);
  }
}

function updateCandidateIndicator() {
  if (!els.candidateIndicator) return;
  if (!state.tracks.length) {
    els.candidateIndicator.textContent = "当前预览：未选择候选人";
    return;
  }
  const activeId = state.inspectTrackId || state.selectedTrackId || state.tracks[0]?.id;
  const index = state.tracks.findIndex((track) => track.id === activeId);
  const current = state.tracks[index];
  if (!current) {
    els.candidateIndicator.textContent = "当前预览：未选择候选人";
    return;
  }
  els.candidateIndicator.textContent = `当前预览：人物 ${index + 1}（${current.id}）`;
}

async function cycleInspectedTrack(direction) {
  if (!state.tracks.length) return;
  const activeId = state.inspectTrackId || state.selectedTrackId || state.tracks[0].id;
  const currentIndex = Math.max(0, state.tracks.findIndex((track) => track.id === activeId));
  const nextIndex = (currentIndex + direction + state.tracks.length) % state.tracks.length;
  state.inspectTrackId = state.tracks[nextIndex].id;
  state.lastPreviewBox = null;
  renderTrackList();
  await renderCurrentFrame();
}

function getMaxAccessibleStep() {
  if (!state.sourceLoaded) return 1;
  if (!state.analysisFrames.length) return 2;
  if (!state.selectedTrackId) return 2;
  if (!state.heroAssignments.length) return 3;
  return 4;
}

function navigateToStep(step) {
  const maxStep = getMaxAccessibleStep();
  if (step < 1 || step > maxStep) return;
  state.currentStep = step;
  renderWorkflow();
}

function createDownloadName(extension = "webm") {
  const suffix = state.mode === "portrait" ? "single-performer" : "redacted";
  const source = (state.sourceFile?.name || "dance-video").replace(/\.[^.]+$/, "");
  return `${source}-${suffix}.${extension}`;
}

function demoTracks() {
  return [];
}

async function seekVideo(time) {
  if (!state.sourceLoaded) return;
  await new Promise((resolve) => {
    const targetTime = clamp(time, 0, state.metadata.duration);
    if (Math.abs((els.sourceVideo.currentTime || 0) - targetTime) < 0.02) {
      resolve();
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      els.sourceVideo.removeEventListener("seeked", done);
      els.sourceVideo.removeEventListener("timeupdate", onTimeUpdate);
      clearTimeout(timer);
      resolve();
    };

    const onTimeUpdate = () => {
      if (Math.abs((els.sourceVideo.currentTime || 0) - targetTime) < 0.05) {
        done();
      }
    };

    const timer = setTimeout(() => {
      done();
    }, 1500);

    els.sourceVideo.addEventListener("seeked", done);
    els.sourceVideo.addEventListener("timeupdate", onTimeUpdate);
    els.sourceVideo.currentTime = targetTime;
  });
}

function waitForVideoMetadata(video, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("abort", onAbort);
    };

    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`VIDEO_LOAD_ERROR_${video.error?.code || "UNKNOWN"}`));
    };
    const onStalled = () => {
      cleanup();
      reject(new Error("VIDEO_LOAD_STALLED"));
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("VIDEO_LOAD_ABORTED"));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("VIDEO_LOAD_TIMEOUT"));
    }, timeoutMs);

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.addEventListener("stalled", onStalled, { once: true });
    video.addEventListener("abort", onAbort, { once: true });
  });
}

function explainVideoLoadError(error, file) {
  const extension = (file?.name?.split(".").pop() || "").toLowerCase();
  if (extension === "mov") {
    return "这个 MOV 视频在当前浏览器里没成功解码，通常是 HEVC/H.265 编码导致。建议先转成 MP4（H.264）再试。";
  }
  if (String(error?.message || "").includes("VIDEO_LOAD_TIMEOUT")) {
    return "视频加载超时。文件可能过大、编码不兼容，或当前浏览器没有正确解析这个视频。";
  }
  if (String(error?.message || "").includes("VIDEO_LOAD_ERROR")) {
    return "浏览器没能解码这个视频。最常见原因是编码格式不兼容，建议改成 MP4（H.264 + AAC）后再上传。";
  }
  return "视频没有成功加载。建议优先使用 MP4（H.264）格式再试一次。";
}

function explainModelLoadError(error) {
  if (String(error?.message || "").includes("MODEL_LOAD_TIMEOUT")) {
    return "识别模型加载超时。当前更像是浏览器端模型资源没有成功初始化，请刷新页面后重试；如果还不行，我会继续把模型改成本地文件。";
  }
  return "模型加载失败。请确认当前网络可访问 jsDelivr 和 Google Storage，然后刷新页面重试。";
}

function explainMp4ExportError(error) {
  const message = String(error?.message || "");
  if (message.includes("MP4_EXPORT_UNSUPPORTED") || message.includes("MP4_ENCODER_UNSUPPORTED")) {
    return "当前浏览器不支持 MP4/H.264 导出。请优先使用最新版 Safari 或 Chrome，并通过 http://127.0.0.1 打开页面。";
  }
  return "MP4 导出失败。请重试，或降低输出分辨率后再导出。";
}

function updateIndicators() {
  if (els.samplingIndicator) {
    els.samplingIndicator.textContent = `${els.sampleRate.value}s`;
  }
  if (els.fpsIndicator) {
    els.fpsIndicator.textContent = `${els.fps.value} fps`;
  }
}

function getSupportedMp4RecorderMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.4d0028,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function getSupportedAvcEncoderConfig(width, height, fps) {
  const candidates = [
    "avc1.640028",
    "avc1.4d0028",
    "avc1.42E01E",
  ];
  for (const codec of candidates) {
    const config = {
      codec,
      width,
      height,
      bitrate: recommendedVideoBitrate(width, height, fps),
      framerate: fps,
      avc: { format: "avc" },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support?.supported) return config;
    } catch {
      // continue
    }
  }
  return null;
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds || 0);
  const mins = String(Math.floor(safe / 60)).padStart(2, "0");
  const secs = String(Math.floor(safe % 60)).padStart(2, "0");
  return `${mins}:${secs}`;
}

function roundTime(value) {
  return Math.round(value * 100) / 100;
}

function roundEven(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function recommendedVideoBitrate(width, height, fps) {
  const megapixels = (width * height) / 1000000;
  const rate = megapixels * fps * 180000;
  return clamp(Math.round(rate), 12000000, 60000000);
}

function requestVideoCallback(video, callback) {
  if ("requestVideoFrameCallback" in video) {
    return video.requestVideoFrameCallback(() => callback());
  }
  return requestAnimationFrame(callback);
}

function cancelVideoCallback(video, handle) {
  if (!handle) return;
  if ("cancelVideoFrameCallback" in video) {
    video.cancelVideoFrameCallback(handle);
    return;
  }
  cancelAnimationFrame(handle);
}

function redactionStyleLabel() {
  return {
    mosaic: "马赛克",
    blur: "模糊",
    solid: "纯色遮挡",
  }[els.redactionStyle.value] || "马赛克";
}

function dedupeBoxes(boxes) {
  return boxes
    .sort((a, b) => b.score - a.score)
    .filter((box, index, list) => {
      for (let i = 0; i < index; i += 1) {
        const previous = list[i];
        if (intersectionOverUnion(previous, box) > 0.52) return false;
      }
      return box.w * box.h > state.metadata.width * state.metadata.height * 0.008;
    });
}

function mergeTracks(tracks) {
  const consumed = new Set();
  const merged = [];

  for (let i = 0; i < tracks.length; i += 1) {
    if (consumed.has(tracks[i].id)) continue;
    const base = {
      ...tracks[i],
      samples: [...tracks[i].samples],
    };

    for (let j = i + 1; j < tracks.length; j += 1) {
      if (consumed.has(tracks[j].id)) continue;
      if (!shouldMergeTracks(base, tracks[j])) continue;
      consumed.add(tracks[j].id);
      base.samples = [...base.samples, ...tracks[j].samples].sort((a, b) => a.time - b.time);
    }

    base.coverage = base.samples.length;
    base.averageArea =
      base.samples.reduce((sum, sample) => sum + sample.box.w * sample.box.h, 0) / Math.max(1, base.coverage);
    merged.push(base);
  }

  return merged;
}

function shouldMergeTracks(a, b) {
  const overlapping = [];
  for (const sa of a.samples) {
    const sb = b.samples.find((item) => Math.abs(item.time - sa.time) <= 0.2);
    if (!sb) continue;
    overlapping.push(intersectionOverUnion(sa.box, sb.box));
  }
  if (!overlapping.length) return false;
  const averageOverlap = overlapping.reduce((sum, value) => sum + value, 0) / overlapping.length;
  const areaRatio = Math.min(a.averageArea, b.averageArea) / Math.max(a.averageArea, b.averageArea);
  return averageOverlap > 0.34 && areaRatio > 0.45;
}

function intersectionOverUnion(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - overlap;
  return union ? overlap / union : 0;
}

function intersectBoxes(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function centerDistance(a, b) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function colorForIndex(index) {
  return ["#79aafc", "#9ad8c3", "#f7b27a", "#d3a7ff", "#9ed2ff", "#ffc778"][index % 6];
}
