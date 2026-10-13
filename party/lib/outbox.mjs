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

  // LIVE PROTECTION, NOT REDUNDANT: the timer path has no flushNow() wrapper, so
  // this guard is what stops a throwing onStatus listener from becoming an
  // unhandled rejection (Node exits on those). Do not remove it.
  const report = (status) => {
    try { onStatus(status); } catch { /* a bad listener must not reach the reveal */ }
  };

  function arm(ms) {
    if (!enabled || stopped || timer !== null || inFlight) return;
    try {
      // .catch: a floating rejection would kill the process driving the screen.
      timer = schedule(() => { timer = null; return flush().catch(() => {}); }, ms);
    } catch {
      timer = null;
    }
  }

  let abortWait = null; // settles the current push wait early (used by stop)
  let current = null; // promise of the flush in flight, for flushNow to await

  // LOAD-BEARING ORDER: pushTimeout (20 s) must stay LONGER than the 15 s
  // AbortSignal in aws.mjs. An abandoned push could otherwise still land after
  // a newer one and overwrite it with stale state. With the real client the
  // abort fires first, so the request is dead before we give up on it. A custom
  // injected push gets no such protection. Keep the two numbers in this order.
  function withTimeout(promise) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { abortWait = null; reject(new Error('timeout')); }, pushTimeout);
      abortWait = () => { clearTimeout(t); abortWait = null; reject(new Error('stopped')); };
      promise.then(
        (v) => { clearTimeout(t); abortWait = null; resolve(v); },
        (e) => { clearTimeout(t); abortWait = null; reject(e); },
      );
    });
  }

  // Only our own AwsError text (route + status code) is surfaced.
  const describe = (e) => {
    try {
      if (e && e.name === 'AwsError' && typeof e.message === 'string') return e.message;
      return e && e.message === 'timeout' ? 'push timed out' : 'push failed';
    } catch {
      return 'push failed'; // an error whose getters throw
    }
  };

  function flush() {
    if (!enabled || stopped || inFlight) return Promise.resolve();
    current = run().finally(() => { current = null; });
    return current;
  }

  async function run() {
    if (timer !== null) { try { cancel(timer); } catch { /* ignore */ } timer = null; }
    inFlight = true;
    dirty = false; // anything marked from here on is newer than this snapshot
    try {
      const items = toPairingItems(getState());
      await withTimeout(Promise.resolve().then(() => push(items)));
      failures = 0;
      lastPushed = now();
      inFlight = false;
      if (stopped) return;
      report({ dirty, lastPushed, lastError: null });
      if (dirty) arm(minDelay);
    } catch (e) {
      failures += 1;
      inFlight = false;
      dirty = true;
      if (stopped) return; // shut down: say nothing, retry nothing
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
      try {
        // A flush already in flight: wait for it to land (an end-of-night flush
        // must not resolve early), then push once more if state moved on.
        if (current) {
          try { await current; } catch { /* ignore */ }
          if (dirty) await flush();
        } else {
          await flush();
        }
      } catch { /* belt and braces; report() is the live guard on the timer path */ }
    },
    stop() {
      stopped = true;
      if (abortWait) abortWait();
      if (timer !== null) { try { cancel(timer); } catch { /* ignore */ } timer = null; }
    },
    pending() { return timer !== null || inFlight; },
  };
}
