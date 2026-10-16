// Runtime contracts for every renderer -> main command. A payload that does not match is refused
// before any filesystem or engine work. Kept dependency-free on purpose.
class SchemaError extends Error {
  constructor(where) { super(`bad-request:${where}`); this.code = 'bad-request'; }
}

const v = {
  none: () => (args) => { if (args.length) throw new SchemaError('unexpected-arguments'); return []; },
  string: ({ max = 4096, pattern } = {}) => (x, at) => {
    if (typeof x !== 'string' || !x.length || x.length > max || x.includes('\0') || (pattern && !pattern.test(x))) throw new SchemaError(at);
    return x;
  },
  arrayOf: (item, { max }) => (x, at) => {
    if (!Array.isArray(x) || x.length > max) throw new SchemaError(at);
    return x.map((e, i) => item(e, `${at}[${i}]`));
  },
  object: (shape) => (x, at) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new SchemaError(at);
    const extra = Object.keys(x).filter((k) => !(k in shape));
    if (extra.length) throw new SchemaError(`${at}.${extra[0]}`);
    return Object.fromEntries(Object.entries(shape).map(([k, check]) => [k, check(x[k], `${at}.${k}`)]));
  },
  partial: (shape) => (x, at) => {
    if (!x || typeof x !== 'object' || Array.isArray(x) || !Object.keys(x).length) throw new SchemaError(at);
    for (const k of Object.keys(x)) if (!(k in shape)) throw new SchemaError(`${at}.${k}`);
    return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, shape[k](val, `${at}.${k}`)]));
  },
  oneOf: (values) => (x, at) => { if (!values.includes(x)) throw new SchemaError(at); return x; },
  args: (...checks) => (args) => {
    if (args.length !== checks.length) throw new SchemaError('arity');
    return checks.map((c, i) => c(args[i], `arg${i}`));
  },
};

const fileId = v.string({ max: 64, pattern: /^[0-9a-f-]{36}$/ });
const target = v.string({ max: 16, pattern: /^[a-z0-9.]+$/ });
const anyPath = v.string({ max: 4096 });

const SCHEMAS = {
  'files:detect': v.args(v.arrayOf(anyPath, { max: 1000 })),
  'files:pick': v.none(),
  'files:release': v.args(fileId),
  'jobs:enqueue': v.args(v.object({ fileId, target })),
  'jobs:cancel': v.args(fileId),
  'jobs:snapshot': v.none(),
  'tools:status': v.none(),
  'settings:get': v.none(),
  'settings:set': v.args(v.partial({
    outputMode: v.oneOf(['beside', 'folder']),
    folder: anyPath,
    quality: v.oneOf(['high', 'medium', 'small']),
    maxHeight: v.oneOf([null, 1080, 720, 480]),
  })),
  'history:get': v.none(),
  'history:clear': v.none(),
  'folder:choose': v.none(),
  'folder:open': v.none(),
  'output:open': v.args(anyPath),
  'output:show': v.args(anyPath),
  'app:version': v.none(),
  'update:check': v.none(),
  'update:download': v.none(),
  'update:install': v.none(),
};

module.exports = { SCHEMAS, SchemaError, v };
