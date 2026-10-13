import { h } from '../lib/dom.ts';
import { CROSS } from '../lib/icons.ts';

/**
 * A button that asks for a second click. The first click shows `note` above the button, in the
 * style of the hint, and a second click calls `onConfirm`. A click elsewhere, or 4 s, cancels.
 * `key` is the data-k of the button. `onArm` runs at the first click. `off` removes the listener
 * for clicks elsewhere.
 */
export function confirmButton(
  o: { key: string; note: string; aria: string; onArm?: () => void; onConfirm: () => void },
  ...kids: Node[]
) {
  const box = h('div', { class: 'hint-box', role: 'status', hidden: true }, o.note);
  let armed: number | undefined;
  function disarm() {
    window.clearTimeout(armed);
    armed = undefined;
    box.hidden = true;
    button.classList.remove('on');
  }
  const button = h(
    'button',
    {
      'data-k': o.key,
      'aria-label': o.aria,
      title: o.aria,
      onclick: () => {
        if (armed !== undefined) {
          disarm();
          return o.onConfirm();
        }
        o.onArm?.();
        box.hidden = false;
        button.classList.add('on');
        armed = window.setTimeout(disarm, 4000);
      },
    },
    ...kids,
  );
  const outside = (e: Event) =>
    armed !== undefined && !button.contains(e.target as Node) && disarm();
  document.addEventListener('pointerdown', outside, true);
  return {
    el: h('span', { class: 'confirm' }, box, button),
    button,
    disarm,
    off: () => {
      disarm();
      document.removeEventListener('pointerdown', outside, true);
    },
  };
}

/** RESET of Play and Unlimited: it clears all the rules, after a second click. */
export const resetRulesButton = (onArm: () => void, onConfirm: () => void) =>
  confirmButton(
    {
      key: 'clear',
      note: 'Click again to reset all rules.',
      aria: 'reset all rules',
      onArm,
      onConfirm,
    },
    h('span', { class: 'long' }, 'RESET'),
    h('span', { class: 'short', 'aria-hidden': 'true', html: CROSS }),
  );
