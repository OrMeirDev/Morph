import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWallTime, partsIn, dayOffset } from '../../src/domain/time/timeZoneConversion.js';

const wall = (instant, tz) => { const p = partsIn(instant, tz); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };

test('an ordinary wall time round-trips exactly', () => {
  for (const [tz, d, t] of [['America/New_York', '2026-07-01', '12:15'], ['Asia/Jerusalem', '2026-01-10', '23:59'], ['Asia/Kolkata', '2026-05-05', '00:00'], ['Australia/Sydney', '2026-04-05', '12:00']]) {
    const r = resolveWallTime(d, t, tz);
    assert.equal(r.status, 'exact');
    assert.equal(wall(r.instant, tz), `${d} ${t}`);
  }
});

test('New York spring-forward gap: 02:30 does not exist and is never shown as 01:30', () => {
  const r = resolveWallTime('2026-03-08', '02:30', 'America/New_York');
  assert.equal(r.status, 'gap');
  assert.equal(r.instant.toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(wall(r.instant, 'America/New_York'), '2026-03-08 03:30'); // moved forward by the skipped hour
  assert.equal(r.shiftMinutes, 60);
});

test('New York fall-back fold: 01:30 happens twice; the earlier one is chosen and both are reported', () => {
  const r = resolveWallTime('2026-11-01', '01:30', 'America/New_York');
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.instant.toISOString(), '2026-11-01T05:30:00.000Z'); // EDT, the first 01:30
  assert.equal(r.later.toISOString(), '2026-11-01T06:30:00.000Z'); // EST, the second 01:30
  assert.equal(wall(r.instant, 'America/New_York'), '2026-11-01 01:30');
});

test('Jerusalem transitions (2026-03-27 forward, 2026-10-25 back)', () => {
  const gap = resolveWallTime('2026-03-27', '02:30', 'Asia/Jerusalem');
  assert.equal(gap.status, 'gap');
  assert.equal(wall(gap.instant, 'Asia/Jerusalem'), '2026-03-27 03:30');
  const fold = resolveWallTime('2026-10-25', '01:30', 'Asia/Jerusalem');
  assert.equal(fold.status, 'ambiguous');
  assert.equal(fold.instant.toISOString(), '2026-10-24T22:30:00.000Z');
});

test('day offset across month and year boundaries', () => {
  const r = resolveWallTime('2026-12-31', '23:00', 'Asia/Jerusalem');
  assert.equal(dayOffset(r.instant, 'Asia/Tokyo', 'Asia/Jerusalem'), 1); // 2027-01-01 in Tokyo
  const s = resolveWallTime('2026-03-01', '01:00', 'Asia/Jerusalem');
  assert.equal(dayOffset(s.instant, 'America/Los_Angeles', 'Asia/Jerusalem'), -1); // still 28 Feb in LA
  assert.equal(dayOffset(s.instant, 'Europe/London', 'Asia/Jerusalem'), -1);
  assert.equal(dayOffset(s.instant, 'Asia/Dubai', 'Asia/Jerusalem'), 0);
});
