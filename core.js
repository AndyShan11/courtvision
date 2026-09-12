export const EVENT_TYPES = ["投篮候选", "回合终结候选", "真实投篮", "挡拆", "单打", "快攻", "定点投篮", "低位", "手递手", "失误", "篮板"];
export const RESULTS = ["命中", "未中", "失误", "造犯规", "继续进攻"];

export function formatTime(totalSeconds = 0) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export function computeSummary(segments) {
  const operational = segments.filter((item) => item.source !== "human-truth");
  const reviewed = operational.filter((item) => item.status === "已确认");
  const pending = operational.filter((item) => item.status === "待确认");
  const shots = reviewed.filter((item) => ["命中", "未中"].includes(item.result));
  const made = shots.filter((item) => item.result === "命中").length;
  const turnovers = reviewed.filter((item) => item.result === "失误" || item.event === "失误").length;
  const pickRoll = reviewed.filter((item) => item.event === "挡拆");
  const pickRollMade = pickRoll.filter((item) => item.result === "命中").length;
  const corrected = reviewed.filter((item) => Number.isFinite(item.boundaryCorrection));
  const reviewDurations = operational.filter((item) => Number.isFinite(item.reviewSeconds));
  const shotCandidates = segments.filter((item) => ["shot-roi", "camera-pan"].includes(item.source) && item.status === "待确认").length;

  return {
    possessions: reviewed.length,
    reviewed: reviewed.length,
    pending: pending.length,
    excluded: operational.filter((item) => item.status === "已排除").length,
    reviewedCandidates: reviewDurations.length,
    meanReviewSeconds: reviewDurations.length ? reviewDurations.reduce((sum, item) => sum + item.reviewSeconds, 0) / reviewDurations.length : null,
    fieldGoalRate: shots.length ? made / shots.length : 0,
    turnovers,
    pickRollRate: pickRoll.length ? pickRollMade / pickRoll.length : 0,
    reviewedBoundaries: corrected.length,
    meanBoundaryCorrection: corrected.length
      ? corrected.reduce((sum, item) => sum + item.boundaryCorrection, 0) / corrected.length
      : null,
    shotCandidates
  };
}

export function evaluateShotDetection(segments, toleranceSeconds = 4, range = null) {
  const tolerance = Math.max(0, Number(toleranceSeconds) || 0);
  const rangeStart = Number.isFinite(range?.start) ? range.start : -Infinity;
  const rangeEnd = Number.isFinite(range?.end) ? range.end : Infinity;
  const predictionSources = new Set(range?.sources?.length ? range.sources : ["shot-roi"]);
  const rawPredictions = segments
    .filter((item) => predictionSources.has(item.source))
    .map((item) => ({ id: item.id, time: Number.isFinite(item.peakTime) ? item.peakTime : (item.start + item.end) / 2, confidence: item.confidence || 0 }))
    .filter((item) => Number.isFinite(item.time) && item.time >= rangeStart && item.time < rangeEnd)
    .sort((a, b) => a.time - b.time);
  const mergeGap = Math.max(0, Number(range?.mergeGap) || 0);
  const predictions = [];
  for (const prediction of rawPredictions) {
    const previous = predictions.at(-1);
    if (!mergeGap || !previous || prediction.time - previous.time >= mergeGap) predictions.push(prediction);
    else if (prediction.confidence > previous.confidence) predictions[predictions.length - 1] = prediction;
  }
  const truths = segments
    .filter((item) => item.source === "human-truth")
    .map((item) => ({ id: item.id, time: Number.isFinite(item.peakTime) ? item.peakTime : (item.start + item.end) / 2 }))
    .filter((item) => Number.isFinite(item.time) && item.time >= rangeStart && item.time < rangeEnd)
    .sort((a, b) => a.time - b.time);

  const matches = matchTimesOptimally(predictions, truths, tolerance);
  const precision = predictions.length ? matches.length / predictions.length : 0;
  const recall = truths.length ? matches.length / truths.length : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const meanError = matches.length ? matches.reduce((sum, item) => sum + item.delta, 0) / matches.length : null;

  const precisionInterval = wilsonInterval(matches.length, predictions.length);
  const recallInterval = wilsonInterval(matches.length, truths.length);
  return {
    predictions: predictions.length,
    truths: truths.length,
    matched: matches.length,
    falsePositives: predictions.length - matches.length,
    falseNegatives: truths.length - matches.length,
    precision,
    recall,
    f1,
    meanError,
    precisionInterval,
    recallInterval,
    tolerance,
    matches
  };
}

