import {
  EVENT_TYPES, RESULTS, formatTime, escapeHtml, computeSummary, generateInsights,
  buildRuleCandidates, motionScoresToCandidates, shotScoresToCandidates, panScoresToCandidates, evaluateShotDetection,
  mergeShotCandidateLists, mergeCandidateLists, createPatchTemplate, findPatchTemplate,
  buildColumnEdgeSignature, estimateColumnShift, createDemoSegments, segmentsToCsv
} from "./core.js";
import { createCanonicalFrameReader, smoothPanSamples } from "./frame-sampling.js";
import { createIndexedFrameSeeker } from "./frame-timing.js";
import { scanBounds } from "./scan-range.js";
import { fingerprintFrame } from "./frame-evidence.js";
import { createScanCoordinator } from "./scan-session.js";
import { parseFrozenTruth, matchesFrozenSelection } from "./truth-identity.js";
import { createRecoveringSeeker } from "./frame-recovery.js";
import { truthPathFor } from "./truth-catalog.js";
import { collectFrozenBatch } from "./frozen-batch.js";
import { mountReviewWorkbench } from "./review-workbench.js";
import { captureReviewCandidates } from "./review-candidates.js";
import { reviewSourceReady } from "./review-media.js";

const $ = (selector) => document.querySelector(selector);
let frozenCatalog = [];
let renderedFrozenVideo = null;
const savedDatasets = loadDatasets();
const state = {
  datasets: savedDatasets,
  videoKey: "legacy",
  segments: savedDatasets.legacy || loadSegments(),
  selectedId: null,
  markStart: null,
  markEnd: null,
  videoDuration: 0,
  videoName: "",
  videoSourcePath: null,
  reviewBlob: null,
  reviewCandidateRun: null,
  reviewExpectedSrc: null,
  hoop: loadHoop(),
  calibratingHoop: false,
  viewReference: null,
  hoopTemplate: null,
  referenceTime: 0,
  pendingReferenceCapture: false,
  shotProfileId: null,
  reviewStartedAt: null,
  reviewHistory: [],
  lastPanScan: null,
  groundTruthMeta: null
};

const video = $("#video");
const indexedFrames = createIndexedFrameSeeker(video, location.origin);
const videoStage = $("#videoStage");
const timeline = $("#timeline");
let datasetRevision = 0;
const scanCoordinator = createScanCoordinator(() => JSON.stringify([
  datasetRevision, state.videoKey, video.src, video.currentSrc
]));

function beginScan() {
  const session = scanCoordinator.begin();
  if (!session) notify("已有扫描正在运行，请等待完成后再开始");
  if (session) state.reviewCandidateRun = null;
  return session;
}

function loadSegments() {
  try { return JSON.parse(localStorage.getItem("courtvision-segments") || "[]"); }
  catch { return []; }
}

function loadHoop() {
  try { return JSON.parse(localStorage.getItem("courtvision-hoop") || "null"); }
  catch { return null; }
}

function loadDatasets() {
  try { return JSON.parse(localStorage.getItem("courtvision-datasets") || "{}"); }
  catch { return {}; }
}

function switchDataset(key) {
  state.reviewExpectedSrc = null;
  state.reviewCandidateRun = null;
  state.reviewBlob = null;
  datasetRevision += 1;
  state.videoSourcePath = null;
  state.calibratingHoop = false;
  $("#calibrationFrame").hidden = true;
  videoStage.classList.remove("calibrating");
  state.datasets[state.videoKey] = state.segments;
  state.videoKey = key;
  try { state.lastPanScan = JSON.parse(localStorage.getItem(`courtvision-pan-scan:${key}`) || "null"); }
  catch { state.lastPanScan = null; }
  try { state.groundTruthMeta = JSON.parse(localStorage.getItem(`courtvision-truth-meta:${key}`) || "null"); }
  catch { state.groundTruthMeta = null; }
  state.segments = state.datasets[key] ? [...state.datasets[key]] : [];
  state.selectedId = null;
  state.markStart = null;
  state.markEnd = null;
  updateRange();
}

function persist() {
  state.datasets[state.videoKey] = state.segments;
  localStorage.setItem("courtvision-datasets", JSON.stringify(state.datasets));
  $("#saveState").textContent = "已本地保存";
}

function populateOptions() {
  $("#event").innerHTML = EVENT_TYPES.map((item) => `<option>${item}</option>`).join("");
  $("#result").innerHTML = RESULTS.map((item) => `<option>${item}</option>`).join("");
  $("#eventFilter").innerHTML += EVENT_TYPES.map((item) => `<option>${item}</option>`).join("");
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 1800);
}

function render() {
  renderFrozenRanges();
  const eventFilter = $("#eventFilter").value;
  const statusFilter = $("#statusFilter").value;
  const visible = state.segments.filter((item) =>
    (eventFilter === "全部" || item.event === eventFilter) &&
    (statusFilter === "全部" || item.status === statusFilter)
  );

  $("#segmentRows").innerHTML = visible.map((item) => `
    <tr data-id="${escapeHtml(item.id)}">
      <td><strong>${formatTime(item.start)}–${formatTime(item.end)}</strong><small>${Math.max(0, Math.round(item.end - item.start))} 秒</small></td>
      <td><strong>${escapeHtml(item.team || "待判断")}</strong><small>${escapeHtml(item.player || "未填写球员")}</small></td>
      <td>${escapeHtml(item.event)}</td><td>${escapeHtml(item.result)}</td><td>${escapeHtml(item.zone)}</td>
      <td><span class="pill ${item.status === "待确认" ? "pending" : item.status === "已排除" ? "excluded" : ""}">${escapeHtml(item.status)}</span>${item.reviewReason ? `<small>${escapeHtml(item.reviewReason)}</small>` : ""}</td>
      <td>${["shot-roi", "camera-pan"].includes(item.source) && item.status === "待确认"
        ? '<button class="row-action seek-action">回看</button><button class="row-action review-made">命中</button><button class="row-action review-missed">未中</button><button class="row-action review-false">误报</button>'
        : '<button class="row-action seek-action">回看</button><button class="row-action delete-action">删除</button>'}</td>
    </tr>`).join("");
  $("#noSegments").classList.toggle("visible", visible.length === 0);

  const summary = computeSummary(state.segments);
  const undoEntry = state.reviewHistory.at(-1);
  const undoButton = $("#undoReview");
  undoButton.disabled = !undoEntry || undoEntry.videoKey !== state.videoKey;
  $("#metricPossessions").textContent = summary.possessions;
  $("#metricPending").textContent = `${summary.pending} 个待确认`;
  $("#metricFg").textContent = summary.reviewed ? `${Math.round(summary.fieldGoalRate * 100)}%` : "—";
  $("#metricTurnovers").textContent = summary.turnovers;
  $("#metricPnR").textContent = state.segments.some((item) => item.status === "已确认" && item.event === "挡拆") ? `${Math.round(summary.pickRollRate * 100)}%` : "—";
  $("#metricCorrection").textContent = summary.meanBoundaryCorrection == null ? "—" : `${summary.meanBoundaryCorrection.toFixed(1)}秒`;
  $("#metricCorrectionSample").textContent = summary.reviewedBoundaries ? `${summary.reviewedBoundaries} 个算法片段` : "等待人工确认";
  $("#metricShots").textContent = summary.shotCandidates;
  $("#metricShotDetail").textContent = summary.meanReviewSeconds == null
    ? `${summary.excluded} 个已排除`
    : `${summary.excluded} 个已排除 · 平均 ${summary.meanReviewSeconds.toFixed(1)} 秒/条`;
  const evaluationRange = getEvaluationRange();
  const evaluation = evaluateShotDetection(state.segments, 4, evaluationRange);
  $("#evaluationRange").textContent = `${formatTime(evaluationRange.start)}–${formatTime(evaluationRange.end)}`;
  $("#truthCount").textContent = evaluation.truths;
  $("#evaluationMatches").textContent = `${evaluation.matched}/${evaluation.predictions}`;
  $("#evaluationPrecision").textContent = evaluation.predictions ? `${Math.round(evaluation.precision * 100)}%` : "—";
  $("#evaluationRecall").textContent = evaluation.truths ? `${Math.round(evaluation.recall * 100)}%` : "—";
  $("#evaluationF1").textContent = evaluation.predictions && evaluation.truths ? `${Math.round(evaluation.f1 * 100)}%` : "—";
  $("#evaluationError").textContent = evaluation.meanError == null ? "—" : `${evaluation.meanError.toFixed(1)}秒`;
  const truthMeta = state.groundTruthMeta;
  const splitLabels = { training: "训练集", validation: "验证集", "held-out validation; not used for parameter selection": "独立验证集", "final untouched test": "最终测试集", "final untouched test; algorithms were not run on this range before labels were frozen": "最终测试集（标签先冻结）", "extended untouched audit; labels frozen before any algorithm run on this range": "扩展审计集（标签先冻结）", "second extended untouched audit; labels frozen before any algorithm run on this range": "审计二段（标签先冻结）", "cross-game untouched test; labels frozen before any algorithm run on this video": "跨比赛测试（标签先冻结）", "cross-game second untouched audit; labels frozen before any algorithm run on this range": "跨比赛审计二段（标签先冻结）", "third-game untouched test; labels frozen before any algorithm run on this video": "第三场测试（标签先冻结）" };
  const definition = truthMeta?.definition?.startsWith("Live-ball") ? "只统计运动战出手，排除罚球" : truthMeta?.definition;
  $("#truthDatasetInfo").textContent = truthMeta
    ? `${splitLabels[truthMeta.split] || truthMeta.split || "未分组"} · ${formatTime(truthMeta.reviewedRange.start)}–${formatTime(truthMeta.reviewedRange.end)} · ${truthMeta.shots} 次出手 · ${definition || ""}`
    : "当前真值未声明训练 / 验证 / 测试分组";
  $("#precisionInterval").textContent = formatInterval(evaluation.precisionInterval);
  $("#recallInterval").textContent = formatInterval(evaluation.recallInterval);
  const comparisons = [
    ["镜头横移", ["camera-pan"], 0],
    ["篮筐局部", ["shot-roi"], 0],
    ["融合去重", ["shot-roi", "camera-pan"], 3]
  ].map(([label, sources, mergeGap]) => ({ label, result: evaluateShotDetection(state.segments, 4, { ...evaluationRange, sources, mergeGap }) }));
  $("#algorithmComparisonRows").innerHTML = comparisons.map(({ label, result }) => `
    <tr><th>${label}</th><td>${result.predictions}</td><td>${Math.round(result.precision * 100)}%</td><td>${Math.round(result.recall * 100)}%</td><td><strong>${Math.round(result.f1 * 100)}%</strong></td></tr>`).join("");
  $("#insightList").innerHTML = generateInsights(state.segments).map((text) => `<li>${escapeHtml(text)}</li>`).join("");
  renderTimeline();
  bindRows();
}

