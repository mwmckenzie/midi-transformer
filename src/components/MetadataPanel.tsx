import { useMemo, useState } from 'react';
import {
  bpmToTempoData, encodeText, metaDisplayValue, parseKeySignature, parseTimeSignature, tempoToBpm,
} from '../midi/meta';
import { isTextMeta, META, metaName, TEXT_META_TYPES, ticksPerBeat, type MetaEvent, type MidiEvent, type MidiFile } from '../midi/types';
import type { LibFile, Library } from '../state/library';
import { CommitInput, Section, firstTimeSig, formatBarBeat } from './common';

interface Row {
  track: number;
  index: number;
  e: MetaEvent;
}

const ADDABLE = [...TEXT_META_TYPES, META.tempo, META.timeSignature, META.keySignature];

export function MetadataPanel({ file, lib }: { file: LibFile; lib: Library }) {
  const m = file.midi;
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [showEot, setShowEot] = useState(false);
  const tpb = ticksPerBeat(m);
  const sig = firstTimeSig(m);

  const rows = useMemo(() => {
    const out: Row[] = [];
    m.tracks.forEach((t, track) =>
      t.events.forEach((e, index) => {
        if (e.kind !== 'meta') return;
        if (e.metaType === META.endOfTrack && !showEot) return;
        out.push({ track, index, e });
      }),
    );
    return out;
  }, [m, showEot]);

  const present = useMemo(() => [...new Set(rows.map((r) => r.e.metaType))].sort((a, b) => a - b), [rows]);
  const visible = rows.filter(
    (r) =>
      (typeFilter === 'all' || r.e.metaType === typeFilter) &&
      (!query || metaDisplayValue(r.e).toLowerCase().includes(query.toLowerCase())),
  );

  const edit = (label: string, fn: (midi: MidiFile) => MidiFile) => lib.update([file.id], label, (f) => ({ ...f, midi: fn(f.midi) }));

  const replaceEvent = (r: Row, next: MidiEvent | null, label: string) =>
    edit(label, (midi) => ({
      ...midi,
      tracks: midi.tracks.map((t, ti) =>
        ti !== r.track
          ? t
          : { events: next ? t.events.map((e, i) => (i === r.index ? next : e)) : t.events.filter((_, i) => i !== r.index) },
      ),
    }));

  return (
    <div className="stack">
      <Section
        title={`Metadata events (${visible.length}${visible.length !== rows.length ? ` of ${rows.length}` : ''})`}
        actions={
          <>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All types</option>
              {present.map((t) => (
                <option key={t} value={t}>{metaName(t)}</option>
              ))}
            </select>
            <input placeholder="Filter values…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="check"><input type="checkbox" checked={showEot} onChange={(e) => setShowEot(e.target.checked)} /> End-of-track</label>
          </>
        }
      >
        <table className="grid">
          <thead>
            <tr><th>Track</th><th>Position</th><th>Type</th><th style={{ width: '50%' }}>Value</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={`${r.track}:${r.index}`}>
                <td>{r.track}</td>
                <td className="nowrap">
                  <CommitInput
                    className="tick"
                    value={String(r.e.tick)}
                    validate={(v) => /^\d+$/.test(v)}
                    onCommit={(v) => replaceEvent(r, { ...r.e, tick: Number(v) }, 'Move metadata event')}
                  />
                  <span className="muted small"> {formatBarBeat(r.e.tick, tpb, sig)}</span>
                </td>
                <td>
                  {isTextMeta(r.e.metaType) ? (
                    <select
                      value={r.e.metaType}
                      onChange={(ev) => replaceEvent(r, { ...r.e, metaType: Number(ev.target.value) }, 'Change metadata type')}
                    >
                      {TEXT_META_TYPES.map((t) => (
                        <option key={t} value={t}>{metaName(t)}</option>
                      ))}
                    </select>
                  ) : (
                    metaName(r.e.metaType)
                  )}
                </td>
                <td>
                  <ValueEditor e={r.e} onChange={(data) => replaceEvent(r, { ...r.e, data }, `Edit ${metaName(r.e.metaType)}`)} />
                </td>
                <td>
                  {r.e.metaType !== META.endOfTrack && (
                    <button className="btn icon" title="Delete event" onClick={() => replaceEvent(r, null, `Delete ${metaName(r.e.metaType)}`)}>✕</button>
                  )}
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={5} className="muted">No metadata events match.</td></tr>
            )}
          </tbody>
        </table>
      </Section>
      <AddEvent file={m} onAdd={(track, e) => edit(`Add ${metaName(e.metaType)}`, (midi) => insertEvent(midi, track, e))} />
    </div>
  );
}

