// A failed target is retried at the same time. Never advance a sampling grid past it.
export function createRecoveringSeeker({ seek, reset, assertCurrent, onRecovery = () => {}, maxResets = 2 }) {
  const recoveries = [];
  let resets = 0;
  return {
    recoveries,
    get resets() { return resets; },
    async seek(target) {
      assertCurrent();
      try {
        const metadata = await seek(target);
        assertCurrent();
        return metadata;
      } catch (error) {
        assertCurrent();
        const entry = { target, error: error.message, recovered: false };
        recoveries.push(entry);
        if (resets >= maxResets) throw new Error(`目标帧 ${target} 无法读取，恢复次数已用完：${error.message}`);
        resets++;
        onRecovery(target, resets, maxResets);
        try {
          const metadata = await reset(target);
          assertCurrent();
          entry.recovered = true;
          entry.mediaTime = metadata.mediaTime;
          return metadata;
        } catch (retryError) {
          entry.retryError = retryError.message;
          throw retryError;
        }
      }
    }
  };
}
