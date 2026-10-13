import { rule as R, type Rule } from '../src/index.ts';
import frame from './frame.json' with { type: 'json' };

export { R };

/** Grow a piece into the tile ahead. This fails at the edge or if that tile is not empty. */
export const copy = (center: string, child: string) => R(center, '---', {}, { 1: child });

/**
 * Frame: a quarter-circle head moves around a block of obstacles, with one action for each rule.
 * It copies itself ahead. When its copy is ahead, it cuts itself to a triangle. When it is blocked
 * and has room on its left, it turns left. At the end, it is blocked with no room and stops.
 */
export const FRAME = frame;
export const FRAME_RULES: Rule[] = frame.solution;
