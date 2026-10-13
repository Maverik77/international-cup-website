import { toPairingItems } from './pairings.mjs';

// Nothing waits on the network. markDirty() is synchronous; flushNow() always
// resolves. A push that never settles is abandoned after pushTimeout (a plain
// timer, independent of the injected scheduler) and counted as a failure.
export function createOutbox({
  getState,
  push,
  onStatus = () => {},
  now = () => new Date().toISOString(),
  schedule = setTimeout,
  cancel = clearTimeout,
  minDelay = 1000,
  maxDelay = 30000,
  enabled = true,
  pushTimeout = 20000,
}) {
  let timer = null;
  let inFlight = false;
  let dirty = false;
  let failures = 0;
  let lastPushed = null;
  let stopped = false;

  const backoff = () => Math.min(maxDelay, minDelay * 2 ** failures);

  const report = (status) => {
    try { onStatus(status); } catch { /* a bad listener must not reach the reveal */ }
  };

  function arm(ms) {
    if (!enabled || stopped || timer !== null || inFlight) return;
    try {
      timer = schedule(() => { timer = null; return flush(); }, ms);
    } catch {
      timer = null;
    }
  }

  function withTimeout(promise) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), pushTimeout);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }

  // Only our own AwsError text (route + status code) is surfaced.
  const describe = (e) => (e && e.name === 'AwsError' && typeof e.message === 'string'
    ? e.message
    : (e && e.message === 'timeout' ? 'push timed out' : 'push failed'));

  async function flush() {
    if (!enabled || stopped || inFlight) return;
    if (timer !== null) { try { cancel(timer); } catch { /* ignore */ } timer = null; }
    inFlight = true;
    dirty = false; // anything marked from here on is newer than this snapshot
    try {
      const items = toPairingItems(getState());
      await withTimeout(Promise.resolve().then(() => push(items)));
      failures = 0;
      lastPushed = now();
      inFlight = false;
      report({ dirty, lastPushed, lastError: null });
      if (dirty) arm(minDelay);
    } catch (e) {
      failures += 1;
      inFlight = false;
      dirty = true;
      report({ dirty: true, lastPushed, lastError: describe(e) });
      arm(backoff());
    }
  }

  return {
    markDirty() {
      dirty = true;
      arm(failures === 0 ? minDelay : backoff());
    },
    // Always resolves. Nothing in the reveal path may be made to throw by the network.
    async flushNow() {
      try { await flush(); } catch { /* unreachable, belt and braces */ }
    },
    stop() {
      stopped = true;
      if (timer !== null) { try { cancel(timer); } catch { /* ignore */ } timer = null; }
    },
    pending() { return timer !== null || inFlight; },
  };
}