function ValueEditor({ e, onChange }: { e: MetaEvent; onChange: (d: Uint8Array) => void }) {
  if (isTextMeta(e.metaType) || (e.metaType >= 0x0a && e.metaType <= 0x0f))
    return <CommitInput className="wide" value={metaDisplayValue(e)} onCommit={(v) => onChange(encodeText(v))} />;
  if (e.metaType === META.tempo)
    return (
      <span>
        <CommitInput
          className="short" value={tempoToBpm(e.data).toFixed(2)}
          validate={(v) => Number(v) > 0 && Number(v) < 1000}
          onCommit={(v) => onChange(bpmToTempoData(Number(v)))}
        /> BPM
      </span>
    );
  if (e.metaType === META.timeSignature)
    return <CommitInput className="short" value={metaDisplayValue(e)} validate={(v) => !!parseTimeSignature(v)} onCommit={(v) => onChange(parseTimeSignature(v)!)} />;
  if (e.metaType === META.keySignature)
    return <CommitInput value={metaDisplayValue(e)} validate={(v) => !!parseKeySignature(v)} onCommit={(v) => onChange(parseKeySignature(v)!)} />;
  return <code className="small">{metaDisplayValue(e) || '—'}</code>;
}

function AddEvent({ file, onAdd }: { file: MidiFile; onAdd: (track: number, e: MetaEvent) => void }) {
  const [track, setTrack] = useState(0);
  const [type, setType] = useState<number>(META.text);
  const [tick, setTick] = useState('0');
  const [value, setValue] = useState('');
  const data =
    type === META.tempo ? (Number(value) > 0 ? bpmToTempoData(Number(value)) : null)
    : type === META.timeSignature ? parseTimeSignature(value)
    : type === META.keySignature ? parseKeySignature(value)
    : encodeText(value);
  const ok = !!data && /^\d+$/.test(tick) && track < file.tracks.length;
  const placeholder = type === META.tempo ? 'e.g. 120' : type === META.timeSignature ? 'e.g. 3/4' : type === META.keySignature ? 'e.g. D minor' : 'Text';
  return (
    <Section title="Add metadata event">
      <div className="row">
        <label>Track <select value={track} onChange={(e) => setTrack(Number(e.target.value))}>
          {file.tracks.map((_, i) => <option key={i} value={i}>{i}</option>)}
        </select></label>
        <label>Type <select value={type} onChange={(e) => setType(Number(e.target.value))}>
          {ADDABLE.map((t) => <option key={t} value={t}>{metaName(t)}</option>)}
        </select></label>
        <label>Tick <input className="tick" value={tick} onChange={(e) => setTick(e.target.value)} /></label>
        <input className="wide" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        <button
          className="btn primary" disabled={!ok}
          onClick={() => {
            onAdd(track, { kind: 'meta', tick: Number(tick), metaType: type, data: data! });
            setValue('');
          }}
        >Add</button>
      </div>
    </Section>
  );
}

function insertEvent(midi: MidiFile, track: number, e: MetaEvent): MidiFile {
  return {
    ...midi,
    tracks: midi.tracks.map((t, i) => {
      if (i !== track) return t;
      let at = t.events.findIndex((x) => x.tick > e.tick || (x.kind === 'meta' && x.metaType === META.endOfTrack));
      if (at < 0) at = t.events.length;
      return { events: [...t.events.slice(0, at), e, ...t.events.slice(at)] };
    }),
  };
}
