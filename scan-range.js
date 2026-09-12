// Inputs are minutes; preserve short frozen ranges instead of padding them to 30s.
export function scanMinutes(value) {
  const number = value === '' || value == null ? 10 : Number(value);
  return Number.isFinite(number) ? Math.min(20, Math.max(1 / 60, number)) : 10;
}

// When controls still represent the imported range, retain its exact seconds.
// This is not an epsilon match: genuinely edited controls do not inherit identity.
export function scanBounds(startValue, durationValue, frozenRange) {
  const rawStart = Number(startValue || 0);
  const minutes = scanMinutes(durationValue);
  if (Number.isFinite(frozenRange?.start) && Number.isFinite(frozenRange?.end)
      && frozenRange.start >= 0 && frozenRange.end > frozenRange.start
      && rawStart === frozenRange.start / 60
      && minutes === (frozenRange.end - frozenRange.start) / 60) {
    return { start: frozenRange.start, end: frozenRange.end };
  }
  const start = Number.isFinite(rawStart) ? Math.max(0, rawStart * 60) : 0;
  return { start, end: start + minutes * 60 };
}