export function matchTimesOptimally(predictions, truths, toleranceSeconds = 4) {
  const tolerance = Math.max(0, Number(toleranceSeconds) || 0);
  const rows = predictions.length + 1;
  const columns = truths.length + 1;
  const table = Array.from({ length: rows }, () => Array(columns).fill(null));
  table[0][0] = { count: 0, error: 0, matches: [] };
  const better = (candidate, current) => !current || candidate.count > current.count || (candidate.count === current.count && candidate.error < current.error);
  const update = (row, column, candidate) => {
    if (better(candidate, table[row][column])) table[row][column] = candidate;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const state = table[row][column];
      if (!state) continue;
      if (row < predictions.length) update(row + 1, column, state);
      if (column < truths.length) update(row, column + 1, state);
      if (row < predictions.length && column < truths.length) {
        const delta = Math.abs(predictions[row].time - truths[column].time);
        if (delta <= tolerance) update(row + 1, column + 1, {
          count: state.count + 1,
          error: state.error + delta,
          matches: [...state.matches, { predictionId: predictions[row].id, truthId: truths[column].id, delta }]
        });
      }
    }
  }
  return table.at(-1).at(-1)?.matches || [];
}

export function wilsonInterval(successes, total, z = 1.96) {
  const n = Math.max(0, Number(total) || 0);
  if (!n) return null;
  const p = Math.min(1, Math.max(0, Number(successes) || 0) / n);
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function mergeCandidateLists(existing, incoming, minimumGap = 3, source = null) {
  const valid = [...existing, ...incoming]
    .filter((item) => (!source || item?.source === source) && Number.isFinite(item?.peakTime))
    .sort((a, b) => a.peakTime - b.peakTime);
  const merged = [];
  for (const candidate of valid) {
    const previous = merged.at(-1);
    if (!previous || candidate.peakTime - previous.peakTime >= minimumGap) {
      merged.push(candidate);
    } else if ((candidate.confidence || 0) > (previous.confidence || 0)) {
      merged[merged.length - 1] = candidate;
    }
  }
  return merged;
}

export function mergeShotCandidateLists(existing, incoming, minimumGap = 3) {
  return mergeCandidateLists(existing, incoming, minimumGap, "shot-roi");
}

export function createPatchTemplate(grayscale, width, height, centerX, centerY, radiusX = 10, radiusY = 8, stride = 2) {
  const offsets = [];
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  for (let dy = -radiusY; dy <= radiusY; dy += stride) {
    for (let dx = -radiusX; dx <= radiusX; dx += stride) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < width && y >= 0 && y < height) offsets.push({ dx, dy, value: grayscale[y * width + x] });
    }
  }
  return { offsets, radiusX, radiusY };
}

export function findPatchTemplate(grayscale, width, height, template, prior, options = {}) {
  if (!template?.offsets?.length) return { x: prior.x, y: prior.y, error: Infinity };
  const localRadiusX = options.localRadiusX ?? 16;
  const localRadiusY = options.localRadiusY ?? 12;
  const localStride = options.localStride ?? 2;
  const globalStride = options.globalStride ?? 3;
  const localAccept = options.localAccept ?? 24;

  const scoreAt = (x, y) => {
    let error = 0;
    for (const point of template.offsets) error += Math.abs(grayscale[(y + point.dy) * width + x + point.dx] - point.value);
    return error / template.offsets.length;
  };
  const search = (minX, maxX, minY, maxY, stride) => {
    let best = { x: prior.x, y: prior.y, error: Infinity };
    const left = Math.max(template.radiusX, Math.round(minX));
    const right = Math.min(width - template.radiusX - 1, Math.round(maxX));
    const top = Math.max(template.radiusY, Math.round(minY));
    const bottom = Math.min(height - template.radiusY - 1, Math.round(maxY));
    for (let y = top; y <= bottom; y += stride) {
      for (let x = left; x <= right; x += stride) {
        const error = scoreAt(x, y);
        if (error < best.error) best = { x, y, error };
      }
    }
    return best;
  };

  const local = search(prior.x - localRadiusX, prior.x + localRadiusX, prior.y - localRadiusY, prior.y + localRadiusY, localStride);
  if (local.error <= localAccept) return local;
  return search(template.radiusX, width - template.radiusX - 1, template.radiusY, Math.round(height * .7), globalStride);
}

