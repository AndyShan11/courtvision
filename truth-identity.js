export async function parseFrozenTruth(bytes, expectedVideo) {
  const dataset = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!expectedVideo || dataset.video !== expectedVideo) throw new Error('真值文件与当前比赛不匹配');
  const range = dataset.reviewedRange;
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)
      || range.start < 0 || range.end <= range.start || !Array.isArray(dataset.shots)) {
    throw new Error('真值区间或出手列表无效');
  }
  let previous = -Infinity;
  for (const shot of dataset.shots) {
    if (!Number.isFinite(shot.time) || shot.time < range.start || shot.time >= range.end || shot.time <= previous) {
      throw new Error('真值时间须按顺序排列、不重复且位于标注区间内');
    }
    previous = shot.time;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { dataset, sha256 };
}

// Identity of imported bytes alone cannot establish that editable labels are unchanged.
export function matchesFrozenSelection(metadata, range, truths) {
  if (!metadata?.sha256 || !Array.isArray(metadata.frozenTimes)
      || range.start !== metadata.reviewedRange?.start || range.end !== metadata.reviewedRange?.end) return false;
  const times = truths.map(shot => shot.time).sort((a, b) => a - b);
  return times.length === metadata.frozenTimes.length
    && times.every((time, i) => time === metadata.frozenTimes[i]);
}
