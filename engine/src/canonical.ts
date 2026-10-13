import { isObj, PALETTE_KEYS, profileOf, type Palette, type Puzzle } from './puzzle.ts';

/**
 * JSON with sorted keys and no whitespace. Non-ASCII characters become \uXXXX, so the result is
 * ASCII only.
 */
export function stableStringify(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  if (isObj(x))
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${stableStringify(k)}:${stableStringify(x[k])}`)
      .join(',')}}`;
  return JSON.stringify(x).replace(
    /[\u007f-\uffff]/g,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/** The canonical puzzle object. It has no title, author, hint, or solution. The palette lists are
 * explicit and in profile order. The tools list is there only if it leaves out a tool, so IDs made
 * before tools existed do not change. */
export function canonicalObject(p: Puzzle): Omit<Puzzle, 'title' | 'author' | 'hint' | 'solution'> {
  const prof = profileOf(p);
  const { title, author, hint, solution, ...rest } = p;
  const palette = Object.fromEntries(
    PALETTE_KEYS.map((k) => [k, prof[k].filter((t) => (p.palette?.[k] ?? prof[k]).includes(t))]),
  ) as unknown as Palette;
  if (palette.tools?.length === prof.tools.length) delete palette.tools;
  return { ...rest, palette };
}

export function canonicalize(p: Puzzle): string {
  return stableStringify(canonicalObject(p));
}

/** The FNV-1a 64-bit hash of the canonical (ASCII) bytes, as 16 lowercase hex characters. */
function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export function puzzleId(p: Puzzle): string {
  return fnv1a64(canonicalize(p));
}
