import { useCallback, useEffect, useRef, useState } from 'react';
import { parseMidi } from '../midi/parse';
import { writeMidi } from '../midi/write';
import type { MidiFile } from '../midi/types';
import * as storage from './storage';

export interface Snapshot {
  name: string;
  midi: MidiFile;
  label: string;
}

export interface LibFile {
  id: string;
  name: string;
  midi: MidiFile;
  original: Uint8Array;
  addedAt: number;
  /** Earlier states, most recent last. */
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
}

const HISTORY_LIMIT = 50;
let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export interface LoadError {
  name: string;
  message: string;
}

export function useLibrary() {
  const [files, setFiles] = useState<LibFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    storage.loadAll().then((stored) => {
      const restored: LibFile[] = [];
      for (const s of stored) {
        try {
          restored.push({
            id: s.id, name: s.name, midi: parseMidi(s.bytes), original: s.original, addedAt: s.addedAt,
            past: [], future: [], dirty: s.dirty ?? !bytesEqual(s.bytes, s.original),
          });
        } catch {
          /* skip corrupt entries */
        }
      }
      setFiles((cur) => [...restored, ...cur]);
      setLoaded(true);
    });
  }, []);

  const persist = useCallback((f: LibFile) => {
    const t = pending.current.get(f.id);
    if (t) clearTimeout(t);
    pending.current.set(
      f.id,
      setTimeout(() => {
        pending.current.delete(f.id);
        storage.save({ id: f.id, name: f.name, bytes: writeMidi(f.midi), original: f.original, addedAt: f.addedAt, dirty: f.dirty });
      }, 400),
    );
  }, []);

  const addMidi = useCallback(
    (name: string, midi: MidiFile, original?: Uint8Array): LibFile => {
      const f: LibFile = {
        id: newId(), name, midi, original: original ?? writeMidi(midi), addedAt: Date.now(),
        past: [], future: [], dirty: false,
      };
      setFiles((cur) => [...cur, f]);
      persist(f);
      return f;
    },
    [persist],
  );

  const addFiles = useCallback(
    async (list: File[]): Promise<{ added: LibFile[]; errors: LoadError[] }> => {
      const added: LibFile[] = [];
      const errors: LoadError[] = [];
      for (const file of list) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          added.push(addMidi(file.name, parseMidi(bytes), bytes));
        } catch (e) {
          errors.push({ name: file.name, message: (e as Error).message });
        }
      }
      return { added, errors };
    },
    [addMidi],
  );

  /** Applies a change to one or more files as an undoable step. */
  const update = useCallback(
    (ids: string[], label: string, fn: (f: { name: string; midi: MidiFile }) => { name: string; midi: MidiFile }) => {
      setFiles((cur) =>
        cur.map((f) => {
          if (!ids.includes(f.id)) return f;
          const next = fn({ name: f.name, midi: f.midi });
          if (next.midi === f.midi && next.name === f.name) return f;
          const nf: LibFile = {
            ...f, name: next.name, midi: next.midi, dirty: true,
            past: [...f.past, { name: f.name, midi: f.midi, label }].slice(-HISTORY_LIMIT),
            future: [],
          };
          persist(nf);
          return nf;
        }),
      );
    },
    [persist],
  );

  const step = useCallback(
    (id: string, dir: 'undo' | 'redo') => {
      setFiles((cur) =>
        cur.map((f) => {
          if (f.id !== id) return f;
          const from = dir === 'undo' ? f.past : f.future;
          if (!from.length) return f;
          const snap = from[from.length - 1];
          const here: Snapshot = { name: f.name, midi: f.midi, label: snap.label };
          const nf: LibFile = {
            ...f, name: snap.name, midi: snap.midi,
            past: dir === 'undo' ? f.past.slice(0, -1) : [...f.past, here],
            future: dir === 'undo' ? [...f.future, here] : f.future.slice(0, -1),
          };
          persist(nf);
          return nf;
        }),
      );
    },
    [persist],
  );

  const revert = useCallback(
    (id: string) => update([id], 'Revert to original', (f) => ({ ...f, midi: parseMidi(files.find((x) => x.id === id)!.original) })),
    [update, files],
  );

  const duplicate = useCallback(
    (id: string): LibFile | undefined => {
      const f = files.find((x) => x.id === id);
      if (!f) return;
      const name = f.name.replace(/(\.[^.]*)?$/, (ext) => ` copy${ext}`);
      return addMidi(name, structuredClone(f.midi), writeMidi(f.midi));
    },
    [files, addMidi],
  );

  const removeFiles = useCallback((ids: string[]) => {
    setFiles((cur) => cur.filter((f) => !ids.includes(f.id)));
    ids.forEach((id) => storage.remove(id));
  }, []);

  const rename = useCallback(
    (id: string, name: string) => update([id], 'Rename', (f) => ({ ...f, name })),
    [update],
  );

  return { files, loaded, addFiles, addMidi, update, undo: (id: string) => step(id, 'undo'), redo: (id: string) => step(id, 'redo'), revert, duplicate, removeFiles, rename };
}

export type Library = ReturnType<typeof useLibrary>;

function bytesEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
