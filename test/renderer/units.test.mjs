import test from 'node:test';
import assert from 'node:assert/strict';
import { convertUnit } from '../../src/domain/units/convertUnit.js';
import { UNITS } from '../../src/domain/units/unitCatalog.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('length and weight factors', () => {
  close(convertUnit('length', 1, 'mi', 'km'), 1.609344);
  close(convertUnit('weight', 1, 'lb', 'g'), 453.59237);
});

test('temperature conversions are affine', () => {
  close(convertUnit('temperature', 100, 'c', 'f'), 212);
  close(convertUnit('temperature', 32, 'f', 'k'), 273.15);
  close(convertUnit('temperature', 0, 'k', 'c'), -273.15);
});

test('every linear unit round-trips through every other unit of its category', () => {
  for (const [cat, { units }] of Object.entries(UNITS)) {
    if (cat === 'temperature') continue;
    for (const a of Object.keys(units)) for (const b of Object.keys(units)) close(convertUnit(cat, convertUnit(cat, 3.7, a, b), b, a), 3.7);
  }
});
