const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render } = require('../../scripts/format-matrix.cjs');

test('docs/FORMATS.md matches the conversion registry (run node scripts/format-matrix.cjs)', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../docs/FORMATS.md'), 'utf8'), render());
});

test('THIRD_PARTY_NOTICES.md names every bundled engine at the version and URL the lock pins', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/engines.lock.json'), 'utf8'));
  const notices = fs.readFileSync(path.join(__dirname, '../../THIRD_PARTY_NOTICES.md'), 'utf8');
  const rows = notices.split('\n').filter((l) => l.startsWith('| ') && l.includes('`bin/'));
  for (const e of lock.engines) {
    const row = rows.find((r) => r.includes(`\`bin/${e.install.to}\``));
    assert.ok(row, `notices row for bin/${e.install.to}`);
    const version = e.version.replace(/^v/, '').replace(/-\d+$/, '');
    const versionCell = row.split('|')[2];
    assert.ok(versionCell.includes(version), `${e.name}: notices say ${versionCell.trim()}, lock pins ${e.version}`);
    // GitHub downloads link their release page; others the download folder of that version.
    const u = e.download.url;
    const releasePage = /\/releases\/download\//.test(u)
      ? u.replace(/\/releases\/download\/([^/]+)\/.*$/, '/releases/tag/$1')
      : u.slice(0, u.indexOf(`/${e.version}/`) + e.version.length + 2);
    assert.ok(row.includes(releasePage), `${e.name}: notices link ${releasePage}`);
  }
});
