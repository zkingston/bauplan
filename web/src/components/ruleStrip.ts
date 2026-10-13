import {
  canonicalRules,
  CENTER,
  condCount,
  DIRECTIONS,
  rowsOf,
  SHAPE_NAMES,
  STD2,
  type Puzzle,
  type Rule,
  type ValidationError,
} from '@bauplan/engine';
import { colorName } from '../lib/colors.ts';
import { drawPictureTile } from './board.ts';
import { h, isPhone, reduceMotion, sideScroll } from '../lib/dom.ts';
import { arrows, CROSS, OFF, tries, triangle } from '../lib/icons.ts';
import { ruleProblem, turnHint } from '../lib/messages.ts';
import type { Brush, BrushDrop } from './palette.ts';
import {
  blankRule,
  brushToken,
  flat,
  isBlank,
  moved,
  period,
  pictureTile,
  tileOf,
  turned,
  turnPic,
  turnsOf,
} from '../lib/tokens.ts';

const DIRS = ['up', 'right', 'down', 'left'];
const turnsLabel = (turns: number, rot: number) =>
  `tried ${turns === 4 ? 'four' : 'two'} ways: ${tries(turns, rot)
    .map((d) => DIRS[d])
    .join(', ')}`;

/** A strip slot: a rule. `off` disables the rule but keeps it. */
export type Slot = Rule & { off?: boolean };

/** The rule strip always shows this number of slots. Blank slots are not rules. */
const SLOTS = 12;

/** All the slots of a strip: the rules, in order, and then blank slots. */
export const fillSlots = (rules: Slot[] = []): Slot[] =>
  Array.from({ length: SLOTS }, (_, i) => rules[i] ?? blankRule());

/**
 * The rule list of the slots that are not blank and not off, as plain rules, and for each rule its
 * slot.
 */
export function slotRules(slots: Slot[]) {
  const slotOf = slots.flatMap((r, i) => (isBlank(r) || r.off ? [] : [i]));
  return { slotOf, rules: canonicalRules(slotOf.map((i) => slots[i])) };
}

/** Engine errors with paths by slot. Engine paths count rules (`rules[k]`), and the strip slots. */
export const bySlot = (errors: ValidationError[], slotOf: number[]) =>
  errors.map((e) => ({
    ...e,
    path: e.path.replace(/^rules\[(\d+)\]/, (_, k) => `rules[${slotOf[+k]}]`),
  }));

/** Scroll a card into view, smoothly unless the player reduces motion. */
const reveal = (c: Element, inline: ScrollLogicalPosition) =>
  c.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', inline, block: 'nearest' });

/** Whether all of card c is in view in its row. */
function inView(c: Element, row: Element) {
  const r = c.getBoundingClientRect();
  const v = row.getBoundingClientRect();
  return r.left >= v.left - 1 && r.right <= v.right + 1;
}

/** Scroll the strip in `el` so that the card of slot `k` is in view, if it is not. */
export function showSlot(el: HTMLElement, k: number) {
  const row = el.querySelector('.rule-row');
  const c = row?.children[k];
  if (row && c && !inView(c, row)) reveal(c, isPhone() ? 'center' : 'nearest');
}

/**
 * The slot of the rule that an inspected piece uses next (from `explain`), unless a contested tile
 * blocks it.
 */
export const usedSlot = (ins: { rule: number; blocked: boolean } | undefined, slotOf: number[]) =>
  ins && !ins.blocked && ins.rule >= 0 ? slotOf[ins.rule] : undefined;

/** Mark the card of slot k as the card that the inspected piece uses. */
export const markUsed = (el: HTMLElement, k: number | undefined) =>
  el.querySelectorAll('.rule').forEach((c, i) => c.classList.toggle('used', i === k));

/** The token that a brush paints at position i of a picture, or an error message. */
function paint(b: Brush, grid: 'condition' | 'change', i: number): string | { error: string } {
  if (b.kind === 'turn') return { error: turnHint('') };
  if (b.kind === 'pan') return { error: 'Pick a brush to paint a rule.' };
  if (grid === 'condition' && i === CENTER && (b.kind === 'empty' || b.kind === 'obstacle'))
    return { error: 'The center must be a piece.' };
  if (b.kind === 'obstacle' && grid === 'change') return { error: 'A rule cannot add obstacles.' };
  return brushToken(b)!;
}

