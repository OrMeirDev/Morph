// The real conversion stack for integration tests: probed engines, the engine worker process,
// intake, coordinator and adapters, as main.cjs wires them (minus Electron and IPC).
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, sevenZip } = require('./helpers.cjs');

const sz = sevenZip();
if (sz) process.env.MORPH_TOOL_SEVENZIP = sz;

const limits = require('../../electron/domain/limits.cjs');
const { ToolRegistry } = require('../../electron/infra/ToolRegistry.cjs');
const { runProcess } = require('../../electron/infra/ProcessRunner.cjs');
const { PersistentWorker, runInFreshWorker } = require('../../electron/infra/WorkerHost.cjs');
const { JobRepository } = require('../../electron/infra/repositories.cjs');
const { OfficeProfileManager } = require('../../electron/infra/OfficeProfileManager.cjs');
const { FileIntakeService } = require('../../electron/app/FileIntakeService.cjs');
const { ConversionCoordinator } = require('../../electron/app/ConversionCoordinator.cjs');
const adapters = require('../../electron/adapters/index.cjs');

function createStack(tag) {
  const root = tmpDir(tag);
  const worker = new PersistentWorker();
  const tools = new ToolRegistry({ probeImages: () => worker.request({ type: 'probe' }, { timeoutMs: 30000 }) });
  const intake = new FileIntakeService({ detect: (f) => worker.request({ type: 'detect', file: f }, { timeoutMs: 15000 }), tools, limits: limits.intake });
  const updates = [];
  const history = [];
  const coordinator = new ConversionCoordinator({
    intake,
    tools,
    settings: { get: () => ({ outputMode: 'beside', folder: root, quality: 'medium', maxHeight: null }) },
    history: { add: (e) => { history.push(e); return e; } },
    journal: new JobRepository(path.join(root, 'state')),
    adapters,
    officeProfiles: new OfficeProfileManager({ baseDir: path.join(root, 'lo') }),
    runTool: (name, args, o) => { const exe = tools.path(name); return exe ? runProcess(exe, args, { ...o, name }) : Promise.reject(new Error(`missing-tool:${name}`)); },
    runWorker: runInFreshWorker,
    emit: (u) => updates.push(u),
    workspaceRoot: path.join(root, 'ws'),
  });
  const lastUpdate = (fileId) => updates.filter((u) => u.fileId === fileId).at(-1);
  // Detect, check the target is offered, convert, and return the final job update.
  async function convert(file, target) {
    const [d] = await intake.detectPaths([file]);
    assert.ok(d.ok, `detected ${path.basename(file)}: ${d.error}`);
    assert.ok(d.targets.includes(target), `${d.kind} offers ${target} (offers ${d.targets})`);
    const r = coordinator.enqueue({ fileId: d.id, target });
    assert.ok(r.ok, r.error);
    await coordinator.whenIdle();
    return lastUpdate(d.id);
  }
  const dirOf = (name) => { const d = path.join(root, name); fs.mkdirSync(d, { recursive: true }); return d; };
  const tool = (name, args, o = {}) => runProcess(tools.path(name), args, { timeoutMs: 60000, ...o });
  const ffprobe = async (file) => JSON.parse((await tool('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { captureStdout: true })).stdout);
  const pdfPages = async (file) => Number((await tool('pdfinfo', [file], { captureStdout: true })).stdout.match(/^Pages:\s+(\d+)/m)[1]);
  const pdfText = async (file) => { const out = `${file}.check.txt`; await tool('pdftotext', ['-enc', 'UTF-8', file, out]); const t = fs.readFileSync(out, 'utf8'); fs.rmSync(out); return t; };
  return {
    root, worker, tools, intake, coordinator, updates, history, lastUpdate, convert, dirOf, tool, ffprobe, pdfPages, pdfText,
    has: (cap) => tools.has(cap),
    stop: () => worker.stop(),
  };
}

module.exports = { createStack };
