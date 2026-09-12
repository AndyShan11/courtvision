// One decoder, one scan. Identity includes a dataset revision so A→B→A is invalid.
export function createScanCoordinator(readIdentity) {
  let active = null;
  return {
    begin() {
      if (active) return null;
      const identity = readIdentity();
      const session = {
        isCurrent: () => active === session && readIdentity() === identity,
        assertCurrent() {
          if (!session.isCurrent()) throw new Error('录像已切换，本次扫描已取消，请重新开始');
        },
        release() { if (active === session) active = null; }
      };
      active = session;
      return session;
    }
  };
}