function getEvaluationRange() {
  const { start, end } = scanBounds($("#shotStart")?.value, $("#shotMinutes")?.value, state.groundTruthMeta?.reviewedRange);
  const algorithm = $("#evaluationSource")?.value || "camera-pan";
  const sources = algorithm === "all" ? ["shot-roi", "camera-pan"] : [algorithm];
  return { start, end, sources, mergeGap: algorithm === "all" ? 3 : 0 };
}

function formatInterval(interval) {
  return interval ? `95%区间 ${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%` : "样本不足";
}

function renderTimeline() {
  const maxEnd = Math.max(1, state.videoDuration, ...state.segments.map((item) => item.end));
  timeline.innerHTML = state.segments.map((item) => {
    const left = item.start / maxEnd * 100;
    const width = Math.max(.5, (item.end - item.start) / maxEnd * 100);
    return `<button class="timeline-marker ${item.status === "待确认" ? "pending" : ""} ${item.source === "shot-roi" ? "shot" : ""} ${item.source === "camera-pan" ? "pan" : ""} ${item.source === "human-truth" ? "truth" : ""}" data-id="${escapeHtml(item.id)}" style="left:${left}%;width:${width}%" title="${escapeHtml(item.event)} ${formatTime(item.start)}"></button>`;
  }).join("");
  timeline.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectSegment(button.dataset.id, true)));
}

function bindRows() {
  $("#segmentRows").querySelectorAll("tr").forEach((row) => {
    row.querySelector(".seek-action").addEventListener("click", () => selectSegment(row.dataset.id, true));
    row.querySelector(".review-made")?.addEventListener("click", () => reviewCandidate(row.dataset.id, "命中"));
    row.querySelector(".review-missed")?.addEventListener("click", () => reviewCandidate(row.dataset.id, "未中"));
    row.querySelector(".review-false")?.addEventListener("click", () => reviewCandidate(row.dataset.id, null));
    row.querySelector(".delete-action")?.addEventListener("click", () => {
      state.segments = state.segments.filter((item) => item.id !== row.dataset.id);
      persist(); render(); notify("片段已删除");
    });
  });
}

function reviewCandidate(id, result) {
  const item = state.segments.find((segment) => segment.id === id);
  if (!item) return;
  state.reviewHistory.push({ videoKey: state.videoKey, id, before: { ...item } });
  if (state.reviewHistory.length > 20) state.reviewHistory.shift();
  item.status = result ? "已确认" : "已排除";
  if (result) {
    item.result = result;
    delete item.reviewReason;
  } else {
    item.reviewReason = $("#falseReason")?.value || "未分类";
  }
  item.reviewedAt = new Date().toISOString();
  if (state.selectedId === id && Number.isFinite(state.reviewStartedAt)) item.reviewSeconds = Number(((Date.now() - state.reviewStartedAt) / 1000).toFixed(1));
  persist(); render();
  notify(result ? `已确认：${result}` : "已标为误报");
}

function undoLastReview() {
  let entry;
  while (state.reviewHistory.length) {
    const candidate = state.reviewHistory.pop();
    if (candidate.videoKey === state.videoKey) { entry = candidate; break; }
  }
  if (!entry) { notify("没有可撤销的复核"); render(); return; }
  const index = state.segments.findIndex((item) => item.id === entry.id);
  if (index < 0) { notify("原候选已不存在"); render(); return; }
  state.segments[index] = { ...entry.before };
  state.selectedId = entry.id;
  persist(); render();
  selectSegment(entry.id, false);
  notify("已撤销上次复核");
}

function pendingCandidates() {
  return state.segments
    .filter((item) => ["shot-roi", "camera-pan"].includes(item.source) && item.status === "待确认")
    .sort((a, b) => a.peakTime - b.peakTime);
}

function selectPending(direction = 1) {
  const candidates = pendingCandidates();
  if (!candidates.length) { notify("没有待确认候选"); return; }
  const current = candidates.findIndex((item) => item.id === state.selectedId);
  const index = current < 0 ? (direction > 0 ? 0 : candidates.length - 1) : (current + direction + candidates.length) % candidates.length;
  selectSegment(candidates[index].id, false);
}

function reviewSelected(result) {
  const item = state.segments.find((segment) => segment.id === state.selectedId);
  if (!item || !["shot-roi", "camera-pan"].includes(item.source) || item.status !== "待确认") {
    notify("请先用 J/K 选择待确认候选");
    return;
  }
  const time = item.peakTime;
  reviewCandidate(item.id, result);
  const remaining = pendingCandidates();
  const next = remaining.find((candidate) => candidate.peakTime > time) || remaining[0];
  if (next) selectSegment(next.id, false);
}

