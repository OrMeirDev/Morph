// Child process for test/windows/confinement.test.cjs: runs the real conversion stack (as main.cjs
// wires it) on one file and stays alive, so the test can kill this process the way a crash or a
// forced quit would and check that the engines die with it.
//   node confined-child.cjs <root> <file> <target>
const path = require('path');
const { ToolRegistry } = require('../../electron/infra/ToolRegistry.cjs');
const { PersistentWorker, runInFreshWorker } = require('../../electron/infra/WorkerHost.cjs');
const { JobRepository } = require('../../electron/infra/repositories.cjs');
const { OfficeProfileManager } = require('../../electron/infra/OfficeProfileManager.cjs');
const { FileIntakeService } = require('../../electron/app/FileIntakeService.cjs');
const { ConversionCoordinator } = require('../../electron/app/ConversionCoordinator.cjs');
const adapters = require('../../electron/adapters/index.cjs');
const limits = require('../../electron/domain/limits.cjs');

const [root, file, target] = process.argv.slice(2);

(async () => {
  const worker = new PersistentWorker();
  const tools = new ToolRegistry({ probeImages: () => worker.request({ type: 'probe' }, { timeoutMs: 30000 }) });
  await tools.probe();
  const intake = new FileIntakeService({ detect: (f) => worker.request({ type: 'detect', file: f }, { timeoutMs: 15000 }), tools, limits: limits.intake });
  const coordinator = new ConversionCoordinator({
    intake,
    tools,
    settings: { get: () => ({ outputMode: 'beside', folder: root, quality: 'medium', maxHeight: null }) },
    history: { add: (e) => e },
    journal: new JobRepository(path.join(root, 'state')),
    adapters,
    officeProfiles: new OfficeProfileManager({ baseDir: path.join(root, 'lo') }),
    runTool: (name, args, o) => tools.run(name, args, o),
    runWorker: (msg, o) => runInFreshWorker(msg, { ...o, confine: { confinement: tools.confinement, workspace: o.workspace } }),
    emit: (u) => process.stdout.write(`${JSON.stringify({ state: u.state, error: u.error })}\n`),
    workspaceRoot: path.join(root, 'ws'),
  });
  const [d] = await intake.detectPaths([file]);
  coordinator.enqueue({ fileId: d.id, target });
  setInterval(() => {}, 1 << 30); // stay alive until killed
})();
