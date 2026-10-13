import order from './levels.json';

const files = import.meta.glob<unknown>('./puzzles/*.json', { eager: true, import: 'default' });

/** The levels in play order. levels.json lists the files in ./puzzles by name, in that order. */
export default order.map((name) => files[`./puzzles/${name}.json`]);

/** The name of each level, in play order: a link to a level uses it, so the order can change. */
export const names: string[] = order;