function selectSegment(id, shouldPlay = false) {
  const item = state.segments.find((segment) => segment.id === id);
  if (!item) return;
  if (shouldPlay) { window.location.hash = "workspace"; showPage(); }
  state.selectedId = id;
  if (["shot-roi", "camera-pan"].includes(item.source) && item.status === "待确认") state.reviewStartedAt = Date.now();
  state.markStart = item.start;
  state.markEnd = item.end;
  $("#team").value = item.team === "待判断" ? "" : item.team;
  $("#player").value = item.player || "";
  if (EVENT_TYPES.includes(item.event)) $("#event").value = item.event;
  if (RESULTS.includes(item.result)) $("#result").value = item.result;
  if ([...$("#zone").options].some((option) => option.value === item.zone)) $("#zone").value = item.zone;
  $("#note").value = item.note || "";
  updateRange();
  if (video.src && Number.isFinite(item.start)) {
    const isPointEvent = ["shot-roi", "camera-pan", "human-truth"].includes(item.source) && Number.isFinite(item.peakTime);
    video.currentTime = isPointEvent ? item.peakTime : item.start;
    if (isPointEvent) video.pause();
    else if (shouldPlay) video.play().catch(() => {});
  } else if (shouldPlay) {
    notify("演示标签已选中；载入录像后可跳转核查");
  }
}

function updateRange() {
  $("#markRange").textContent = `${state.markStart == null ? "--:--" : formatTime(state.markStart)} → ${state.markEnd == null ? "--:--" : formatTime(state.markEnd)}`;
}

function addOrConfirm(status = "已确认") {
  const start = state.markStart ?? Math.max(0, video.currentTime - 5);
  const end = state.markEnd ?? Math.min(state.videoDuration || video.currentTime + 10, video.currentTime + 10);
  if (!(end > start)) { notify("请先设置有效的开始和结束时间"); return; }
  const existingIndex = state.segments.findIndex((item) => item.id === state.selectedId);
  const existing = existingIndex >= 0 ? state.segments[existingIndex] : {};
  const item = {
    ...existing,
    id: existing.id || `clip-${Date.now()}`,
    start, end,
    team: $("#team").value.trim() || "待判断",
    player: $("#player").value.trim(),
    event: $("#event").value,
    result: $("#result").value,
    zone: $("#zone").value,
    note: $("#note").value.trim(),
    confidence: existing.confidence || 1,
    status,
    boundaryCorrection: existing.suggestedStart == null || status !== "已确认" ? existing.boundaryCorrection : Number(((Math.abs(start - existing.suggestedStart) + Math.abs(end - existing.suggestedEnd)) / 2).toFixed(2))
  };
  if (existingIndex >= 0) state.segments[existingIndex] = item;
  else state.segments.push(item);
  state.segments.sort((a, b) => a.start - b.start);
  state.selectedId = item.id;
  persist(); render(); notify(status === "已确认" ? "片段已确认" : "片段已加入");
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

let videoLoadSequence = 0;
const deliveryConfig = fetch('/courtvision/sample-delivery.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
async function loadVideoSource(src, name, meta) {
  state.reviewExpectedSrc = null;
  const sequence = ++videoLoadSequence;
  state.videoSourcePath = src;
  window.location.hash = 'workspace'; showPage();
  if (video.src.startsWith("blob:")) { indexedFrames.forget(video.src); URL.revokeObjectURL(video.src); }
  state.videoName = name;
  $("#videoTitle").textContent = name;
  $("#videoMeta").textContent = meta;
  videoStage.classList.remove("empty");
  $("#analysisStatus").textContent = "录像载入中…";
  $("#motionChart").innerHTML = "";
  showHoopMarker();
  try {
    const delivery = (await deliveryConfig)[src];
    if (sequence !== videoLoadSequence) return;
    if (delivery?.parts) {
      const parts = [];
      for (const part of delivery.parts) {
        const response = await fetch(part.url);
        if (!response.ok) throw new Error('样本下载失败，请重试');
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256',bytes);
        const hash = [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
        if (hash !== part.sha256) throw new Error('样本校验失败，请重试');
        if (sequence !== videoLoadSequence) return;
        parts.push(bytes);
        $('#analysisStatus').textContent = `正在载入样本 ${parts.length}/${delivery.parts.length}`;
      }
      const blob = new Blob(parts,{type:delivery.type});
      parts.length = 0; // Blob owns immutable content; release download buffers before hashing.
      if (blob.size !== delivery.size) throw new Error('录像总长度校验失败');
      const blobUrl = URL.createObjectURL(blob);
      try {
        await indexedFrames.bindVerifiedBlob(blobUrl,blob,src,{
          assertCurrent:()=>{if(sequence!==videoLoadSequence) throw new Error('录像已切换，取消校验');},
          onProgress:(done,total)=>{$('#analysisStatus').textContent=`正在校验录像 ${Math.round(done/total*100)}%`;}
        });
        if (sequence !== videoLoadSequence) { indexedFrames.forget(blobUrl); URL.revokeObjectURL(blobUrl); return; }
        video.removeAttribute('crossorigin');
        video.src = blobUrl;
        state.reviewBlob = blob;
        state.reviewExpectedSrc = video.src;
      } catch (error) { indexedFrames.forget(blobUrl); URL.revokeObjectURL(blobUrl); throw error; }
    } else {
      if (delivery?.url) { video.crossOrigin = 'anonymous'; $('#videoMeta').textContent = 'HCTV · CC BY 4.0 · 原始站点 VP9 转码 · 需联网'; }
      else video.removeAttribute('crossorigin');
      video.src = delivery?.url || src;
      state.reviewExpectedSrc = video.src;
    }
  } catch (error) {
    if (sequence === videoLoadSequence) { $('#analysisStatus').textContent = error.message; notify(error.message); }
  }
}

function showHoopMarker() {
  const marker = $("#hoopMarker");
  if (!state.hoop || videoStage.classList.contains("empty")) {
    marker.style.display = "none";
    return;
  }
  marker.style.display = "block";
  marker.style.left = `${state.hoop.x * 100}%`;
  marker.style.top = `${state.hoop.y * 100}%`;
  $("#shotStatus").textContent = `篮筐已标定：横向 ${(state.hoop.x * 100).toFixed(0)}% · 纵向 ${(state.hoop.y * 100).toFixed(0)}%`;
}

function captureViewReference() {
  if (!video.videoWidth || video.readyState < 2) return false;
  const { pixels, grayscale, width, height } = createCanonicalFrameReader(video)();
  state.viewReference = buildViewSignature(pixels, width, height);
  state.hoopTemplate = createPatchTemplate(
    grayscale, width, height,
    state.hoop.x * width, state.hoop.y * height,
    14, 10, 2
  );
  state.referenceTime = video.currentTime || 0;
  state.pendingReferenceCapture = false;
  return true;
}

function buildViewSignature(pixels, width, height, columns = 10, rows = 6) {
  const sums = Array.from({ length: columns * rows }, () => [0, 0, 0, 0]);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const cell = Math.min(rows - 1, Math.floor(y / height * rows)) * columns + Math.min(columns - 1, Math.floor(x / width * columns));
      sums[cell][0] += pixels[index];
      sums[cell][1] += pixels[index + 1];
      sums[cell][2] += pixels[index + 2];
      sums[cell][3] += 1;
    }
  }
  return sums.flatMap(([red, green, blue, count]) => [red / count, green / count, blue / count]);
}

function signatureDifference(left, right) {
  if (!left?.length || left.length !== right.length) return Infinity;
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / left.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function resetVideoDecoder(time) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, metadata) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", ready);
      error ? reject(error) : resolve(metadata);
    };
    const ready = async () => {
      try {
        const metadata = await indexedFrames.seek(Math.min(time, Math.max(0, video.duration - .05)));
        finish(null, metadata);
      } catch (error) {
        finish(error);
      }
    };
    const timer = window.setTimeout(() => finish(new Error("视频解码器重置超时")), 12000);
    video.addEventListener("loadedmetadata", ready, { once: true });
    try { video.load(); } catch (error) { finish(error); }
  });
}

function renderMotionChart(samples) {
  const max = Math.max(1, ...samples.map((item) => item.score));
  $("#motionChart").innerHTML = samples.map((item) =>
    `<span style="height:${Math.max(4, item.score / max * 100)}%" title="${formatTime(item.time)} · ${item.score.toFixed(1)}"></span>`
  ).join("");
}

