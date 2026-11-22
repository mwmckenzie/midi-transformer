import { decodeText, encodeText } from '../midi/meta';
import { isTextMeta, metaName, type MidiFile } from '../midi/types';

/** 'filename' or a text meta type number (1 = text, 3 = track name, ...). */
export type BatchTarget = 'filename' | number;

export interface BatchOp {
  targets: BatchTarget[];
  find: string;
  replace: string;
  /** replace: substitute matches. delete: remove whole meta events whose text matches. */
  mode: 'replace' | 'delete';
  regex: boolean;
  caseSensitive: boolean;
  /** For filenames: leave the .mid extension alone. */
  keepExtension: boolean;
}

export interface BatchChange {
  target: string;
  track?: number;
  tick?: number;
  before: string;
  /** null = deleted */
  after: string | null;
}

export interface BatchInput {
  name: string;
  midi: MidiFile;
}

export interface BatchResult {
  name: string;
  midi: MidiFile;
  changes: BatchChange[];
}

export function buildMatcher(op: BatchOp): RegExp | null {
  const flags = op.caseSensitive ? 'g' : 'gi';
  try {
    if (op.regex) return new RegExp(op.find, flags);
    if (!op.find) return op.mode === 'delete' ? /^[\s\S]*$/ : null; // empty find + delete = delete all
    return new RegExp(op.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    return null;
  }
}

function splitExt(name: string): [string, string] {
  const m = /^(.*?)(\.(mid|midi|kar|rmi|smf))$/i.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}

export function applyBatch(input: BatchInput, op: BatchOp): BatchResult {
  const re = buildMatcher(op);
  const changes: BatchChange[] = [];
  if (!re) return { ...input, changes };
  const test = (s: string) => {
    re.lastIndex = 0;
    return re.test(s);
  };
  const sub = (s: string) => {
    re.lastIndex = 0;
    return s.replace(re, op.replace);
  };

  let name = input.name;
  if (op.targets.includes('filename') && op.mode === 'replace') {
    const [base, ext] = op.keepExtension ? splitExt(name) : [name, ''];
    const next = sub(base) + ext;
    if (next !== name && next.trim()) {
      changes.push({ target: 'Filename', before: name, after: next });
      name = next;
    }
  }

  const metaTargets = op.targets.filter((t): t is number => typeof t === 'number' && isTextMeta(t));
  let midi = input.midi;
  if (metaTargets.length) {
    midi = {
      ...midi,
      tracks: midi.tracks.map((t, ti) => {
        let touched = false;
        const events = [];
        for (const e of t.events) {
          if (e.kind === 'meta' && metaTargets.includes(e.metaType)) {
            const text = decodeText(e.data);
            if (op.mode === 'delete') {
              if (test(text)) {
                changes.push({ target: metaName(e.metaType), track: ti, tick: e.tick, before: text, after: null });
                touched = true;
                continue;
              }
            } else {
              const next = sub(text);
              if (next !== text) {
                changes.push({ target: metaName(e.metaType), track: ti, tick: e.tick, before: text, after: next });
                events.push({ ...e, data: encodeText(next) });
                touched = true;
                continue;
              }
            }
          }
          events.push(e);
        }
        return touched ? { events } : t;
      }),
    };
  }
  return { name, midi, changes };
}
