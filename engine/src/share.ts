import { canonicalObject, stableStringify } from './canonical.ts';
import { parsePuzzle, type Puzzle, type ValidationError } from './puzzle.ts';
import { upgradeRules, validateRules, type Rule } from './rules.ts';

/** The maximum size of a decoded payload or a share fragment: 8 kB. */
const SHARE_CAP = 8192;

/** Rule pictures are already canonical. Keep the rule order. Keep a turn only if it is not 0. */
export function canonicalRules(rules: Rule[]): Rule[] {
  return rules.map((r) => ({
    condition: [...r.condition],
    change: [...r.change],
    ...(r.turn && { turn: r.turn }),
  }));
}

async function pump(
  bytes: Uint8Array<ArrayBuffer>,
  t: CompressionStream | DecompressionStream,
  cap = Infinity,
) {
  const reader = new Blob([bytes]).stream().pipeThrough(t).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    n += value.length;
    if (n > cap) {
      await reader.cancel();
      throw new Error(`payload exceeds ${cap} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  chunks.reduce((o, c) => (out.set(c, o), o + c.length), 0);
  return out;
}

/** Compress an ASCII string with raw DEFLATE, then encode it as base64url without padding. */
export async function deflateText(s: string): Promise<string> {
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  const z = await pump(bytes, new CompressionStream('deflate-raw'));
  return z.toBase64({ alphabet: 'base64url', omitPadding: true });
}

async function inflateText(b64: string, cap = SHARE_CAP): Promise<string> {
  const z = Uint8Array.fromBase64(b64, { alphabet: 'base64url' });
  const bytes = await pump(z, new DecompressionStream('deflate-raw'), cap);
  if (bytes.some((b) => b > 127)) throw new Error('payload is not ASCII');
  // A large payload goes in parts: a call takes a limited number of arguments.
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

/**
 * The share payload: the canonical form, with the title, the author, and a solution added again.
 * A solution that wins tells the player who opens the link that the puzzle is verified.
 */
export function shareJson(p: Puzzle): string {
  return stableStringify({
    ...canonicalObject(p),
    ...(p.title !== undefined && { title: p.title }),
    ...(p.author !== undefined && { author: p.author }),
    ...(p.solution && { solution: canonicalRules(p.solution) }),
  });
}

const isRules = (r: Rule[] | ValidationError[]): r is Rule[] => r.every((x) => 'condition' in x);

/** Rules in the form of a link part. */
export const encodeRules = (rules: Rule[]) => deflateText(stableStringify(canonicalRules(rules)));

/** Rules from a link part, if they are valid for puzzle p. */
export async function decodeRules(part: string, p: Puzzle): Promise<Rule[] | ValidationError[]> {
  let rj: unknown;
  try {
    rj = JSON.parse(await inflateText(part));
  } catch (e) {
    return [
      { path: 'share', message: `link is damaged: ${(e as Error).message || 'invalid data'}` },
    ];
  }
  const rules = upgradeRules(rj) as Rule[];
  const errs = validateRules(p, rules);
  return errs.length ? errs : rules;
}

/** Make `#/p/<P>`, or `#/p/<P>/s/<S>` if there is a solution. */
export async function encodeShare(p: Puzzle, rules?: Rule[]): Promise<string> {
  const P = await deflateText(shareJson(p));
  return rules ? `#/p/${P}/s/${await encodeRules(rules)}` : `#/p/${P}`;
}

export async function decodeShare(
  fragment: string,
): Promise<{ puzzle: Puzzle; rules?: Rule[] } | ValidationError[]> {
  const fail = (message: string) => [{ path: 'share', message }];
  if (fragment.length > SHARE_CAP) return fail('link is too long');
  const m = fragment.replace(/^#/, '').match(/^\/p\/([A-Za-z0-9_-]+)(?:\/s\/([A-Za-z0-9_-]+))?$/);
  if (!m) return fail('not a puzzle link');
  let pj: unknown;
  try {
    pj = JSON.parse(await inflateText(m[1]));
  } catch (e) {
    return fail(`link is damaged: ${(e as Error).message || 'invalid data'}`);
  }
  const puzzle = parsePuzzle(pj);
  if (Array.isArray(puzzle)) return puzzle;
  if (!m[2]) return { puzzle };
  const rules = await decodeRules(m[2], puzzle);
  return isRules(rules) ? { puzzle, rules } : rules;
}

/** The size limit of an Unlimited link (64 kB), and of its decoded setup (1 MB). */
const UNLIMITED_CAP = 1 << 16;

/**
 * Make `#/u/<U>` for an Unlimited setup (its rules, its start board, and its view), or null if the
 * link is longer than the limit.
 */
export async function encodeUnlimited(setup: object): Promise<string | null> {
  const link = `#/u/${await deflateText(JSON.stringify(setup))}`;
  return link.length <= UNLIMITED_CAP ? link : null;
}

/** The setup of an Unlimited link, not yet checked. Throws if the link is damaged. */
export async function decodeUnlimited(fragment: string): Promise<unknown> {
  if (fragment.length > UNLIMITED_CAP) throw new Error('link is too long');
  const m = fragment.replace(/^#/, '').match(/^\/u\/([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('not an Unlimited link');
  return JSON.parse(await inflateText(m[1], UNLIMITED_CAP * 16));
}