async function analyzeVideoMotion() {
  if (!video.src || !Number.isFinite(video.duration) || !video.duration) {
    notify("请先载入一段录像");
    return;
  }
  const session = beginScan();
  if (!session) return;
  const button = $("#motionAnalyze");
  button.disabled = true;
  button.textContent = "正在读取画面…";
  video.scrollIntoView({ block: "center" });
  const wasPaused = video.paused;
  video.pause();
  const originalTime = video.currentTime;
  const readFrame = createCanonicalFrameReader(video);
  const interval = Math.max(1, video.duration / 120);
  const samples = [];
  let previous = null;

  try {
    for (let time = 0; time < video.duration; time += interval) {
      session.assertCurrent();
      const frameMetadata = await indexedFrames.seek(Math.min(time, Math.max(0, video.duration - .05)));
      session.assertCurrent();
      const { pixels } = readFrame();
      let difference = 0;
      let compared = 0;
      if (previous) {
        for (let index = 0; index < pixels.length; index += 16) {
          difference += Math.abs(pixels[index] - previous[index]);
          difference += Math.abs(pixels[index + 1] - previous[index + 1]);
          difference += Math.abs(pixels[index + 2] - previous[index + 2]);
          compared += 3;
        }
      }
      samples.push({ time, mediaTime: frameMetadata.mediaTime, score: previous ? difference / compared : 0 });
      previous = new Uint8ClampedArray(pixels);
      if (samples.length % 8 === 0) {
        const percent = Math.min(100, Math.round(time / video.duration * 100));
        $("#analysisStatus").textContent = `实际采样视频帧 ${percent}%`;
        renderMotionChart(samples);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    session.assertCurrent();
    const candidates = motionScoresToCandidates(samples.slice(1), video.duration);
    if (!candidates.length) throw new Error("有效采样不足");
    state.segments = state.segments.filter((item) => item.source === "human-truth").concat(candidates);
    state.selectedId = null;
    persist(); render(); renderMotionChart(samples.slice(1));
    const mean = samples.slice(1).reduce((sum, item) => sum + item.score, 0) / Math.max(1, samples.length - 1);
    $("#analysisStatus").textContent = `已采样 ${samples.length} 帧 · 平均活跃度 ${mean.toFixed(1)} · 生成 ${candidates.length} 个候选`;
    notify("画面分析完成，请人工核查候选边界");
  } catch (error) {
    $("#analysisStatus").textContent = `分析失败：${error.message}`;
    notify("画面分析失败，可使用规则候选");
  } finally {
    const restorePlayback = session.isCurrent();
    session.release();
    if (restorePlayback) {
      video.currentTime = Math.min(originalTime, video.duration || 0);
      if (!wasPaused) video.play().catch(() => {});
    }
    button.disabled = false;
    button.textContent = "重新分析画面";
  }
}

async function analyzeShotCandidates() {
  if (!state.hoop) { notify("请先点击“标定篮筐”并在画面点篮筐中心"); return; }
  if (!video.src || !Number.isFinite(video.duration) || !video.duration) { notify("请先载入录像"); return; }

  const session = beginScan();
  if (!session) return;
  const runId = crypto.randomUUID();
  state.lastPanScan = null;
  localStorage.removeItem(`courtvision-pan-scan:${state.videoKey}`);
  const button = $("#shotAnalyze");
  const scanStartedAt = performance.now();
  button.disabled = true;
  button.textContent = "正在扫描篮筐区域…";
  video.scrollIntoView({ block: "center" });
  const wasPaused = video.paused;
  const originalTime = video.currentTime;
  video.pause();
  const frameSize = { width: 160, height: 90 };
  const readFrame = createCanonicalFrameReader(video, frameSize.width, frameSize.height);
  const requestedRange = scanBounds($("#shotStart").value, $("#shotMinutes").value, state.groundTruthMeta?.reviewedRange);
  const scanStart = Math.min(requestedRange.start, Math.max(0, video.duration - .5));
  const scanEnd = Math.min(video.duration, requestedRange.end);
  const interval = scanEnd - scanStart <= 300 ? .25 : .5;
  const samples = [];
  let previous = null;
  let previousColumns = null;
  let trackedCenter = null;
  let calibration = null;
  const recoveringSeeker = createRecoveringSeeker({
    seek: target => indexedFrames.seek(target),
    reset: target => resetVideoDecoder(target),
    assertCurrent: () => session.assertCurrent(),
    onRecovery: (target, count, maximum) => {
      $("#shotStatus").textContent = `重试同一帧 ${formatTime(target)} · 恢复 ${count}/${maximum}`;
    }
  });

  try {
    if (state.referenceTime < scanStart || state.referenceTime > scanEnd) throw new Error("篮筐标定时刻不在扫描区间内");
    const referenceTarget = Math.min(state.referenceTime || 0, Math.max(0, video.duration - .05));
    const referenceMetadata = await recoveringSeeker.seek(referenceTarget);
    session.assertCurrent();
    const referenceFrameSha256 = await fingerprintFrame(readFrame());
    session.assertCurrent();
    calibration = {
      x: state.hoop.x, y: state.hoop.y, referenceTime: state.referenceTime,
      requestedTime: referenceTarget, mediaTime: referenceMetadata.mediaTime,
      frameSha256: referenceFrameSha256, width: frameSize.width, height: frameSize.height
    };
    if (!captureViewReference()) throw new Error("无法读取标定画面");
    trackedCenter = { x: state.hoop.x * frameSize.width, y: state.hoop.y * frameSize.height };

    for (let time = scanStart; time < scanEnd; time += interval) {
      session.assertCurrent();
      const frameMetadata = await recoveringSeeker.seek(Math.min(time, Math.max(0, video.duration - .05)));
      session.assertCurrent();
      const frame = readFrame();
      const { pixels, grayscale } = frame;
      const frameSha256 = await fingerprintFrame(frame);
      session.assertCurrent();
      const columns = buildColumnEdgeSignature(grayscale, frameSize.width, frameSize.height);
      const panMatch = previousColumns ? estimateColumnShift(previousColumns, columns, 10) : { shift: 0, error: 0 };
      const hoopMatch = findPatchTemplate(grayscale, frameSize.width, frameSize.height, state.hoopTemplate, trackedCenter, {
        localRadiusX: 20,
        localRadiusY: 14,
        localStride: 2,
        localAccept: 22,
        globalStride: 3
      });
      trackedCenter = { x: hoopMatch.x, y: hoopMatch.y };
      let globalDiff = 0;
      let globalCount = 0;
      let roiDiff = 0;
      let roiCount = 0;
      const viewDiff = signatureDifference(buildViewSignature(pixels, frameSize.width, frameSize.height), state.viewReference);
      if (previous) {
        const centerX = trackedCenter.x;
        const centerY = trackedCenter.y;
        const radiusX = .15 * frameSize.width;
        const radiusY = .20 * frameSize.height;
        for (let y = 0; y < frameSize.height; y += 2) {
          for (let x = 0; x < frameSize.width; x += 2) {
            const index = (y * frameSize.width + x) * 4;
            const diff = (Math.abs(pixels[index] - previous[index]) + Math.abs(pixels[index + 1] - previous[index + 1]) + Math.abs(pixels[index + 2] - previous[index + 2])) / 3;
            globalDiff += diff;
            globalCount += 1;
            if (Math.abs(x - centerX) <= radiusX && Math.abs(y - centerY) <= radiusY) {
              roiDiff += diff;
              roiCount += 1;
            }
          }
        }
      }
      samples.push({
        time,
        mediaTime: frameMetadata.mediaTime,
        frameSha256,
        globalScore: previous ? globalDiff / Math.max(1, globalCount) : 0,
        roiScore: previous ? roiDiff / Math.max(1, roiCount) : 0,
        viewScore: hoopMatch.error,
        sceneScore: viewDiff,
        trackedX: trackedCenter.x,
        trackedY: trackedCenter.y,
        rawPanScore: Math.abs(panMatch.shift)
      });
      previous = new Uint8ClampedArray(pixels);
      previousColumns = columns;
      if (samples.length % 16 === 0) {
        $("#shotStatus").textContent = `扫描 ${formatTime(scanStart)}–${formatTime(scanEnd)} · ${Math.min(100, Math.round((time - scanStart) / (scanEnd - scanStart) * 100))}%`;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    session.assertCurrent();
    const nearbyMatchScores = samples
      .filter((item) => Math.abs(item.time - state.referenceTime) <= 6)
      .map((item) => item.viewScore)
      .filter(Number.isFinite);
    const matchMedian = median(nearbyMatchScores);
    const matchMad = median(nearbyMatchScores.map((value) => Math.abs(value - matchMedian)));
    const matchThreshold = Math.min(32, matchMedian + Math.max(8, 4 * matchMad));
    const scoredSamples = samples.slice(1).map((item) => ({
      ...item,
      eligible: item.viewScore <= matchThreshold
    }));
    const result = shotScoresToCandidates(scoredSamples, video.duration);
    const panSamples = smoothPanSamples(samples).slice(1);
    const panResult = panScoresToCandidates(panSamples, video.duration, { quantile: .75, offset: 2, minimumGap: 5 });
    const profileId = state.shotProfileId || `profile:${state.videoKey}:${state.referenceTime.toFixed(1)}:${state.hoop.x.toFixed(2)}:${state.hoop.y.toFixed(2)}`;
    state.shotProfileId = profileId;
    const basketSide = state.hoop.x < .5 ? "left" : "right";
    const incomingCandidates = result.candidates.map((item) => ({ ...item, profileId, basketSide }));
    const incomingPanCandidates = panResult.candidates.map((item) => ({ ...item, profileId: `pan:${state.videoKey}` }));
    const eligibleFrames = scoredSamples.filter((item) => item.eligible).length;
    const nonCandidateSegments = state.segments.filter((item) => !["shot-roi", "camera-pan"].includes(item.source));
    const survivingCandidates = state.segments.filter((item) =>
      item.source === "shot-roi" && !((item.profileId === profileId || !item.basketSide) && item.peakTime >= scanStart && item.peakTime < scanEnd)
    );
    const survivingPanCandidates = state.segments.filter((item) =>
      item.source === "camera-pan" && !(item.peakTime >= scanStart && item.peakTime < scanEnd)
    );
    state.segments = nonCandidateSegments
      .concat(mergeShotCandidateLists(survivingCandidates, incomingCandidates))
      .concat(mergeCandidateLists(survivingPanCandidates, incomingPanCandidates, 5, "camera-pan"))
      .sort((a, b) => a.start - b.start);
    // Export the scan that actually produced these candidates, not an older pan-only run.
    state.lastPanScan = {
      algorithm: "shot-roi-and-pan-v4-canonical",
      runId, status: "complete",
      pixelSampling: "native-rgb-area-160x90-round-half-up",
      frameSelection: indexedFrames.evidence(),
      videoSource: video.currentSrc,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      start: scanStart, end: scanEnd, interval,
      referenceTime: state.referenceTime,
      calibration,
      sampleTrace: samples,
      sampledFrames: samples.length,
      quantile: .75, offset: 2, minimumGap: 5,
      threshold: panResult.threshold,
      candidates: incomingCandidates.length + incomingPanCandidates.length,
      skippedFrames: 0, decoderResets: recoveringSeeker.resets,
      recoveries: recoveringSeeker.recoveries,
      elapsedSeconds: Number(((performance.now() - scanStartedAt) / 1000).toFixed(2)),
      completedAt: new Date().toISOString()
    };
    localStorage.setItem(`courtvision-pan-scan:${state.videoKey}`, JSON.stringify(state.lastPanScan));
    state.reviewCandidateRun=captureReviewCandidates(state.lastPanScan,[...incomingCandidates,...incomingPanCandidates]);
    state.selectedId = null;
    persist();
    render();
    $("#shotStatus").textContent = `${formatTime(scanStart)}–${formatTime(scanEnd)} · 篮筐跟踪 ${eligibleFrames}/${scoredSamples.length} 帧 · 局部 ${incomingCandidates.length} · 横移 ${incomingPanCandidates.length}`;
    notify(`本段找到局部 ${incomingCandidates.length} 个、横移 ${incomingPanCandidates.length} 个候选`);
  } catch (error) {
    if (session.isCurrent()) {
      state.lastPanScan = {
        algorithm: "shot-roi-and-pan-v4-canonical", runId, status: "failed", error: error.message,
        start: scanStart, end: scanEnd, interval, referenceTime: state.referenceTime,
        calibration,
        sampleTrace: samples, sampledFrames: samples.length,
        skippedFrames: 0, decoderResets: recoveringSeeker.resets, recoveries: recoveringSeeker.recoveries,
        videoSource: video.currentSrc, failedAt: new Date().toISOString()
      };
      localStorage.setItem(`courtvision-pan-scan:${state.videoKey}`, JSON.stringify(state.lastPanScan));
    }
    $("#shotStatus").textContent = `分析失败：${error.message}`;
    notify("投篮候选分析失败");
  } finally {
    const restorePlayback = session.isCurrent();
    session.release();
    if (restorePlayback) {
      video.currentTime = Math.min(originalTime, video.duration || 0);
      if (!wasPaused) video.play().catch(() => {});
    }
    button.disabled = false;
    button.textContent = "重新寻找投篮候选";
  }
}

async function analyzePanCandidates() {
  if (!video.src || !Number.isFinite(video.duration) || !video.duration) { notify("请先载入录像"); return; }
  const session = beginScan();
  if (!session) return;
  const runId = crypto.randomUUID();
  state.lastPanScan = null;
  localStorage.removeItem(`courtvision-pan-scan:${state.videoKey}`);
  video.scrollIntoView({ block: "center" });
  const button = $("#panAnalyze");
  const scanStartedAt = performance.now();
  button.disabled = true;
  button.textContent = "扫描中…";
  const wasPaused = video.paused;
  const originalTime = video.currentTime;
  video.pause();
  const readFrame = createCanonicalFrameReader(video);
  const requestedRange = scanBounds($("#shotStart").value, $("#shotMinutes").value, state.groundTruthMeta?.reviewedRange);
  const scanStart = Math.min(requestedRange.start, Math.max(0, video.duration - .5));
  const scanEnd = Math.min(video.duration, requestedRange.end);
  const interval = Math.max(.25, Number($("#panInterval").value || .5));
  const samples = [];
  let previousColumns = null;
  const recoveringSeeker = createRecoveringSeeker({
    seek: target => indexedFrames.seek(target),
    reset: target => resetVideoDecoder(target),
    assertCurrent: () => session.assertCurrent(),
    onRecovery: (target, count, maximum) => {
      $("#shotStatus").textContent = `重试同一帧 ${formatTime(target)} · 恢复 ${count}/${maximum}`;
    }
  });
  try {
    for (let time = scanStart; time < scanEnd; time += interval) {
      session.assertCurrent();
      const frameMetadata = await recoveringSeeker.seek(Math.min(time, video.duration - .05));
      session.assertCurrent();
      const frame = readFrame();
      const frameSha256 = await fingerprintFrame(frame);
      session.assertCurrent();
      const columns = buildColumnEdgeSignature(frame.grayscale, frame.width, frame.height);
      const match = previousColumns ? estimateColumnShift(previousColumns, columns, 10) : { shift: 0 };
      samples.push({ time, mediaTime: frameMetadata.mediaTime, frameSha256, rawPanScore: Math.abs(match.shift) });
      previousColumns = columns;
      if (samples.length % 16 === 0) {
        $("#shotStatus").textContent = `镜头横移 ${formatTime(scanStart)}–${formatTime(scanEnd)} · ${Math.min(100, Math.round((time - scanStart) / (scanEnd - scanStart) * 100))}%`;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    session.assertCurrent();
    // The detector needs five scored frames, plus the initial reference frame.
    if (samples.length < 6) throw new Error("有效视频帧不足：请扩大区间或缩短采样间隔");
    const scored = smoothPanSamples(samples.slice(1));
    const result = panScoresToCandidates(scored, video.duration, { quantile: .75, offset: 2, minimumGap: 5 });
    const incoming = result.candidates.map((item) => ({ ...item, profileId: `pan:${state.videoKey}` }));
    const others = state.segments.filter((item) => item.source !== "camera-pan");
    const surviving = state.segments.filter((item) => item.source === "camera-pan" && !(item.peakTime >= scanStart && item.peakTime < scanEnd));
    state.segments = others.concat(mergeCandidateLists(surviving, incoming, 5, "camera-pan")).sort((a, b) => a.start - b.start);
    const elapsedSeconds = (performance.now() - scanStartedAt) / 1000;
    state.lastPanScan = {
      algorithm: "column-edge-pan-v2-canonical",
      runId, status: "complete",
      pixelSampling: "native-rgb-area-160x90-round-half-up",
      frameSelection: indexedFrames.evidence(),
      videoSource: video.currentSrc,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      sampleTrace: samples,
      start: scanStart,
      end: scanEnd,
      interval,
      quantile: .75,
      offset: 2,
      minimumGap: 5,
      threshold: result.threshold,
      candidates: incoming.length,
      sampledFrames: samples.length,
      skippedFrames: 0,
      decoderResets: recoveringSeeker.resets,
      recoveries: recoveringSeeker.recoveries,
      elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
      completedAt: new Date().toISOString()
    };
    localStorage.setItem(`courtvision-pan-scan:${state.videoKey}`, JSON.stringify(state.lastPanScan));
    state.reviewCandidateRun=captureReviewCandidates(state.lastPanScan,incoming);
    persist(); render();
    $("#shotStatus").textContent = `${formatTime(scanStart)}–${formatTime(scanEnd)} · 横移 ${incoming.length} 个 · 用时 ${elapsedSeconds.toFixed(1)}秒 · 跳过 0 帧 · 重置 ${recoveringSeeker.resets} 次`;
    notify(`找到 ${incoming.length} 个镜头横移候选`);
  } catch (error) {
    if (session.isCurrent()) {
      state.lastPanScan = {
        algorithm: 'column-edge-pan-v2-canonical', runId, status: 'failed', error: error.message,
        start: scanStart, end: scanEnd, interval, sampleTrace: samples, sampledFrames: samples.length,
        skippedFrames: 0, decoderResets: recoveringSeeker.resets, recoveries: recoveringSeeker.recoveries,
        videoSource: video.currentSrc, failedAt: new Date().toISOString()
      };
      localStorage.setItem(`courtvision-pan-scan:${state.videoKey}`, JSON.stringify(state.lastPanScan));
    }
    $("#shotStatus").textContent = `镜头横移分析失败：${error.message}`;
    notify("镜头横移分析失败");
  } finally {
    const restorePlayback = session.isCurrent();
    session.release();
    if (restorePlayback) {
      video.currentTime = Math.min(originalTime, video.duration || 0);
      if (!wasPaused) video.play().catch(() => {});
    }
    button.disabled = false;
    button.textContent = "只扫镜头横移";
  }
}

function markGroundTruth() {
  if (!video.src || !Number.isFinite(video.duration) || !video.duration) { notify("请先载入录像"); return; }
  const time = video.currentTime;
  if (state.segments.some((item) => item.source === "human-truth" && Math.abs(item.peakTime - time) < 1)) {
    notify("这一时刻附近已经标过真值");
    return;
  }
  state.segments.push({
    id: `truth-${Date.now()}`,
    start: Math.max(0, time - 2),
    end: Math.min(video.duration, time + 2),
    peakTime: Number(time.toFixed(2)),
    team: "待判断",
    player: "",
    event: "真实投篮",
    result: "待判断",
    zone: "待判断",
    note: "人工真值 · 在投篮出手时刻标记",
    confidence: 1,
    source: "human-truth",
    status: "已确认"
  });
  state.segments.sort((a, b) => a.start - b.start);
  persist(); render(); notify(`已标记真实投篮 ${formatTime(time)}`);
}

async function exportEvaluation({requireLocal=false}={}) {
  const range = getEvaluationRange();
  const evaluation = evaluateShotDetection(state.segments, 4, range);
  const withinRange = (item) => item.peakTime >= range.start && item.peakTime < range.end;
  const truths = state.segments.filter((item) => item.source === "human-truth" && withinRange(item)).map((item) => ({ id: item.id, time: item.peakTime }));
  const sourceSet = new Set(range.sources);
  const predictions = state.segments.filter((item) => sourceSet.has(item.source) && withinRange(item)).map((item) => ({ id: item.id, time: item.peakTime, confidence: item.confidence, source: item.source }));
  const truthSelectionMatchesFrozen = matchesFrozenSelection(state.groundTruthMeta, range, truths);
  const content = JSON.stringify({ video: state.videoName, generatedAt: new Date().toISOString(), range, truthDataset: state.groundTruthMeta, truthSelectionMatchesFrozen, scan: state.lastPanScan, evaluation, truths, predictions }, null, 2);
  if (location.hostname === '127.0.0.1') {
    try {
      const response = await fetch('/api/local-evaluations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: content });
      if (!response.ok) throw new Error('本机保存失败，请先完成扫描');
      const saved = await response.json();
      notify(`评估已保存到本机实验目录：${saved.filename}`);
      return saved.filename;
    } catch (error) { if (requireLocal) throw error; notify(`${error.message}；尝试文件下载`); }
  }
  if (requireLocal) throw new Error('批量保存仅在本机实验环境可用');
  download("投篮识别评估.json", content, "application/json");
}

async function loadGroundTruthFile(path, expectedSha256) {
  if (!state.videoKey.startsWith("sample:varsity-")) {
    notify("请先载入完整比赛实验录像");
    return;
  }
  const requestedRevision = datasetRevision;
  const requestedVideo = state.videoSourcePath?.split('/').at(-1);
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error("真值文件读取失败");
    const bytes = await response.arrayBuffer();
    const { dataset, sha256 } = await parseFrozenTruth(bytes, requestedVideo);
    if (expectedSha256 && sha256 !== expectedSha256) throw new Error('冻结标签指纹不匹配，已停止导入');
    if (requestedRevision !== datasetRevision || requestedVideo !== state.videoSourcePath?.split('/').at(-1)) {
      throw new Error('读取真值期间录像已切换，请重新载入');
    }
    state.groundTruthMeta = {
      path,
      sha256,
      frozenTimes: dataset.shots.map(shot => shot.time),
      video: dataset.video,
      split: dataset.split,
      reviewedRange: dataset.reviewedRange,
      shots: dataset.shots.length,
      method: dataset.method,
      definition: dataset.definition
    };
    localStorage.setItem(`courtvision-truth-meta:${state.videoKey}`, JSON.stringify(state.groundTruthMeta));
    let added = 0;
    for (const shot of dataset.shots) {
      if (state.segments.some((item) => item.source === "human-truth" && Math.abs(item.peakTime - shot.time) < .3)) continue;
      state.segments.push({
        id: `truth-reviewed-${String(shot.time).replace(".", "-")}`,
        start: shot.time - 2,
        end: shot.time + 2,
        peakTime: shot.time,
        team: "待判断",
        player: "",
        event: "真实投篮",
        result: "待判断",
        zone: "待判断",
        note: `${shot.note} · ${dataset.method || "人工核查"}`,
        confidence: 1,
        source: "human-truth",
        status: "已确认"
      });
      added += 1;
    }
    if (dataset.reviewedRange) {
      $("#shotStart").value = String(dataset.reviewedRange.start / 60);
      $("#shotMinutes").value = String((dataset.reviewedRange.end - dataset.reviewedRange.start) / 60);
    }
    state.segments.sort((a, b) => a.start - b.start);
    persist(); render(); notify(`已载入 ${added} 个新真值`);
    return true;
  } catch (error) {
    notify(error.message);
    return false;
  }
}

function loadCurrentGroundTruth(split) {
  const path = truthPathFor(state.videoSourcePath?.split('/').at(-1), split);
  if (!path) { notify("当前录像没有这组冻结标签，请选择对应比赛或测试分组"); return; }
  return loadGroundTruthFile(path);
}
const loadSampleGroundTruth = () => loadCurrentGroundTruth('train');
const loadValidationGroundTruth = () => loadCurrentGroundTruth('validation');
const loadTestGroundTruth = () => loadCurrentGroundTruth('test');
const loadAuditGroundTruth = () => loadCurrentGroundTruth('audit');
const loadAudit2GroundTruth = () => loadCurrentGroundTruth('audit2');
const loadCrossAuditGroundTruth = () => loadCurrentGroundTruth('crossAudit');

function renderFrozenRanges() {
  const videoName = state.videoSourcePath?.split('/').at(-1) || '';
  if (renderedFrozenVideo === videoName) return;
  renderedFrozenVideo = videoName;
  const entries = frozenCatalog.filter(entry => entry.video === videoName);
  const select = $('#frozenRange');
  select.innerHTML = entries.length
    ? entries.map(entry => `<option value="${escapeHtml(entry.path)}">${formatTime(entry.start)}–${formatTime(entry.end)} · ${entry.shots} 次出手</option>`).join('')
    : '<option value="">当前录像没有冻结区间</option>';
  select.disabled = !entries.length;
  $('#loadFrozenRange').disabled = !entries.length;
}

$('#loadFrozenRange').addEventListener('click', () => {
  const entry = frozenCatalog.find(item => item.path === $('#frozenRange').value
    && item.video === state.videoSourcePath?.split('/').at(-1));
  if (!entry) { notify('请先载入对应比赛'); return; }
  loadGroundTruthFile(entry.path, entry.sha256);
});
let frozenBatchActive=false, frozenBatchStop=false;
$('#runFrozenBatch').addEventListener('click', async () => {
  if (frozenBatchActive) {
    frozenBatchStop=true;
    $('#frozenBatchStatus').textContent='将在当前扫描保存后停止';
    return;
  }
  if (location.hostname!=='127.0.0.1') { notify('批量复测需要本机实验环境，公网可逐段扫描'); return; }
  const revision=datasetRevision;
  const source=state.videoSourcePath;
  const entries=frozenCatalog.filter(entry=>entry.video===source?.split('/').at(-1));
  if (!entries.length || !Number.isFinite(video.duration)) { notify('请先载入完整比赛'); return; }
  const assertCurrent=()=>{ if(revision!==datasetRevision || source!==state.videoSourcePath) throw new Error('录像已切换，批量复测停止'); };
  frozenBatchActive=true; frozenBatchStop=false;
  $('#runFrozenBatch').textContent='停止批量复测';
  // Use the option's declared value rather than assuming its numeric spelling.
  $('#panInterval').value=Array.from($('#panInterval').options).find(option=>Number(option.value)===.25)?.value || '.25';
  $('#evaluationSource').value='camera-pan';
  try {
    const outcome=await collectFrozenBatch({entries,assertCurrent,shouldStop:()=>frozenBatchStop,
      load:entry=>loadGroundTruthFile(entry.path,entry.sha256),
      scan:async entry=>{
        $('#frozenRange').value=entry.path;
        const previous=state.lastPanScan?.runId;
        await analyzePanCandidates();
        assertCurrent();
        const result=state.lastPanScan;
        if (!result || result.runId===previous || result.start!==entry.start || result.end!==entry.end)
          throw new Error('未取得当前区间的新扫描，停止批量保存');
        return result;
      },
      save:async (result,entry)=>{
        assertCurrent();
        const range=getEvaluationRange();
        if(range.start!==entry.start || range.end!==entry.end || $('#evaluationSource').value!=='camera-pan')
          throw new Error('评估设置已改变，停止批量保存');
        return exportEvaluation({requireLocal:true});
      },
      onProgress:({completed,total,entry,repeat})=>{
        $('#frozenBatchStatus').textContent=`已保存 ${completed}/${total} 次 · ${formatTime(entry.start)}–${formatTime(entry.end)} · 第 ${repeat} 次`;
      }
    });
    $('#frozenBatchStatus').textContent=`${outcome.stopped?'已停止':'本场扫描完成'} · 已保存 ${outcome.files.length} 次；识别成绩需另行核验`;
  } catch(error) { $('#frozenBatchStatus').textContent=`批量复测停止：${error.message}`; }
  finally { frozenBatchActive=false; $('#runFrozenBatch').textContent='批量复测当前比赛（本机）'; }
});
fetch('/courtvision/samples/frozen-catalog.json').then(response => {
  if (!response.ok) throw new Error('冻结目录读取失败');
  return response.json();
}).then(catalog => {
  if (!Array.isArray(catalog.entries)) throw new Error('冻结目录格式错误');
  frozenCatalog = catalog.entries;
  renderedFrozenVideo = null;
  renderFrozenRanges();
  $('#frozenCatalogStatus').textContent = `${catalog.entries.length} 个冻结区间 · 共 ${catalog.durationSeconds / 60} 分钟 · ${catalog.shots} 次出手；仅表示数据规模，不代表算法达标。`;
}).catch(error => { $('#frozenCatalogStatus').textContent = error.message; });

$("#videoInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  switchDataset(`local:${file.name}:${file.size}:${file.lastModified}`);
  state.reviewBlob = file;
  state.hoop = null;
  state.viewReference = null;
  localStorage.removeItem("courtvision-hoop");
  $("#shotStatus").textContent = "尚未标定篮筐";
  loadVideoSource(URL.createObjectURL(file), file.name, `${(file.size / 1024 / 1024).toFixed(1)} MB · 本地处理`);
  notify("录像已载入，本地文件不会上传");
});

video.addEventListener("loadedmetadata", () => {
  state.videoDuration = video.duration;
  $("#analysisStatus").textContent = `可分析 · ${formatTime(video.duration)} · 建议先生成画面候选`;
  showHoopMarker();
  render();
});
video.addEventListener("loadeddata", () => {
  if (state.pendingReferenceCapture) captureViewReference();
});
videoStage.addEventListener("click", (event) => {
  if (!state.calibratingHoop) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = videoStage.getBoundingClientRect();
  state.hoop = {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
  localStorage.setItem("courtvision-hoop", JSON.stringify(state.hoop));
  state.calibratingHoop = false;
  $("#calibrationFrame").hidden = true;
  videoStage.classList.remove("calibrating");
  captureViewReference();
  state.shotProfileId = `profile:${state.videoKey}:${state.hoop.x < .5 ? "left" : "right"}`;
  showHoopMarker();
  notify("篮筐位置已保存");
}, true);
video.addEventListener("timeupdate", () => {
  $("#currentTime").textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  const progress = video.duration ? video.currentTime / video.duration * 100 : 0;
  timeline.style.setProperty("--progress", `${progress}%`);
});

$("#markStart").addEventListener("click", () => { state.markStart = video.currentTime || 0; state.markEnd = null; state.selectedId = null; updateRange(); });
$("#markEnd").addEventListener("click", () => { state.markEnd = video.currentTime || 0; updateRange(); });
$("#addClip").addEventListener("click", () => addOrConfirm("待确认"));
$("#confirmClip").addEventListener("click", () => addOrConfirm("已确认"));
$("#ruleAnalyze").addEventListener("click", () => {
  const duration = state.videoDuration || 600;
  state.segments = state.segments.filter((item) => item.source === "human-truth").concat(buildRuleCandidates(duration));
  state.selectedId = null; persist(); render(); notify("已生成规则候选，请逐条核查");
});
$("#motionAnalyze").addEventListener("click", analyzeVideoMotion);
$("#calibrateHoop").addEventListener("click", async () => {
  if (!video.src || !Number.isFinite(video.duration)) { notify("请先载入录像"); return; }
  const session = beginScan();
  if (!session) return;
  video.pause();
  try {
    await indexedFrames.seek(Math.min(video.currentTime, Math.max(0, video.duration - .05)));
    session.assertCurrent();
    const canvas = $("#calibrationFrame");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error('无法显示标定画面');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.hidden = false;
    state.calibratingHoop = true;
    videoStage.classList.add("calibrating");
    videoStage.scrollIntoView({block:'center'});
    notify("请在静止画面中点击篮筐中心");
  } catch (error) { notify(`标定失败：${error.message}`); }
  finally { session.release(); }
});
$("#shotAnalyze").addEventListener("click", analyzeShotCandidates);
$("#panAnalyze").addEventListener("click", analyzePanCandidates);
$("#markTruth").addEventListener("click", markGroundTruth);
$("#loadSampleTruth").addEventListener("click", loadSampleGroundTruth);
$("#loadValidationTruth").addEventListener("click", loadValidationGroundTruth);
$("#loadTestTruth").addEventListener("click", loadTestGroundTruth);
$("#loadAuditTruth").addEventListener("click", loadAuditGroundTruth);
$("#loadAudit2Truth").addEventListener("click", loadAudit2GroundTruth);
$("#loadCrossAuditTruth").addEventListener("click", loadCrossAuditGroundTruth);
$("#clearTruth").addEventListener("click", () => {
  state.segments = state.segments.filter((item) => item.source !== "human-truth");
  state.groundTruthMeta = null;
  localStorage.removeItem(`courtvision-truth-meta:${state.videoKey}`);
  persist(); render(); notify("人工投篮真值已清空");
});
$("#exportEvaluation").addEventListener("click", exportEvaluation);
$("#sampleButton").addEventListener("click", () => {
  switchDataset("sample:3x3-honza-novy");
  state.hoop = { x: .46, y: .37 };
  state.viewReference = null;
  state.referenceTime = 0;
  state.pendingReferenceCapture = true;
  state.shotProfileId = "profile:sample-3x3-default";
  localStorage.setItem("courtvision-hoop", JSON.stringify(state.hoop));
  loadVideoSource("/courtvision/samples/basketball-3x3.webm", "3×3篮球实验录像", "2:36 · CC BY 3.0 · Honza Nový");
  notify("开源实验录像已载入");
});
$("#fixedSampleButton").addEventListener("click", () => {
  switchDataset("sample:varsity-hazen-enosburg-2026:v05-lab");
  state.hoop = null;
  state.viewReference = null;
  state.referenceTime = 0;
  state.shotProfileId = null;
  $("#shotStart").value = "0";
  $("#shotMinutes").value = "10";
  localStorage.removeItem("courtvision-hoop");
  $("#shotStatus").textContent = "请先在比赛画面标定篮筐";
  loadVideoSource("/courtvision/samples/varsity-fixed-camera-240p.mp4", "校队完整比赛 · 固定转播机位", "1:43:27 · CC BY 4.0 · HCTV · 研发用无音轨版");
  persist(); render(); notify("完整比赛录像已载入");
});
$("#crossGameButton").addEventListener("click", () => {
  switchDataset("sample:varsity-randolph-full:v09");
  state.hoop = null;
  state.viewReference = null;
  state.referenceTime = 0;
  state.shotProfileId = null;
  $("#shotStart").value = "27.5";
  $("#shotMinutes").value = "2";
  localStorage.removeItem("courtvision-hoop");
  $("#shotStatus").textContent = "跨比赛冻结测试 · 可直接运行横移扫描";
  loadVideoSource("/courtvision/samples/varsity-randolph-240p.webm", "第二场跨比赛测试 · 固定转播机位", "1:38:19 · CC BY 4.0 · HCTV · 240p VP9");
  loadGroundTruthFile("/courtvision/samples/varsity-randolph-ground-truth-test.json");
  persist(); render(); notify("第二场冻结测试已载入");
});
$("#thirdGameButton").addEventListener("click", () => {
  switchDataset("sample:varsity-harwood-full:v09");
  state.hoop = null;
  state.viewReference = null;
  state.referenceTime = 0;
  state.shotProfileId = null;
  $("#shotStart").value = "28";
  $("#shotMinutes").value = "2";
  localStorage.removeItem("courtvision-hoop");
  $("#shotStatus").textContent = "第三场冻结测试 · 可直接运行横移扫描";
  loadVideoSource("/courtvision/samples/varsity-harwood-240p.webm", "第三场跨比赛测试 · 固定转播机位", "1:08:45 · CC BY 4.0 · HCTV · 240p VP9");
  loadGroundTruthFile("/courtvision/samples/varsity-harwood-ground-truth-test.json");
  persist(); render(); notify("第三场冻结测试已载入");
});
$("#proxySampleButton").addEventListener("click", () => {
  switchDataset("sample:varsity-test-proxy:v08");
  state.hoop = null;
  state.viewReference = null;
  state.referenceTime = 0;
  state.shotProfileId = null;
  localStorage.removeItem("courtvision-hoop");
  loadVideoSource("/courtvision/samples/varsity-test-proxy.webm", "最终测试代理片段", "2:00 · VP8 15fps · 对应原片 35:00–37:00");
  loadGroundTruthFile("/courtvision/samples/varsity-ground-truth-test-proxy.json");
  persist(); render(); notify("最终测试代理片段已载入");
});
$("#demoButton").addEventListener("click", () => {
  switchDataset("demo");
  state.segments = createDemoSegments(); state.videoDuration = Math.max(state.videoDuration, 330);
  state.selectedId = null; persist(); render(); notify("演示数据已载入");
});
$("#eventFilter").addEventListener("change", render);
$("#statusFilter").addEventListener("change", render);
$("#shotStart").addEventListener("input", render);
$("#shotMinutes").addEventListener("input", render);
$("#evaluationSource").addEventListener("change", render);
$("#exportCsv").addEventListener("click", () => download("篮球回合数据.csv", `\uFEFF${segmentsToCsv(state.segments)}`, "text/csv;charset=utf-8"));
$("#exportJson").addEventListener("click", () => download("篮球回合数据.json", JSON.stringify(state.segments, null, 2), "application/json"));
$("#printReport").addEventListener("click", () => window.print());
$("#undoReview").addEventListener("click", undoLastReview);

document.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  if (event.code === "Space") { event.preventDefault(); video.paused ? video.play() : video.pause(); }
  if (event.key.toLowerCase() === "a") $("#markStart").click();
  if (event.key.toLowerCase() === "b") $("#markEnd").click();
  if (event.key.toLowerCase() === "t") markGroundTruth();
  if (event.key.toLowerCase() === "j") selectPending(1);
  if (event.key.toLowerCase() === "k") selectPending(-1);
  if (event.key === "1") reviewSelected("命中");
  if (event.key === "2") reviewSelected("未中");
  if (event.key === "0") reviewSelected(null);
  if (event.key.toLowerCase() === "u") undoLastReview();
});

populateOptions();
render();
mountReviewWorkbench(()=>({src:reviewSourceReady(video,state.reviewExpectedSrc)?video.currentSrc:null,duration:video.duration,crossOrigin:video.crossOrigin,videoIdentity:state.videoKey,blob:state.reviewBlob,candidateRun:state.reviewCandidateRun,pause:()=>video.pause(),candidates:state.reviewCandidateRun?.candidates??state.segments.filter(e=>['camera-pan','shot-roi'].includes(e.source)&&e.status==='待确认'&&Number.isFinite(e.peakTime)).map(e=>({time:e.peakTime,label:'shot',result:'unknown',note:`机器候选：${e.source}`}))}));

function showPage() {
  const page = ["workspace", "segments", "report"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "workspace";
  for (const id of ["workspace", "segments", "report"]) $("#" + id).hidden = id !== page;
  document.querySelector(".metric-grid").hidden = page === "workspace";
  document.querySelectorAll("nav a").forEach((link) => {
    const active = link.hash === "#" + page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const names = { workspace: "比赛工作台", segments: "回合库", report: "教练报告" };
  document.querySelector(".eyebrow").textContent = names[page];
  document.querySelector("h1").textContent = { workspace: "录像分析与逐条复核", segments: "回合库", report: "教练报告" }[page];
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", showPage);
showPage();
