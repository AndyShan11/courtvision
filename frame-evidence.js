// Hash exactly the canonical inputs consumed by RGB ROI and grayscale pan analysis.
// Fingerprints establish pixel equality, not browser provenance or detection accuracy.
export async function fingerprintFrame({ width, height, pixels, grayscale }) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0)
      || pixels?.length !== width * height * 4 || grayscale?.length !== width * height) {
    throw new Error('无效指纹帧尺寸');
  }
  const bytes = new Uint8Array(8 + pixels.length + grayscale.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, width, true); header.setUint32(4, height, true);
  bytes.set(pixels, 8); bytes.set(grayscale, 8 + pixels.length);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function compareFrameTraces(left, right) {
  const errors = [];
  for (const [name, scan] of [['left', left], ['right', right]]) {
    if (!scan || scan.status !== 'complete' || !scan.runId || scan.skippedFrames !== 0) errors.push(`${name}: incomplete run`);
    if (!Array.isArray(scan?.sampleTrace) || !scan.sampleTrace.length
        || scan.sampledFrames !== scan.sampleTrace.length) errors.push(`${name}: missing/inconsistent frame count`);
    if (![scan?.start, scan?.end, scan?.interval].every(Number.isFinite)
        || scan.interval <= 0 || scan.end <= scan.start) errors.push(`${name}: invalid sampling range`);
    else if (scan.sampleTrace?.length !== Math.ceil((scan.end - scan.start) / scan.interval - 1e-9)) {
      errors.push(`${name}: incomplete sampling grid`);
    }
  }
  if (errors.length) return { pass: false, errors, comparedFrames: 0 };
  if (left.runId === right.runId) errors.push('same run cannot count as a repeat');
  for (const key of ['start', 'end', 'interval', 'videoWidth', 'videoHeight', 'pixelSampling']) {
    if (left[key] == null || left[key] !== right[key]) errors.push(`different/missing ${key}`);
  }
  const a = left.sampleTrace, b = right.sampleTrace;
  if (a.length !== b.length) errors.push('different frame counts');
  let pixelMismatches = 0, timeMismatches = 0;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i++) {
    const x = a[i], y = b[i];
    if (![x.time, y.time, x.mediaTime, y.mediaTime].every(Number.isFinite)
        || Math.abs(x.time - (left.start + i * left.interval)) > 1e-6
        || Math.abs(y.time - (right.start + i * right.interval)) > 1e-6
        || Math.abs(x.time - y.time) > 1e-9 || Math.abs(x.mediaTime - y.mediaTime) > 1e-6) timeMismatches++;
    if (!/^[a-f0-9]{64}$/.test(x.frameSha256 || '') || !/^[a-f0-9]{64}$/.test(y.frameSha256 || '')
        || x.frameSha256 !== y.frameSha256) pixelMismatches++;
  }
  return { pass: errors.length === 0 && pixelMismatches === 0 && timeMismatches === 0,
    scope: 'Canonical input equality only; independently verify video/build identity and browser provenance.',
    errors, comparedFrames: count, pixelMismatches, timeMismatches };
}