export function buildColumnEdgeSignature(grayscale, width, height, upperRatio = .72) {
  const signature = new Float32Array(Math.max(0, width - 1));
  const rows = Math.max(1, Math.min(height, Math.floor(height * upperRatio)));
  for (let x = 0; x < width - 1; x += 1) {
    let total = 0;
    for (let y = 0; y < rows; y += 1) total += Math.abs(grayscale[y * width + x + 1] - grayscale[y * width + x]);
    signature[x] = total / rows;
  }
  return signature;
}

export function estimateColumnShift(previous, current, maxShift = 10) {
  if (!previous?.length || previous.length !== current?.length) return { shift: 0, error: Infinity };
  let best = { shift: 0, error: Infinity };
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    const start = Math.max(0, -shift);
    const end = Math.min(previous.length, current.length - shift);
    let error = 0;
    let count = 0;
    for (let index = start; index < end; index += 1) {
      error += Math.abs(previous[index] - current[index + shift]);
      count += 1;
    }
    const meanError = error / Math.max(1, count);
    if (meanError < best.error) best = { shift, error: meanError };
  }
  return best;
}

export function panScoresToCandidates(samples, duration, options = {}) {
  const quantile = options.quantile ?? .75;
  const offset = options.offset ?? 2;
  const minimumGap = options.minimumGap ?? 5;
  const valid = samples.filter((item) => Number.isFinite(item.time) && Number.isFinite(item.panScore)).sort((a, b) => a.time - b.time);
  if (valid.length < 5) return { candidates: [], threshold: 0, peaks: [] };
  const values = valid.map((item) => item.panScore).sort((a, b) => a - b);
  const threshold = interpolatedQuantile(values, quantile);
  const rawPeaks = [];
  for (let index = 2; index < valid.length - 2; index += 1) {
    const item = valid[index];
    if (item.panScore < threshold) continue;
    if (item.panScore >= Math.max(valid[index - 2].panScore, valid[index - 1].panScore, valid[index + 1].panScore, valid[index + 2].panScore)) rawPeaks.push(item);
  }
  const peaks = [];
  for (const peak of rawPeaks) {
    const nearby = peaks.findIndex((item) => Math.abs(item.time - peak.time) < minimumGap);
    if (nearby < 0) peaks.push(peak);
    else if (peak.panScore > peaks[nearby].panScore) peaks[nearby] = peak;
  }
  peaks.sort((a, b) => a.time - b.time);
  const total = Math.max(0, Number(duration) || valid.at(-1).time);
  const candidates = peaks.map((peak, index) => {
    const eventTime = Math.max(0, peak.time - offset);
    return {
      id: `pan-${Date.now()}-${index}`,
      start: Number(Math.max(0, eventTime - 4).toFixed(2)),
      end: Number(Math.min(total, eventTime + 3).toFixed(2)),
      suggestedStart: Number(Math.max(0, eventTime - 4).toFixed(2)),
      suggestedEnd: Number(Math.min(total, eventTime + 3).toFixed(2)),
      team: "待判断",
      player: "",
      event: "回合终结候选",
      result: "待判断",
      zone: "待判断",
      note: `横向镜头运动峰值 · 位移 ${peak.panScore.toFixed(1)} · 阈值 ${threshold.toFixed(1)} · 向前补偿 ${offset.toFixed(1)}秒`,
      confidence: Number(Math.max(.35, Math.min(.9, .4 + (peak.panScore - threshold) / Math.max(1, threshold))).toFixed(2)),
      source: "camera-pan",
      peakTime: Number(eventTime.toFixed(2)),
      status: "待确认"
    };
  });
  return { candidates, threshold: Number(threshold.toFixed(3)), peaks };
}

