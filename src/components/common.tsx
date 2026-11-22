import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { META, type MidiFile } from '../midi/types';

// 16 channel colours, chosen to stay distinct on both light and dark backgrounds.
export const CHANNEL_COLORS = [
  '#e6550d', '#3182bd', '#31a354', '#9467bd', '#d62728', '#17becf', '#bcbd22', '#e377c2',
  '#8c564b', '#7f7f7f', '#fd8d3c', '#6baed6', '#74c476', '#c5b0d5', '#ff9896', '#9edae5',
];
export const HAND_COLORS = { R: '#e6550d', L: '#3182bd' } as const;

export const ChannelBaseContext = createContext<0 | 1>(0);

export function useChannelLabel() {
  const base = useContext(ChannelBaseContext);
  return (c: number) => String(c + base);
}

export function ChannelSelect({ value, onChange, allowNone, noneLabel = '—' }: {
  value: number | null;
  onChange: (c: number | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const label = useChannelLabel();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">{noneLabel}</option>}
      {Array.from({ length: 16 }, (_, c) => (
        <option key={c} value={c}>
          Ch {label(c)}
          {c === 9 ? ' (drums)' : ''}
        </option>
      ))}
    </select>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}

export function firstTimeSig(file: MidiFile): [number, number] {
  for (const t of file.tracks)
    for (const e of t.events)
      if (e.kind === 'meta' && e.metaType === META.timeSignature && e.data.length >= 2) return [e.data[0], 2 ** e.data[1]];
  return [4, 4];
}

/** Bar:beat display (1-based) using the first time signature. */
export function formatBarBeat(tick: number, tpb: number, sig: [number, number]): string {
  const beatTicks = (tpb * 4) / sig[1];
  const barTicks = beatTicks * sig[0];
  const bar = Math.floor(tick / barTicks) + 1;
  const beat = (tick % barTicks) / beatTicks + 1;
  return `${bar}:${Number.isInteger(beat) ? beat : beat.toFixed(2)}`;
}

/** Text input that commits on blur or Enter, so every keystroke is not an undo step. */
export function CommitInput({ value, onCommit, className, placeholder, validate }: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  validate?: (v: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const bad = validate ? !validate(draft) : false;
  const commit = () => {
    if (draft !== value && !bad) onCommit(draft);
    else if (bad) setDraft(value);
  };
  return (
    <input
      className={`${className ?? ''} ${bad ? 'invalid' : ''}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>{title}</h3>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Two-step button for actions that cannot be undone (browser confirm() dialogs are not always available). */
export function ConfirmButton({ children, confirmLabel, onConfirm, className, disabled }: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${className ?? ''} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
