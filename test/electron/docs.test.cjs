const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render } = require('../../scripts/format-matrix.cjs');

test('docs/FORMATS.md matches the conversion registry (run node scripts/format-matrix.cjs)', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../docs/FORMATS.md'), 'utf8'), render());
});
