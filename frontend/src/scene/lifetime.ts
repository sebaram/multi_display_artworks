export function createLifetime() {
  let disposed = false;
  const cleanup: (() => void)[] = [];
  return {
    get disposed() {
      return disposed;
    },
    add(fn: () => void) {
      if (disposed) fn();
      else cleanup.push(fn);
      return fn;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of cleanup.reverse()) {
        try {
          fn();
        } catch (error) {
          console.warn("Room resource cleanup failed", error);
        }
      }
      cleanup.length = 0;
    },
  };
}