export function interpolatedQuantile(sortedValues, probability) {
  if (!sortedValues?.length) return 0;
  const q = Math.max(0, Math.min(1, Number(probability) || 0));
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function generateInsights(segments) {
  const confirmed = segments.filter((item) => item.status === "已确认" && item.source !== "human-truth");
  if (!confirmed.length) return ["确认至少一个片段后，系统会生成可核查的比赛洞察。"];

  const byEvent = new Map();
  confirmed.forEach((item) => {
    const current = byEvent.get(item.event) || { total: 0, made: 0, turnovers: 0 };
    current.total += 1;
    if (item.result === "命中") current.made += 1;
    if (item.result === "失误" || item.event === "失误") current.turnovers += 1;
    byEvent.set(item.event, current);
  });

  const ranked = [...byEvent.entries()].sort((a, b) => b[1].total - a[1].total);
  const [topName, top] = ranked[0];
  const insights = [`样本中最常见的进攻方式是“${topName}”，共 ${top.total} 个已确认回合。`];

  const efficient = [...byEvent.entries()]
    .filter(([, value]) => value.total >= 2)
    .sort((a, b) => b[1].made / b[1].total - a[1].made / a[1].total)[0];
  if (efficient) {
    insights.push(`“${efficient[0]}”的样本命中占比最高（${efficient[1].made}/${efficient[1].total}），建议结合录像检查是否可增加使用。`);
  }

  const turnoverCount = confirmed.filter((item) => item.result === "失误" || item.event === "失误").length;
  if (turnoverCount) insights.push(`已定位 ${turnoverCount} 个失误片段，可直接筛选后制作专项复盘清单。`);
  insights.push("以上结论仅基于已确认标签；点击对应片段核查录像后再用于训练决策。");
  return insights;
}

export function buildRuleCandidates(duration, count = 12) {
  const total = Math.max(60, Math.floor(duration || 600));
  const gap = Math.max(12, Math.floor(total / count));
  return Array.from({ length: Math.min(count, Math.floor(total / gap)) }, (_, index) => {
    const start = index * gap;
    return {
      id: `candidate-${Date.now()}-${index}`,
      start,
      end: Math.min(start + Math.min(22, gap - 1), total),
      team: "待判断",
      player: "",
      event: "待标注",
      result: "待判断",
      zone: "待判断",
      note: "规则初筛候选，请人工核查",
      confidence: 0,
      status: "待确认"
    };
  });
}

export function motionScoresToCandidates(samples, duration, targetSeconds = 14) {
  const valid = samples
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.score))
    .sort((a, b) => a.time - b.time);
  const total = Math.max(0, Number(duration) || 0);
  if (valid.length < 3 || total < 8) return [];

  const sortedScores = valid.map((item) => item.score).sort((a, b) => a - b);
  const median = sortedScores[Math.floor(sortedScores.length / 2)] || 1;
  const boundaries = [0];
  for (let nominal = targetSeconds; nominal < total - 6; nominal += targetSeconds) {
    const nearby = valid.filter((item) => Math.abs(item.time - nominal) <= 4);
    if (!nearby.length) continue;
    const quietest = nearby.reduce((best, item) => item.score < best.score ? item : best);
    if (quietest.time - boundaries.at(-1) >= 7) boundaries.push(quietest.time);
  }
  if (total - boundaries.at(-1) >= 5) boundaries.push(total);

  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const boundarySample = valid.reduce((best, item) =>
      Math.abs(item.time - end) < Math.abs(best.time - end) ? item : best, valid[0]);
    const quietness = Math.max(0, Math.min(1, 1 - boundarySample.score / Math.max(1, median * 2)));
    return {
      id: `motion-${Date.now()}-${index}`,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      suggestedStart: Number(start.toFixed(2)),
      suggestedEnd: Number(end.toFixed(2)),
      team: "待判断",
      player: "",
      event: "待标注",
      result: "待判断",
      zone: "待判断",
      note: `画面活跃度边界候选 · 边界分数 ${boundarySample.score.toFixed(1)}`,
      confidence: Number(quietness.toFixed(2)),
      status: "待确认"
    };
  });
}

