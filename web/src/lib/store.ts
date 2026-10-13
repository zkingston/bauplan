import { isObj, parsePuzzle, puzzleId, type Rule } from '@bauplan/engine';
import type { Slot } from '../components/ruleStrip.ts';

// The store keeps data in localStorage under versioned keys. A copy in memory continues to work
// if storage fails.
const PREFIX = 'bauplan.v1.';
const mem = new Map<string, string>();
let persistent = (() => {
  try {
    localStorage.setItem(PREFIX + 'probe', '1');
    localStorage.removeItem(PREFIX + 'probe');
    return true;
  } catch {
    return false;
  }
})();

export const storageOk = () => persistent;

function load(key: string): unknown {
  let raw = mem.get(key) ?? null;
  if (raw === null && persistent) {
    try {
      raw = localStorage.getItem(PREFIX + key);
    } catch {
      raw = null;
    }
  }
  try {
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function save(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  mem.set(key, raw);
  if (!persistent) return;
  try {
    localStorage.setItem(PREFIX + key, raw);
  } catch {
    persistent = false;
    document.dispatchEvent(new Event('bauplan:storagefail'));
  }
}

export interface Best {
  rules: number;
  conds: number;
  steps: number;
}

export function progress(): Record<string, Best> {
  const all = load('progress');
  return isObj(all) ? (all as Record<string, Best>) : {};
}

/** Keep the best value of each metric separately. */
export function recordWin(id: string, m: Best) {
  const all = progress();
  const b = all[id];
  all[id] = b
    ? {
        rules: Math.min(b.rules, m.rules),
        conds: Math.min(b.conds, m.conds),
        steps: Math.min(b.steps, m.steps),
      }
    : m;
  save('progress', all);
}

const isRows = (x: unknown) =>
  Array.isArray(x) && x.length === 3 && x.every((r) => typeof r === 'string');
const isRule = (r: unknown): r is Slot =>
  isObj(r) &&
  isRows(r.condition) &&
  isRows(r.change) &&
  (r.turn === undefined || [0, 1, 2, 3].includes(r.turn as number)) &&
  (r.off === undefined || typeof r.off === 'boolean');

export function loadRules(id: string): Rule[] | undefined {
  const d = load(`rules.${id}`);
  return Array.isArray(d) && d.every(isRule) ? d : undefined;
}

export const saveRules = (id: string, rules: Rule[]) => save(`rules.${id}`, rules);

export interface CustomEntry {
  puzzle: Record<string, unknown>;
  /** A "link" puzzle came from a share link. It is not verified. */
  source: 'saved' | 'link';
}

export function loadCustom(): CustomEntry[] {
  const c = load('custom');
  return Array.isArray(c) ? c.filter((e) => isObj(e) && isObj(e.puzzle)) : [];
}

export const saveCustom = (list: CustomEntry[]) => save('custom', list);

/** The index of puzzle `id` in Custom, or -1. */
export const findCustom = (id: string) =>
  loadCustom().findIndex((e) => {
    const q = parsePuzzle(e.puzzle);
    return !Array.isArray(q) && puzzleId(q) === id;
  });

export interface EditorState {
  puzzle: Record<string, unknown>;
  verified: boolean;
}

export function loadEditor(): EditorState | undefined {
  const e = load('editor');
  return isObj(e) && isObj(e.puzzle)
    ? { puzzle: e.puzzle, verified: e.verified === true }
    : undefined;
}

export const saveEditor = (s: EditorState) => save('editor', s);

/** The Unlimited screen: its rule slots, its start board (from `Plane.save`), and its camera. */
export interface UnlimitedState {
  slots: Slot[];
  board?: { nodes: number[] };
  cam?: { x: number; y: number; z: number };
}

/** An Unlimited state from storage or a link. A part with the wrong form is left out. */
export function parseUnlimited(u: unknown): UnlimitedState {
  if (!isObj(u)) return { slots: [] };
  const nums = (x: unknown): x is number[] =>
    Array.isArray(x) && x.every((v) => Number.isFinite(v));
  const cam = u.cam;
  return {
    slots: Array.isArray(u.slots) ? u.slots.filter(isRule) : [],
    board: isObj(u.board) && nums(u.board.nodes) ? { nodes: u.board.nodes } : undefined,
    cam:
      isObj(cam) && nums([cam.x, cam.y, cam.z]) && (cam.z as number) > 0
        ? { x: cam.x as number, y: cam.y as number, z: cam.z as number }
        : undefined,
  };
}

export const loadUnlimited = () => parseUnlimited(load('unlimited'));
export const saveUnlimited = (s: UnlimitedState) => save('unlimited', s);

export interface Settings {
  /** Colors for color vision deficiency in place of blue, red, and yellow. */
  cvd: boolean;
}

let settingsNow: Settings | undefined;
export function settings(): Settings {
  const s = load('settings');
  return (settingsNow ??= { cvd: isObj(s) && s.cvd === true });
}
export function saveSettings(s: Settings) {
  settingsNow = s;
  save('settings', s);
}

/** The keys of the data in a progress file. */
const KEYS = /^(progress|custom|editor|unlimited|settings|rules\.[0-9a-f]{16})$/;

function remove(key: string) {
  mem.delete(key);
  if (!persistent) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // The copy in memory is gone, which is enough.
  }
}

/** All of the data, by key: progress, rules, Custom, the editor draft, Unlimited, and settings. */
export function exportData(): Record<string, unknown> {
  const keys = new Set(mem.keys());
  if (persistent)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.add(k.slice(PREFIX.length));
    }
  return Object.fromEntries(
    [...keys]
      .filter((k) => KEYS.test(k))
      .sort()
      .map((k) => [k, load(k)]),
  );
}

/** Replace all of the data with the data of a progress file. Keys that it does not know are left out. */
export function importData(data: Record<string, unknown>) {
  for (const k of Object.keys(exportData())) remove(k);
  for (const [k, v] of Object.entries(data)) if (KEYS.test(k)) save(k, v);
  settingsNow = undefined;
}
