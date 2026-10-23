/*
 * Deterministic pseudo-random noise for the mock provider. Plain JS numbers are fine here:
 * these are random multipliers, not money. Prices are turned into Decimals right after.
 */

/** FNV-1a hash of a string to an unsigned 32-bit integer. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic value in [-1, 1] for an integer lattice point. */
function lattice(seed: number, point: number): number {
  let x =
    (seed ^
      Math.imul(point | 0, 0x9e3779b1) ^
      Math.imul(Math.floor(point / 2 ** 32), 0x85ebca6b)) >>>
    0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1]: same input, same output, no jumps. */
export function valueNoise(seed: number, position: number): number {
  const base = Math.floor(position);
  const fraction = position - base;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  const a = lattice(seed, base);
  const b = lattice(seed, base + 1);
  return a + (b - a) * smooth;
}