export function shotScoresToCandidates(samples, duration, minimumGap = 4) {
  const valid = samples
    .filter((item) => item.eligible !== false && Number.isFinite(item.time) && Number.isFinite(item.roiScore) && Number.isFinite(item.globalScore))
    .map((item) => ({ ...item, score: item.roiScore / Math.max(1, item.globalScore) }))
    .sort((a, b) => a.time - b.time);
  if (valid.length < 5) return { candidates: [], threshold: 0, peaks: [] };

  const values = valid.map((item) => item.score).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] || 0.05;
  const threshold = median + Math.max(0.18, 2.2 * mad);

  const localPeaks = valid.filter((item, index) => {
    if (index === 0 || index === valid.length - 1 || item.score < threshold) return false;
    return item.score >= valid[index - 1].score && item.score >= valid[index + 1].score;
  });

  const peaks = [];
  for (const peak of localPeaks) {
    const previous = peaks.at(-1);
    if (!previous || peak.time - previous.time >= minimumGap) peaks.push(peak);
    else if (peak.score > previous.score) peaks[peaks.length - 1] = peak;
  }

  const total = Math.max(0, Number(duration) || valid.at(-1).time);
  const candidates = peaks.map((peak, index) => {
    const start = Math.max(0, peak.time - 4);
    const end = Math.min(total, peak.time + 3);
    const confidence = Math.max(0.35, Math.min(0.95, 0.35 + (peak.score - threshold) / Math.max(0.5, threshold)));
    return {
      id: `shot-${Date.now()}-${index}`,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      suggestedStart: Number(start.toFixed(2)),
      suggestedEnd: Number(end.toFixed(2)),
      team: "待判断",
      player: "",
      event: "投篮候选",
      result: "待判断",
      zone: "待判断",
      note: `篮筐区域运动峰值 · 相对强度 ${peak.score.toFixed(2)} · 阈值 ${threshold.toFixed(2)}${Number.isFinite(peak.viewScore) ? ` · 篮筐匹配差 ${peak.viewScore.toFixed(1)}` : ""}`,
      confidence: Number(confidence.toFixed(2)),
      source: "shot-roi",
      peakTime: Number(peak.time.toFixed(2)),
      status: "待确认"
    };
  });
  return { candidates, threshold: Number(threshold.toFixed(3)), peaks };
}

export function createDemoSegments() {
  const rows = [
    [12, 27, "蓝队", "7号", "挡拆", "命中", "弧顶", "持球人借掩护向右突破", 0.91],
    [38, 50, "白队", "11号", "定点投篮", "未中", "左侧底角", "弱侧接球三分", 0.88],
    [65, 78, "蓝队", "23号", "快攻", "命中", "篮下", "抢断后2打1", 0.95],
    [93, 109, "白队", "4号", "挡拆", "失误", "左侧45度", "夹击后传球出界", 0.84],
    [126, 142, "蓝队", "15号", "低位", "造犯规", "左侧低位", "背身转中路", 0.82],
    [158, 171, "白队", "9号", "手递手", "命中", "右侧45度", "手递手后急停", 0.79],
    [188, 202, "蓝队", "7号", "挡拆", "未中", "罚球线", "换防后中距离", 0.86],
    [219, 232, "白队", "11号", "单打", "失误", "弧顶", "向左突破被协防抢断", 0.9],
    [251, 265, "蓝队", "23号", "定点投篮", "命中", "右侧底角", "突分后的空位三分", 0.93],
    [283, 299, "白队", "4号", "挡拆", "命中", "篮下", "顺下接球终结", 0.87]
  ];
  return rows.map((row, index) => ({
    id: `demo-${index}`,
    start: row[0], end: row[1], team: row[2], player: row[3], event: row[4], result: row[5],
    zone: row[6], note: row[7], confidence: row[8], status: "已确认"
  }));
}

export function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function segmentsToCsv(segments) {
  const headers = ["开始", "结束", "球队", "球员", "事件", "结果", "区域", "备注", "状态", "误报原因", "复核秒数", "边界平均修正秒数"];
  const rows = segments.map((item) => [formatTime(item.start), formatTime(item.end), item.team, item.player, item.event, item.result, item.zone, item.note, item.status, item.reviewReason ?? "", item.reviewSeconds ?? "", item.boundaryCorrection ?? ""]);
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}
