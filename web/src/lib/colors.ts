import { COLOR_NAMES } from '@bauplan/engine';
import { settings } from './store.ts';

/** For color vision deficiency (CVD), blue, red, and yellow show as purple, orange, and teal. */
const CVD_NAMES: Record<string, string> = { b: 'purple', r: 'orange', y: 'teal' };

/** The name of color letter c, as the pieces show it. */
export const colorName = (c: string) => (settings().cvd ? CVD_NAMES : COLOR_NAMES)[c];

/** Use the colors of the settings: data-cvd on the page sets --blue, --red, and --yellow. */
export const applyColors = () =>
  document.documentElement.toggleAttribute('data-cvd', settings().cvd);
