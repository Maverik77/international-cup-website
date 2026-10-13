// Server-sent events. A browser that vanishes mid-stream (tab closed, TV asleep,
// wifi gone) must cost nothing: its response is dropped on close, error or a
// failed write, and can never throw into a broadcast.
export function createSseHub({ pingMs = 15000 } = {}) {
  const clients = new Set();
  let nextId = 0;

  const drop = (res) => { clients.delete(res); };
  const send = (res, frame) => {
    try {
      if (res.destroyed || res.writableEnded) { drop(res); return; }
      res.write(frame);
    } catch {
      drop(res);
    }
  };

  const ping = setInterval(() => {
    for (const res of [...clients]) send(res, ':ping\n\n');
  }, pingMs);
  ping.unref?.();

  return {
    attach(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => drop(res));
      res.on('close', () => drop(res));
      res.on('error', () => drop(res));
    },
    // Write one frame to a single client (used for the on-connect snapshot).
    sendTo(res, event, data) {
      send(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    broadcast(event, data) {
      const frame = `id: ${++nextId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of [...clients]) send(res, frame);
    },
    count() { return clients.size; },
    closeAll() {
      clearInterval(ping);
      for (const res of [...clients]) { try { res.end(); } catch { /* going away anyway */ } }
      clients.clear();
    },
  };
}
