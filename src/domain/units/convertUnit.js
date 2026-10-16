// Pure numeric unit conversion over the catalog in unitCatalog.js.
import { UNITS } from './unitCatalog.js';

export function toCelsius(v, u) { return u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15; }
export function fromCelsius(c, u) { return u === 'c' ? c : u === 'f' ? c * 9 / 5 + 32 : c + 273.15; }

export function convertUnit(cat, value, from, to) {
  if (cat === 'temperature') return fromCelsius(toCelsius(value, from), to);
  const u = UNITS[cat].units;
  return (value * u[from][1]) / u[to][1];
}
