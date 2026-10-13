export interface Profile {
  id: string;
  /** The shape tokens. */
  shapes: string[];
  /** For each shape, the number of different directions: 1 (no direction), 2, or 4. */
  periods: number[];
  /** For each shape, its parent shape in the cut tree, or -1 for the root shape. */
  cutFrom: number[];
  colors: string[];
  /** The palette tools other than shapes and colors, for example obstacles in conditions. */
  tools: string[];
  maxRules: number;
  maxConds: number;
  maxSize: number;
}

/**
 * A square and a circle look the same after each quarter turn. A leaf and an hourglass look the
 * same after a half turn. A quarter circle, a triangle, a half-disc, and a wedge have four
 * directions.
 */
export const STD2: Profile = {
  id: 'std2',
  shapes: ['S', 'Q', 'T', 'L', 'C', 'D', 'H', 'W'],
  periods: [1, 4, 4, 2, 1, 4, 2, 4],
  // The cut tree: square → quarter circle → triangle or leaf; square → circle → half-disc;
  // square → hourglass → wedge.
  cutFrom: [-1, 0, 1, 1, 0, 4, 0, 6],
  colors: ['b', 'r', 'y'],
  tools: ['obstacle'],
  maxRules: 12,
  maxConds: 8,
  maxSize: 7,
};

export const SHAPE_NAMES: Record<string, string> = {
  S: 'square',
  Q: 'quarter circle',
  T: 'triangle',
  L: 'leaf',
  C: 'circle',
  D: 'half-disc',
  H: 'hourglass',
  W: 'wedge',
};
export const COLOR_NAMES: Record<string, string> = { b: 'blue', r: 'red', y: 'yellow' };

/** Whether `to` is the same shape as `from`, or one cut (one level) down the cut tree from it. */
export function canCut(prof: Profile, from: number, to: number): boolean {
  return to === from || prof.cutFrom[to] === from;
}

const PROFILES: Record<string, Profile> = { std2: STD2 };

export function getProfile(id: string): Profile | undefined {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id] : undefined;
}
