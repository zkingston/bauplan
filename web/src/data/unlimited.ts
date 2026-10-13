import type { Rule } from '@bauplan/engine';
import sunGun from './unlimited/sun-gun.json';
import shimmer from './unlimited/shimmer.json';

/**
 * An example of Unlimited: its rules, and its start board as rows of tile tokens with the top left
 * tile at (x, y). The view first shows the box of tiles from (x0, y0) to (x1, y1).
 */
export interface Example {
  title: string;
  about: string;
  rules: Rule[];
  x: number;
  y: number;
  start: string[];
  view: number[];
}

/** The examples in the help of Unlimited, in order. Each is a file in ./unlimited. */
export default [sunGun, shimmer] as Example[];
