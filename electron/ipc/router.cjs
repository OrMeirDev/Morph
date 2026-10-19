// Registers IPC handlers that answer only Morph's own window (main frame, app URL) and only with
// payloads matching ipc/schemas.cjs. Everything else is refused before the handler runs.
const { SCHEMAS } = require('./schemas.cjs');

function createRouter({ ipcMain, isTrustedSender, log = () => {} }) {
  return {
    handle(channel, fn) {
      const schema = SCHEMAS[channel];
      if (!schema) throw new Error(`no schema for ${channel}`);
      ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedSender(event)) {
          log(`refused ${channel}: untrusted sender`);
          throw new Error('forbidden');
        }
        const parsed = schema(args); // throws bad-request:<where>
        return fn(...parsed, event);
      });
    },
  };
}

// The sender must be the main frame of Morph's window showing Morph's own page.
function trustedSenderCheck({ getWindow, appUrlPrefix }) {
  return (event) => {
    const win = getWindow();
    const frame = event.senderFrame;
    return !!win && !win.isDestroyed() && event.sender === win.webContents && !!frame && frame.parent === null
      && typeof frame.url === 'string' && frame.url.startsWith(appUrlPrefix);
  };
}

module.exports = { createRouter, trustedSenderCheck };
