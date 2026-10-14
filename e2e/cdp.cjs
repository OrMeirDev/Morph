// Minimal Chrome DevTools Protocol client for driving a packaged Morph (no test hooks in the app):
// find the app page on a debugging port, evaluate expressions in it, collect protocol events.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage(port, { timeoutMs = 60000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((p) => p.type === 'page' && /index\.html/.test(p.url));
      if (page) return page;
    } catch { /* not up yet */ }
    await wait(500);
  }
  return null;
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) events.push(msg);
  };
  // A closed socket (the app quit) must not leave callers waiting forever.
  ws.onclose = () => { for (const [, r] of pending) r({ closed: true }); pending.clear(); };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.closed) throw new Error('page closed');
    if (r.result?.exceptionDetails) throw new Error(`page: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  return { send, evaluate, events, close: () => ws.close() };
}

module.exports = { findPage, connect, wait };
