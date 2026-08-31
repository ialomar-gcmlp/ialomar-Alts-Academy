/**
 * Seeded pseudo-random numbers.
 *
 * Anything generated for the user to answer — a drill's choice order, its distractors
 * — must be stable. If a re-render reshuffled the options, the answer index would
 * move under the user's feet. So: no Math.random anywhere in generated content, and
 * every shuffle takes an explicit seed.
 *
 * mulberry32: small, fast, good enough for shuffling. Not for anything security-related.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, for deriving a seed from an id. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fisher-Yates, on a copy. Deterministic for a given rng. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    // Guarded for noUncheckedIndexedAccess; both indices are always in range.
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/** `count` distinct items, or all of them if there are fewer. */
export function sample<T>(items: readonly T[], count: number, rng: Rng): T[] {
  return shuffle(items, rng).slice(0, Math.max(0, count));
}
