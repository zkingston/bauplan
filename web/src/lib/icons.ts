import { h } from './dom.ts';

/** SVG icons as markup for the `html` key of `h`. */

/** A solid triangle that points back (-1) or forward (1), as on the previous and next buttons. */
export const triangle = (dir: -1 | 1) =>
  `<svg viewBox="0 0 9 10" aria-hidden="true"><path d="${dir < 0 ? 'M9 0L0 5L9 10Z' : 'M0 0L9 5L0 10Z'}"/></svg>`;

// A symmetric piece tries a rule in these turns, in order: as shown, turned around, right, left.
// A rule that is shown at `rot` quarter turns also turns its arrows by `rot` quarters.
const ARROW = '<path d="M5 9V1.5M1.5 5L5 1.5L8.5 5"/>';
export const tries = (turns: number, rot: number) =>
  [0, 2, 1, 3].slice(0, turns).map((d) => (d + rot) % 4);
/** The arrows under a symmetric rule: one for each turn that the piece tries, in order. */
export const arrows = (turns: number, rot: number) =>
  `<svg viewBox="0 0 ${turns * 14 - 4} 10" width="${turns * 14 - 4}" height="10" aria-hidden="true">${tries(
    turns,
    rot,
  )
    .map((d, n) => `<g transform="translate(${n * 14} 0) rotate(${d * 90} 5 5)">${ARROW}</g>`)
    .join('')}</svg>`;

/** A solid triangle that points down. It shows that more of a page is below. */
export const DOWN = '<svg viewBox="0 0 10 7" aria-hidden="true"><path d="M0 0H10L5 7Z"/></svg>';

/** A clockwise quarter-turn arrow for the turn tile of the palette. */
export const TURN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5A7.5 7.5 0 1 1 4.5 12" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M4.5 7L1 12.5H8Z" fill="currentColor"/></svg>';

/** Four arrows out from the middle. The pan tool of Unlimited moves the board. */
export const PAN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V20M4 12H20" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 1L7.5 6H16.5ZM12 23L7.5 18H16.5ZM1 12L6 7.5V16.5ZM23 12L18 7.5V16.5Z" fill="currentColor"/></svg>';

/** A circle with a line through it. It turns a rule off. */
export const OFF =
  '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4"/><path d="M2.2 7.8L7.8 2.2"/></svg>';
export const CROSS =
  '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"/></svg>';

/** The transport icons in a 16-unit box. They use the board shapes: triangles, bars, and an arc. */
const TRANSPORT = {
  reset: '<path class="stroke" d="M3 9A5 5 0 1 0 8 4"/><path d="M5 4L9 1V7Z"/>',
  back: '<path d="M3 3H5V13H3ZM13 3V13L5 8Z"/>',
  play: '<path d="M4 3L13 8L4 13Z"/>',
  pause: '<path d="M4 3H7V13H4ZM9 3H12V13H9Z"/>',
  step: '<path d="M3 3L11 8L3 13ZM11 3H13V13H11Z"/>',
};
export type Glyph = keyof typeof TRANSPORT;
export const glyph = (k: Glyph) =>
  `<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">${TRANSPORT[k]}</svg>`;
/** A transport button: its glyph, and its name as the label and the tooltip. */
export const glyphButton = (icon: Glyph, aria: string, onclick: () => void) =>
  h('button', { 'aria-label': aria, title: aria, onclick, html: glyph(icon), 'data-glyph': icon });

/**
 * Show a glyph and a name on a transport button. The glyph is drawn again only when it changes: a
 * new glyph under a press that is not over loses the click, as at a fast speed of play.
 */
export function setGlyph(b: HTMLElement, icon: Glyph, aria: string = icon) {
  if (b.dataset.glyph !== icon) {
    b.dataset.glyph = icon;
    b.innerHTML = glyph(icon);
  }
  b.setAttribute('aria-label', aria);
  b.title = aria;
}

/**
 * The speed dial: an arc with a mark at the angle of each speed, and a needle at the current speed.
 */
export function gauge(marks: number[], needle: number) {
  const tick = (deg: number, cls: string, y1: number, y2: number) =>
    `<line class="${cls}" y1="${y1}" y2="${y2}" transform="rotate(${deg})"/>`;
  return `<svg viewBox="-12 -10 24 14" aria-hidden="true"><g transform="translate(0 3)">
      <path d="M-10 0A10 10 0 0 1 10 0"/>${marks.map((a) => tick(a, 'mark', -10, -7)).join('')}
      ${tick(needle, 'needle', 0, -8)}<circle class="pivot" r="1.6"/></g></svg>`;
}
