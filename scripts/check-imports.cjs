// Enforces Morph's module boundaries (see AGENTS.md). Run: npm run check:imports
// Fails on: a forbidden import for a layer, any import cycle among renderer modules, and renderer
// code that reaches window.morph outside services/morphApi.js.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE_BUILTINS = ['fs', 'path', 'os', 'child_process', 'net', 'http', 'https', 'worker_threads', 'url', 'crypto', 'stream'];
const builtin = (spec) => NODE_BUILTINS.includes(spec.replace(/^node:/, '').split('/')[0]);

// layer (path prefix, relative to repo) -> predicate over (specifier, resolved repo-relative path or null)
const RULES = [
  { layer: 'src/domain/', why: 'domain modules are pure: no React, Electron, Node APIs or UI layers',
    bad: (s, r) => /^(react|react-dom|lucide-react|electron)$/.test(s) || builtin(s) || (r && !r.startsWith('src/domain/')) },
  { layer: 'src/presentation/', why: 'presentation helpers are pure: no React, Electron, Node APIs or features',
    bad: (s, r) => /^(react|react-dom|electron)$/.test(s) || builtin(s) || (r && !/^src\/(presentation|domain)\//.test(r)) },
  { layer: 'src/design/', why: 'design primitives must not depend on the conversion domain, features or app',
    bad: (s, r) => s === 'electron' || builtin(s) || (r && /^src\/(features|app|services|domain)\//.test(r)) },
  { layer: 'src/features/', why: 'features must not import the app shell',
    bad: (s, r) => s === 'electron' || builtin(s) || (r && r.startsWith('src/app/')) },
  { layer: 'src/components/', why: 'shared components must not import feature internals other than presentation data',
    bad: (s, r) => s === 'electron' || builtin(s) || (r && /^src\/features\/(conversion|history|settings|units|clock)\//.test(r)) },
  { layer: 'src/', why: 'renderer code cannot use Electron or Node APIs',
    bad: (s) => s === 'electron' || builtin(s) },
  { layer: 'electron/domain/', why: 'backend domain is pure: no Electron, filesystem, processes or React',
    bad: (s, r) => /^(electron|react)$/.test(s) || /^(fs|child_process|net|http|https)$/.test(s.replace(/^node:/, '')) || (r && !r.startsWith('electron/domain/')) },
  { layer: 'electron/adapters/', why: 'engine adapters also run inside worker processes: no Electron APIs, no IPC/app modules',
    bad: (s, r) => s === 'electron' || (r && /^electron\/(ipc|app)\//.test(r)) || (r && r === 'electron/main.cjs') },
  { layer: 'electron/infra/', why: 'infrastructure must not depend on IPC, application services or the main entry',
    bad: (s, r) => (r && /^electron\/(ipc|app)\//.test(r)) || (r && r === 'electron/main.cjs') },
  { layer: 'electron/workers/', why: 'workers use process.parentPort, never the electron module or app modules',
    bad: (s, r) => s === 'electron' || (r && /^electron\/(ipc|app)\//.test(r)) },
];

const IMPORT_RE = /(?:^|[^.\w])(?:import\s+(?:[\w*{}\s,]+\s+from\s+)?|export\s+[\w*{}\s,]+\s+from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(c?js|mjs|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.cjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return base;
}

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'electron'))];
const problems = [];
const graph = new Map();

for (const file of files) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const deps = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    const target = resolve(file, spec);
    const targetRel = target ? rel(target) : null;
    if (target && /\.(c?js|jsx)$/.test(target)) deps.push(target);
    if (targetRel && /(^|\/)App\.jsx$/.test(targetRel)) problems.push(`${r}: imports the app root (${spec})`);
    for (const rule of RULES) {
      if (!r.startsWith(rule.layer)) continue;
      if (rule.bad(spec, targetRel)) problems.push(`${r}: forbidden import '${spec}' — ${rule.why}`);
      break; // most specific rule wins (RULES is ordered specific -> general)
    }
  }
  if (r.startsWith('src/') && r !== 'src/services/morphApi.js' && /window\.morph\b/.test(text)) {
    problems.push(`${r}: reaches window.morph directly — use services/morphApi.js`);
  }
  graph.set(file, deps);
}

// Cycle detection (renderer and backend separately share one graph; edges never cross).
const state = new Map();
const stack = [];
function visit(n) {
  state.set(n, 1);
  stack.push(n);
  for (const d of graph.get(n) || []) {
    if (!graph.has(d)) continue;
    if (state.get(d) === 1) problems.push(`import cycle: ${[...stack.slice(stack.indexOf(d)), d].map(rel).join(' -> ')}`);
    else if (!state.get(d)) visit(d);
  }
  stack.pop();
  state.set(n, 2);
}
for (const n of graph.keys()) if (!state.get(n)) visit(n);

if (problems.length) {
  console.error(`Module boundary check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Module boundaries OK (${files.length} files).`);
