import { useMemo, useState } from 'react';
import { metaName, TEXT_META_TYPES } from '../midi/types';
import type { LibFile, Library } from '../state/library';
import { applyBatch, buildMatcher, type BatchOp, type BatchTarget } from '../transforms/batch';
import { Section } from './common';

const TARGETS: { t: BatchTarget; label: string }[] = [
  { t: 'filename', label: 'Filename' },
  ...TEXT_META_TYPES.map((t) => ({ t, label: metaName(t) })),
];

export function BatchPanel({ files, lib }: { files: LibFile[]; lib: Library }) {
  const [op, setOp] = useState<BatchOp>({
    targets: ['filename', 3], find: '', replace: '', mode: 'replace', regex: false, caseSensitive: false, keepExtension: true,
  });
  const set = (p: Partial<BatchOp>) => setOp((o) => ({ ...o, ...p }));
  const toggle = (t: BatchTarget) => set({ targets: op.targets.includes(t) ? op.targets.filter((x) => x !== t) : [...op.targets, t] });

  const badRegex = op.regex && op.find !== '' && !buildMatcher(op);
  const active = op.find !== '' || op.mode === 'delete';
  const results = useMemo(
    () => (active && !badRegex ? files.map((f) => ({ f, r: applyBatch({ name: f.name, midi: f.midi }, op) })) : []),
    [files, op, active, badRegex],
  );
  const total = results.reduce((a, x) => a + x.r.changes.length, 0);
  const touched = results.filter((x) => x.r.changes.length);

  return (
    <div className="stack">
      <Section title={`Batch find, replace and delete · ${files.length} file${files.length === 1 ? '' : 's'}`}>
        <p className="muted small">
          Works on the files ticked in the library (or the open file if none are ticked). Every change can be undone per file.
        </p>
        <div className="targets">
          {TARGETS.map(({ t, label }) => (
            <label key={String(t)} className="check">
              <input type="checkbox" checked={op.targets.includes(t)} onChange={() => toggle(t)} /> {label}
            </label>
          ))}
        </div>
        <div className="row">
          <label className="check"><input type="radio" checked={op.mode === 'replace'} onChange={() => set({ mode: 'replace' })} /> Find &amp; replace</label>
          <label className="check"><input type="radio" checked={op.mode === 'delete'} onChange={() => set({ mode: 'delete' })} /> Delete matching events</label>
        </div>
        <div className="row">
          <input className={`wide ${badRegex ? 'invalid' : ''}`} placeholder={op.mode === 'delete' ? 'Match (empty = delete all of the ticked types)' : 'Find'} value={op.find} onChange={(e) => set({ find: e.target.value })} />
          {op.mode === 'replace' && (
            <input className="wide" placeholder="Replace with (empty = remove the matched text)" value={op.replace} onChange={(e) => set({ replace: e.target.value })} />
          )}
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={op.regex} onChange={(e) => set({ regex: e.target.checked })} /> Regular expression</label>
          <label className="check"><input type="checkbox" checked={op.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} /> Match case</label>
          <label className="check"><input type="checkbox" checked={op.keepExtension} onChange={(e) => set({ keepExtension: e.target.checked })} /> Keep .mid extension</label>
          {op.regex && <span className="muted small">Use $1, $2 for groups. ^ adds a prefix, $ a suffix.</span>}
          {op.mode === 'delete' && op.targets.includes('filename') && <span className="muted small">Filenames are skipped in delete mode.</span>}
        </div>
        <div className="row">
          <button
            className="btn primary" disabled={!total}
            onClick={() => {
              lib.update(touched.map((x) => x.f.id), op.mode === 'delete' ? 'Batch delete' : 'Batch replace', (f) => applyBatch(f, op));
            }}
          >
            Apply {total} change{total === 1 ? '' : 's'} in {touched.length} file{touched.length === 1 ? '' : 's'}
          </button>
          {badRegex && <span className="warn small">Invalid regular expression.</span>}
        </div>
      </Section>

      {active && (
        <Section title="Preview">
          {!total && <p className="muted">Nothing matches.</p>}
          {touched.map(({ f, r }) => (
            <details key={f.id} open={touched.length <= 5}>
              <summary><strong>{f.name}</strong> <span className="muted">· {r.changes.length} change{r.changes.length === 1 ? '' : 's'}</span></summary>
              <table className="grid">
                <tbody>
                  {r.changes.slice(0, 200).map((c, i) => (
                    <tr key={i}>
                      <td className="nowrap small">{c.target}{c.track !== undefined && ` · track ${c.track}`}</td>
                      <td className="before">{c.before}</td>
                      <td>→</td>
                      <td className="after">{c.after ?? <em className="muted">deleted</em>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.changes.length > 200 && <p className="muted small">…and {r.changes.length - 200} more.</p>}
            </details>
          ))}
        </Section>
      )}
    </div>
  );
}