function describe(t: string, grid: 'condition' | 'change'): string {
  if (t === '---') return grid === 'condition' ? 'any tile' : 'unchanged';
  if (t === '...') return grid === 'condition' ? 'empty' : 'removes the piece';
  if (t === '###') return 'obstacle';
  const d = DIRECTIONS.indexOf(t[2]);
  const dir = period(STD2.shapes.indexOf(t[0])) > 1 ? `, direction ${DIRS[d]}` : '';
  return `${colorName(t[1])} ${SHAPE_NAMES[t[0]]}${dir}`;
}

const TILE = 36;

export interface StripProps {
  p: Puzzle;
  /** The slots. Blank slots and disabled slots are not rules. */
  slots: Slot[];
  /** Validation errors with paths by slot: `rules[<slot>]...`. */
  errors: ValidationError[];
  brush: Brush;
  /** The slot with the rule that the inspected tile uses. */
  used?: number;
  onChange(slots: Slot[]): void;
  onHint(message: string): void;
  /**
   * For a strip without a slot limit: a + card at the end adds a slot. Then a delete removes its
   * slot, not only the rule.
   */
  onAdd?: () => void;
}

let pendingFocus: string | undefined;

/** The rule strip: all slot cards (condition → change) in one row that scrolls. */
export function renderRuleStrip(el: HTMLElement, props: StripProps) {
  const { p, slots, errors, brush, used, onChange, onHint, onAdd } = props;
  const focused = pendingFocus ?? (document.activeElement as HTMLElement | null)?.dataset?.k;
  pendingFocus = undefined;
  const old = el.querySelector('.rule-row');
  const scroll = old?.scrollLeft ?? 0;
  const move = (from: number, to: number) => {
    const out = [...slots];
    out.splice(to, 0, ...out.splice(from, 1));
    return out;
  };
  const usable = Math.min(slots.length, p.limits.rules);
  /** A button that moves rule k to the position of its neighbor. This changes the rule order. */
  const shift = (k: number, by: number, label: string, aria: string) => {
    const to = k + by;
    const key = `r${k}.${by < 0 ? 'left' : 'right'}`;
    return h(
      'button',
      {
        class: 'icon',
        'data-k': key,
        'aria-label': aria,
        title: aria,
        disabled: to < 0 || to >= usable || k >= usable,
        onclick: () => {
          pendingFocus = `r${to}.${by < 0 ? 'left' : 'right'}`;
          onChange(move(k, to));
        },
      },
      label,
    );
  };

  const card = (r: Slot, k: number) => {
    const set = (nr: Slot) => onChange(slots.map((x, i) => (i === k ? nr : x)));
    const locked = k >= p.limits.rules;
    const blank = isBlank(r);
    const errs = errors.filter(
      (e) => e.path === `rules[${k}]` || e.path.startsWith(`rules[${k}].`),
    );
    const bad = new Set(errs.map((e) => e.path.slice(`rules[${k}]`.length)));
    // The draft keeps a rule with its piece pointing up. The strip shows it at `rot` quarter turns.
    const rot = r.turn ?? 0;
    const shown = {
      condition: turnPic(flat(r.condition), rot),
      change: turnPic(flat(r.change), rot),
    };
    const withTurn = (nr: Slot, q: number) => {
      if (q) nr.turn = q;
      else delete nr.turn;
      return nr;
    };
    /** Keep pictures shown at `q` quarter turns. First turn them back, so the piece points up. */
    const store = (condition: string[], change: string[], q: number) => {
      const back = (g: string[]) => rowsOf(turnPic(g, 4 - q));
      set(withTurn({ ...r, condition: back(condition), change: back(change) }, q));
    };
    const picture = (grid: 'condition' | 'change') => {
      const toks = shown[grid];
      const update = (i: number, tok: string) => {
        const g = { ...shown, [grid]: toks.map((x, j) => (j === i ? tok : x)) };
        // If the center gets a piece with a different direction, the rule turns to that direction.
        const c = grid === 'condition' && i === CENTER ? tileOf(tok) : null;
        const q = c && typeof c === 'object' && (c.d - rot) % period(c.s) !== 0 ? c.d : rot;
        store(g.condition, g.change, q);
      };
      return h(
        'div',
        { class: `pic ${grid}`, role: 'group', 'aria-label': grid },
        ...toks.map((t, i) => {
          const c = h('canvas');
          drawPictureTile(c, TILE, pictureTile(t, grid));
          // Errors give the tiles of the stored picture.
          const at = moved(i, 4 - rot);
          const path = `.${grid}[${(at / 3) | 0}][${at % 3}]`;
          // A turn changes only this tile. The arrows under the rule turn the full rule.
          const turn = (tool = brush.kind === 'turn') => {
            if (turned(t) !== t) update(i, turned(t));
            else if (grid === 'condition' && i === CENTER && typeof tileOf(t) === 'object')
              onHint(`${turnHint(t)} The arrows under the rule turn the rule.`);
            else if (tool) onHint(turnHint(t));
          };
          // A click paints with the current brush, and paints open over the same piece. A brush
          // that the player drops from the palette paints only.
          const apply = (b: Brush, click: boolean) => {
            if (b.kind === 'turn') return turn(true);
            const tok = paint(b, grid, i);
            if (typeof tok === 'object') return onHint(tok.error);
            if (click || tok !== t) update(i, click && tok === t ? '---' : tok);
          };
          return h(
            'button',
            {
              class: [i === CENTER ? 'tile center' : 'tile', bad.has(path) ? 'bad' : ''].join(' '),
              'data-k': `r${k}.${grid}.${i}`,
              disabled: locked,
              'aria-label': `rule ${k + 1} ${grid}, ${i === CENTER ? 'center' : `tile ${i + 1}`}: ${describe(t, grid)}`,
              title: describe(t, grid),
              'data-drop': true,
              onclick: () => apply(brush, true),
              onbrushdrop: (e: BrushDrop) => apply(e.detail.brush, false),
              oncontextmenu: (e: Event) => {
                e.preventDefault();
                turn();
              },
              onkeydown: (e: KeyboardEvent) => {
                if (e.key !== 'r' && e.key !== 'R') return;
                e.preventDefault();
                pendingFocus = `r${k}.${grid}.${i}`;
                turn();
              },
            },
            c,
          );
        }),
      );
    };
    const handle = h(
      'button',
      {
        class: 'handle',
        'data-k': `r${k}.handle`,
        disabled: locked,
        'aria-label': `rule ${k + 1}: drag, or press left and right to move`,
        onkeydown: (e: KeyboardEvent) => {
          const to = e.key === 'ArrowLeft' ? k - 1 : e.key === 'ArrowRight' ? k + 1 : -1;
          if (to < 0 || to >= usable) return;
          e.preventDefault();
          pendingFocus = `r${to}.handle`;
          onChange(move(k, to));
        },
        onpointerdown: (e: PointerEvent) => {
          handle.setPointerCapture(e.pointerId);
          const cards = [...el.querySelectorAll<HTMLElement>('.rule')];
          let to = k;
          const onMove = (ev: PointerEvent) => {
            const i = cards.findIndex((x) => ev.clientX < x.getBoundingClientRect().right);
            // A rule cannot go past the slots that the puzzle allows.
            to = Math.min(i < 0 ? cards.length - 1 : i, usable - 1);
            cards.forEach((x, j) => x.classList.toggle('drop', j === to && to !== k));
          };
          handle.addEventListener('pointermove', onMove);
          handle.addEventListener(
            'pointerup',
            () => {
              handle.removeEventListener('pointermove', onMove);
              cards.forEach((x) => x.classList.remove('drop'));
              if (to !== k) onChange(move(k, to));
            },
            { once: true },
          );
        },
      },
      String(k + 1),
    );
    // The conditions around the piece, against the limit of the puzzle. None, or no limit, shows no
    // count.
    const conds = p.limits.conds < Infinity ? condCount(r) : 0;
    // A piece that looks the same when turned tries the rule in each of those turns, in order.
    const turns = turnsOf(r);
    // Under the condition picture, arrows show the turns in order. A click turns the full rule, so
    // the piece tries the directions in a different order.
    const sym =
      turns > 1
        ? h('button', {
            class: 'sym',
            'data-k': `r${k}.sym`,
            disabled: locked,
            'aria-label': `${turnsLabel(turns, rot)}. Turn rule ${k + 1}`,
            title: 'turn the rule: change the order of the directions',
            onclick: () => set(withTurn({ ...r }, (rot + 1) % 4)),
            html: arrows(turns, rot),
          })
        : null;
    const del = h('button', {
      class: 'delete',
      'data-k': `r${k}.delete`,
      disabled: locked || (blank && !onAdd),
      'aria-label': `delete rule ${k + 1}`,
      onclick: () => (onAdd ? onChange(slots.filter((_, i) => i !== k)) : set(blankRule())),
      html: CROSS,
    });
    // Off disables a rule and keeps it as it is, until the player enables it again.
    const off = h('button', {
      class: r.off ? 'off-toggle on' : 'off-toggle',
      'data-k': `r${k}.off`,
      disabled: locked || blank,
      'aria-pressed': String(!!r.off),
      'aria-label': `${r.off ? 'turn on' : 'turn off'} rule ${k + 1}`,
      title: r.off ? 'turn this rule back on' : 'turn this rule off for now',
      onclick: () => set({ ...r, off: !r.off }),
      html: OFF,
    });
    const cls = [
      'rule',
      blank ? 'blank' : '',
      r.off && !blank ? 'off' : '',
      locked ? 'locked' : '',
      errs.length ? 'invalid' : '',
      used === k ? 'used' : '',
    ];
    return h(
      'li',
      { class: cls.join(' ') },
      h(
        'div',
        { class: 'rule-head' },
        handle,
        conds
          ? h(
              'span',
              {
                class: conds > p.limits.conds ? 'conds over' : 'conds',
                title: `${conds} of ${p.limits.conds} conditions`,
              },
              `${conds}/${p.limits.conds}`,
            )
          : null,
        h(
          'span',
          { class: 'row-actions' },
          shift(k, -1, '←', 'move rule left'),
          shift(k, 1, '→', 'move rule right'),
        ),
      ),
      h(
        'div',
        { class: 'pics' },
        picture('condition'),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
        picture('change'),
        // An invalid rule shows its first error at the bottom left, in place of the arrows.
        errs.length ? null : sym,
        h(
          'div',
          { class: sym && !errs.length ? 'foot' : 'foot wide' },
          errs.length ? h('span', { class: 'err' }, ruleProblem(errs[0].message)) : null,
          off,
          del,
        ),
      ),
    );
  };

  const add =
    onAdd &&
    h(
      'li',
      { class: 'add' },
      h(
        'button',
        { 'data-k': 'add', 'aria-label': 'add a rule', title: 'add a rule', onclick: onAdd },
        '+',
      ),
    );
  const row = h('ol', { class: 'rule-row' }, ...slots.map(card), add);
  // A vertical wheel or a drag scrolls the strip. The handle of a card moves the card instead.
  sideScroll(row, (t) => !!t.closest('.handle'), old);
  // On a phone, a tap on a card that is partly out of view only centers the card.
  const phone = isPhone();
  if (phone)
    row.addEventListener(
      'click',
      (e) => {
        const c = e.target instanceof Element && e.target.closest('.rule');
        if (!c || inView(c, row)) return;
        e.preventDefault();
        e.stopPropagation();
        reveal(c, 'center');
      },
      true,
    );
  // A triangle at each end scrolls the strip by one card. On a desktop, the next card moves to the
  // start. On a phone, it moves to the center. A triangle is pale at that end of the strip.
  const arrow = (dir: -1 | 1) =>
    h('button', {
      class: `strip-arrow ${dir < 0 ? 'prev' : 'next'}`,
      'aria-label': dir < 0 ? 'scroll rules left' : 'scroll rules right',
      title: dir < 0 ? 'earlier rules' : 'later rules',
      onclick: () => {
        const v = row.getBoundingClientRect();
        const edge = v.left + parseFloat(getComputedStyle(row).paddingLeft);
        const at = (c: Element) => {
          const r = c.getBoundingClientRect();
          return phone ? r.left + r.width / 2 - (v.left + v.width / 2) : r.left - edge;
        };
        const cards = [...row.querySelectorAll('.rule')];
        // A card that snapped into place can be a few pixels off. Skip it, not the next card.
        const to = dir > 0 ? cards.find((c) => at(c) > 16) : cards.findLast((c) => at(c) < -16);
        if (to) reveal(to, phone ? 'center' : 'start');
      },
      html: triangle(dir),
    });
  const prevB = arrow(-1);
  const nextB = arrow(1);
  const ends = () => {
    prevB.disabled = row.scrollLeft <= 1;
    nextB.disabled = row.scrollLeft >= row.scrollWidth - row.clientWidth - 1;
  };
  row.addEventListener('scroll', ends, { passive: true });
  el.replaceChildren(prevB, row, nextB);
  row.scrollLeft = scroll;
  ends();
  // Focus goes to the moved or painted control, but the strip keeps its scroll position.
  if (focused)
    el.querySelector<HTMLElement>(`[data-k="${focused}"]`)?.focus({ preventScroll: true });
}
