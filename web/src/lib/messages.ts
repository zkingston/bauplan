import {
  SHAPE_NAMES,
  STD2,
  STEP_LIMIT,
  type Tile,
  type Outcome,
  type Puzzle,
  type ValidationError,
} from '@bauplan/engine';
import { colorName } from './colors.ts';
import type { Best } from './store.ts';

/** The title of a puzzle as headings show it. */
export const titleOf = (p: Puzzle) => (p.title || 'UNTITLED').toUpperCase();

/** A count `k` with its word, plural if `k` is not 1: "1 rule", "12 steps". */
export const count = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

/** A sentence that tells how a run ends without a win. */
export const endText = (o: Outcome) =>
  o.kind === 'wrong'
    ? `Stopped at step ${o.steps}, but the board does not match the target.`
    : o.kind === 'loop'
      ? `The board repeats from step ${o.steps}.`
      : `Still changing after ${STEP_LIMIT} steps.`;

/** The hint when the turn tool cannot turn token `t`: a square or a circle, or no piece. */
export const turnHint = (t: string) =>
  /^[A-Z]/.test(t) ? 'Squares and circles cannot turn.' : 'Click a piece to turn it.';

const DIRECTION = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

/**
 * The status line for the inspected tile. It tells what the tile holds and the rule that it uses
 * next, with the number that the strip shows (through `slotOf`). It also tells the direction of
 * the rule, and if a contested tile blocks the rule.
 */
export function inspectText(
  v: Tile,
  ins: { rule: number; frame: number; blocked: boolean } | undefined,
  slotOf: number[],
) {
  const what =
    typeof v === 'object'
      ? `${colorName(STD2.colors[v.c])} ${SHAPE_NAMES[STD2.shapes[v.s]]}${STD2.periods[v.s] > 1 ? `, DIRECTION ${DIRECTION[v.d]}` : ''}`
      : v;
  const upcoming = !ins
    ? ''
    : ins.rule < 0
      ? ' · NEXT: NO RULE'
      : ` · NEXT: RULE ${slotOf[ins.rule] + 1}${
          // A piece that looks the same when turned can use a turned rule. Tell the direction.
          typeof v === 'object' && STD2.periods[v.s] < 4
            ? `, DIRECTION ${DIRECTION[ins.frame]}`
            : ''
        }${ins.blocked ? ', BLOCKED BY A CONTESTED TILE' : ''}`;
  return what.toUpperCase() + upcoming;
}

/** The short form of a best result: rules, conditions, and steps. */
export const bestText = (b: Best) => `${b.rules} R · ${b.conds} C · ${b.steps} S`;

/** Most engine messages about a rule are sentences for the player. These are the others. */
const RULE: Record<string, string> = {
  'must be {condition, change}, each 3 rows of 3 tiles': 'this is not a rule',
  'the center must be a piece with direction up': 'the center must be a piece',
  'turn must be 0 to 3': 'this rule has an unknown turn',
};

/** Start with a capital letter and end with a period. */
const sentence = (s: string) => s[0].toUpperCase() + s.slice(1) + (s.endsWith('.') ? '' : '.');

/** A shape with an article from its token letter: "a wedge", "an hourglass". */
function named(letter: string) {
  const shape = SHAPE_NAMES[letter] ?? letter;
  return /^[aeiou]|^hour/.test(shape) ? `an ${shape}` : `a ${shape}`;
}

/** The plural of a shape or color from its token letter: "wedges", "red pieces". */
function plural(letter: string) {
  const color = STD2.colors.includes(letter) ? colorName(letter) : undefined;
  if (color) return `${color} pieces`;
  const shape = SHAPE_NAMES[letter] ?? letter;
  return shape === 'leaf' ? 'leaves' : shape.endsWith('ss') ? `${shape}es` : `${shape}s`;
}

/** What is wrong with one rule, as a sentence without the rule number. The rule card shows it. */
export function ruleProblem(m: string): string {
  let x: RegExpMatchArray | null;
  if ((x = m.match(/^(\w) is not in this puzzle's palette$/)))
    return `This puzzle has no ${plural(x[1])}.`;
  if (m === "obstacles are not in this puzzle's palette") return 'This puzzle has no obstacles.';
  // A wrong cut names the shape that the piece has. The change picture shows the other shape.
  if ((x = m.match(/^(\w) cannot be cut into (\w)$/))) {
    const s = STD2.shapes.indexOf(x[1]);
    return STD2.cutFrom.includes(s)
      ? `Not a cut of ${named(x[1])}.`
      : sentence(`${named(x[1])} cannot be cut`);
  }
  if (m.startsWith('unknown tile')) return 'This rule has an unknown tile.';
  return sentence(RULE[m] ?? m);
}

/**
 * A validation error of a rule as a plain sentence. `n` is the rule number that the player sees (a
 * strip slot). By default, `n` is the index of the error in the rule list, from 1.
 */
export function ruleErrorText(e: ValidationError, n?: number): string {
  const m = e.message;
  let x: RegExpMatchArray | null;
  if (m === 'must be a list') return 'The rules are not a list.';
  if ((x = m.match(/^at most (\d+) rules$/))) return `Too many rules. Use ${x[1]} or fewer.`;
  const k = n ?? Number(e.path.match(/^rules\[(\d+)\]/)?.[1] ?? 0) + 1;
  return `Error on rule ${k}: ${ruleProblem(m)}`;
}

const FIELD: Record<string, string> = { title: 'title', author: 'author', w: 'width', h: 'height' };

/** A validation error of a puzzle or a share link as a plain sentence. */
export function puzzleErrorText(e: ValidationError): string {
  const { path, message: m } = e;
  if (path.startsWith('rules')) return ruleErrorText(e);
  const field = FIELD[path] ?? path;
  const row = path.match(/^(start|target)\[(\d+)\]$/);
  let x: RegExpMatchArray | null;
  if (m === 'start already matches target') return 'The start already matches the target.';
  if ((x = m.match(/^obstacles must coincide with the start's \(tile (\d+)\)$/)))
    return `Obstacles must match in start and target (tile ${Number(x[1]) + 1}).`;
  if ((x = m.match(/^must be a string of at most (\d+) characters$/)))
    return `Use ${x[1]} characters or fewer for the ${field}.`;
  if ((x = m.match(/^must be an integer from 1 to (\d+)$/)))
    return `Use a ${field} from 1 to ${x[1]}.`;
  if ((x = m.match(/^must be (\d+) rows$/))) return `Use ${x[1]} rows in the ${path}.`;
  if (row && (x = m.match(/^must be (\d+) tokens/)))
    return `Use ${x[1]} tiles in row ${Number(row[2]) + 1} of the ${row[1]}.`;
  if (row && (x = m.match(/at column (\d+)$/)))
    return `Row ${Number(row[2]) + 1} of the ${row[1]} has an unknown tile in column ${Number(x[1]) + 1}.`;
  if (m.startsWith('must be a subset of'))
    return 'Use only shapes, colors, and tools from the profile.';
  if (m === 'has duplicates') return 'Use each palette entry once.';
  if (m === 'unknown field') return `Remove the unknown field "${path}".`;
  if (path === 'v') return 'Use version 3.';
  if (m === 'unknown profile') return 'Use a known profile.';
  if (m === 'puzzle must be an object') return 'This is not a puzzle.';
  if (m === 'not a puzzle link') return 'This is not a puzzle link.';
  if (m === 'link is too long') return 'This link is too long.';
  if (m.startsWith('link is damaged')) return 'This link is damaged.';
  // Other errors, such as a limit, give the name of their field.
  return sentence(`${path ? path + ': ' : ''}${m}`);
}
