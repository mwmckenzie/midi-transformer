import { useMemo, useState } from 'react';
import { extractNotes, lastTick, tempoMap, ticksToSeconds, voiceId, type Note } from '../analysis/notes';
import { computeVoiceStats, type VoiceStats } from '../analysis/voices';
import { detectHands, type HandDetection, type HandRole } from '../analysis/hands';
import { SPLIT_ALGORITHMS, defaultParams, getAlgorithm, type Hand, type SplitAlgorithm } from '../analysis/split';
import { noteName, parseNoteName, programName } from '../midi/gm';
import { ticksPerBeat, type MidiFile } from '../midi/types';
import type { LibFile, Library } from '../state/library';
import { applyHandAssignment, DEFAULT_HAND_OPTIONS, type HandApplyOptions } from '../transforms/handSplit';
import { CHANNEL_COLORS, ChannelSelect, HAND_COLORS, Section, Swatch, firstTimeSig, useChannelLabel } from './common';
import { PianoRoll, type Lane } from './PianoRoll';

type Role = 'R' | 'L' | 'split' | 'ignore';

const ROLE_LABEL: Record<HandRole, string> = {
  right: 'Right hand', left: 'Left hand', both: 'Both hands', other: 'Other', drums: 'Drums',
};

function initialRoles(d: HandDetection): Record<string, Role> {
  const r: Record<string, Role> = {};
  for (const g of d.guesses) r[g.voiceId] = g.role === 'right' ? 'R' : g.role === 'left' ? 'L' : g.role === 'both' ? 'split' : 'ignore';
  // A lone keyboard voice with no partner is most likely both hands.
  if (d.right && !d.left && !d.combined.length) r[d.right] = 'split';
  return r;
}

function assign(notes: Note[], roles: Record<string, Role>, algoHands: Map<string, Hand>, overrides: Map<string, Hand>) {
  const out = new Map<string, Hand>();
  for (const n of notes) {
    const role = roles[voiceId(n)] ?? 'ignore';
    if (role === 'ignore') continue;
    const h = overrides.get(n.id) ?? (role === 'split' ? algoHands.get(n.id) : role);
    if (h) out.set(n.id, h);
  }
  return out;
}

export function HandsPanel({ file, lib }: { file: LibFile; lib: Library }) {
  const m = file.midi;
  const ch = useChannelLabel();
  const notes = useMemo(() => extractNotes(m), [m]);
  const stats = useMemo(() => computeVoiceStats(m, notes), [m, notes]);
  const detection = useMemo(() => detectHands(stats), [stats]);

  // Choices reset whenever the file content changes (note ids depend on it).
  const [state, setState] = useState(() => ({ midi: m, roles: initialRoles(detection), overrides: new Map<string, Hand>() }));
  if (state.midi !== m) setState({ midi: m, roles: initialRoles(detection), overrides: new Map() });
  const { roles, overrides } = state;
  const setRoles = (r: Record<string, Role>) => setState((s) => ({ ...s, roles: r }));

  const [algoId, setAlgoId] = useState(SPLIT_ALGORITHMS[0].id);
  const [paramsByAlgo, setParamsByAlgo] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(SPLIT_ALGORITHMS.map((a) => [a.id, defaultParams(a)])),
  );
  const [opts, setOpts] = useState<HandApplyOptions>(DEFAULT_HAND_OPTIONS);
  const [compare, setCompare] = useState(false);
  const [height, setHeight] = useState(200);

  const algo = getAlgorithm(algoId);
  const splitNotes = useMemo(() => notes.filter((n) => roles[voiceId(n)] === 'split'), [notes, roles]);
  const ctx = useMemo(() => {
    const map = tempoMap(m);
    return { ticksPerBeat: ticksPerBeat(m), seconds: (t: number) => ticksToSeconds(m, t, map) };
  }, [m]);
  const runAlgo = (a: SplitAlgorithm) => (splitNotes.length ? a.run(splitNotes, paramsByAlgo[a.id], ctx) : new Map<string, Hand>());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const algoHands = useMemo(() => runAlgo(algo), [algo, splitNotes, paramsByAlgo, ctx]);
  const hands = useMemo(() => assign(notes, roles, algoHands, overrides), [notes, roles, algoHands, overrides]);

  const counts = { R: 0, L: 0 };
  const range = { R: [127, 0], L: [127, 0] };
  for (const n of notes) {
    const h = hands.get(n.id);
    if (!h) continue;
    counts[h]++;
    range[h] = [Math.min(range[h][0], n.pitch), Math.max(range[h][1], n.pitch)];
  }
  const fmtRange = (h: Hand) => (counts[h] ? `${noteName(range[h][0])}–${noteName(range[h][1])}` : '—');

  const conflicts = stats.filter((s) => (roles[s.id] ?? 'ignore') === 'ignore' && (s.channel === opts.rightChannel || s.channel === opts.leftChannel));
  const nothing = hands.size === 0;

  const tpb = ticksPerBeat(m);
  const sig = firstTimeSig(m);
  const total = lastTick(m);
  const flip = (n: Note) => {
    const h = hands.get(n.id);
    if (!h) return;
    const next = new Map(overrides);
    const base = roles[voiceId(n)] === 'split' ? algoHands.get(n.id) : (roles[voiceId(n)] as Hand);
    const flipped: Hand = h === 'R' ? 'L' : 'R';
    if (flipped === base) next.delete(n.id);
    else next.set(n.id, flipped);
    setState((s) => ({ ...s, overrides: next }));
  };

  const lanes: Lane[] = [
    {
      key: 'current', label: 'Current: coloured by channel', notes,
      color: (n) => CHANNEL_COLORS[n.channel], describe: (n) => `ch ${ch(n.channel)}`,
    },
    {
      key: 'proposed', label: `Proposed: right hand → ch ${ch(opts.rightChannel)}, left hand → ch ${ch(opts.leftChannel)} · click a note to flip it`,
      notes,
      color: (n) => (hands.get(n.id) ? HAND_COLORS[hands.get(n.id)!] : '#888'),
      dim: (n) => !hands.has(n.id),
      outline: (n) => overrides.has(n.id),
      onNoteClick: flip,
      describe: (n) => (hands.get(n.id) === 'R' ? 'right hand' : hands.get(n.id) === 'L' ? 'left hand' : 'unchanged') + (overrides.has(n.id) ? ' (manual)' : ''),
    },
  ];
  if (compare && splitNotes.length) {
    for (const a of SPLIT_ALGORITHMS) {
      if (a.id === algo.id) continue;
      const h = assign(notes, roles, runAlgo(a), new Map());
      const diff = notes.filter((n) => h.get(n.id) !== hands.get(n.id)).length;
      lanes.push({
        key: a.id, label: `${a.name} (differs on ${diff} notes)`, notes,
        color: (n) => (h.get(n.id) ? HAND_COLORS[h.get(n.id)!] : '#888'),
        dim: (n) => !h.has(n.id),
        outline: (n) => h.get(n.id) !== hands.get(n.id),
      });
    }
  }

  const doApply = (copy: boolean) => {
    const out: MidiFile = applyHandAssignment(m, notes, hands, opts);
    if (copy) lib.addMidi(file.name.replace(/(\.[^.]*)?$/, (ext) => ` (hands)${ext}`), out);
    else lib.update([file.id], 'Split hands', (f) => ({ ...f, midi: out }));
  };

  return (
    <div className="stack">
      <Section title="Detected voices" actions={<button className="btn small" onClick={() => setState({ midi: m, roles: initialRoles(detection), overrides: new Map() })}>Reset to detected</button>}>
        <p className="summary">{summarize(detection, stats, ch)}</p>
        <table className="grid">
          <thead>
            <tr><th>Voice</th><th>Instrument</th><th className="num">Notes</th><th>Range</th><th className="num">Median</th><th>Guess</th><th>Use as</th></tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const g = detection.guesses.find((x) => x.voiceId === s.id)!;
              return (
                <tr key={s.id}>
                  <td className="nowrap">
                    <Swatch color={CHANNEL_COLORS[s.channel]} /> Track {s.track} · ch {ch(s.channel)}
                    {s.trackName && <div className="muted small">{s.trackName}</div>}
                  </td>
                  <td className="small">{programName(s.program, s.channel)}</td>
                  <td className="num">{s.noteCount}</td>
                  <td className="nowrap">{noteName(s.minPitch)}–{noteName(s.maxPitch)}</td>
                  <td className="num">{noteName(s.medianPitch)}</td>
                  <td>
                    <span className={`role role-${g.role}`}>{ROLE_LABEL[g.role]}</span>{' '}
                    <span className="muted small">{Math.round(g.confidence * 100)}%</span>
                    <details className="small"><summary>why</summary><ul>{g.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
                  </td>
                  <td>
                    <select value={roles[s.id] ?? 'ignore'} onChange={(e) => setRoles({ ...roles, [s.id]: e.target.value as Role })}>
                      <option value="R">Right hand</option>
                      <option value="L">Left hand</option>
                      <option value="split">Split (both hands)</option>
                      <option value="ignore">Leave as is</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Split algorithm" actions={<span className="muted small">{splitNotes.length ? `${splitNotes.length} notes to split` : 'No voices set to “Split”'}</span>}>
        <div className="algos">
          {SPLIT_ALGORITHMS.map((a) => (
            <label key={a.id} className={`algo ${a.id === algoId ? 'on' : ''}`}>
              <input type="radio" checked={a.id === algoId} onChange={() => setAlgoId(a.id)} />
              <strong>{a.name}</strong>
              <span className="muted small">{a.description}</span>
            </label>
          ))}
        </div>
        <div className="row params">
          {algo.params.map((p) => (
            <label key={p.key} title={p.help}>
              {p.label}
              {p.type === 'note' ? (
                <NoteInput value={paramsByAlgo[algo.id][p.key]} onChange={(v) => setParamsByAlgo({ ...paramsByAlgo, [algo.id]: { ...paramsByAlgo[algo.id], [p.key]: v } })} />
              ) : (
                <input
                  type="number" className="short" min={p.min} max={p.max} step={p.step ?? 1}
                  value={paramsByAlgo[algo.id][p.key]}
                  onChange={(e) => setParamsByAlgo({ ...paramsByAlgo, [algo.id]: { ...paramsByAlgo[algo.id], [p.key]: Number(e.target.value) } })}
                />
              )}
            </label>
          ))}
          <button className="btn small" onClick={() => setParamsByAlgo({ ...paramsByAlgo, [algo.id]: defaultParams(algo) })}>Defaults</button>
        </div>
      </Section>

      <Section
        title="Compare current and proposed"
        actions={
          <>
            <label className="check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Show other algorithms</label>
            <label>Height <input type="range" min={100} max={480} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
          </>
        }
      >
        <div className="legend">
          <span className="chip"><Swatch color={HAND_COLORS.R} /> Right hand · {counts.R} notes · {fmtRange('R')}</span>
          <span className="chip"><Swatch color={HAND_COLORS.L} /> Left hand · {counts.L} notes · {fmtRange('L')}</span>
          {overrides.size > 0 && (
            <span className="chip">
              {overrides.size} manual flip{overrides.size === 1 ? '' : 's'}
              <button className="btn link" onClick={() => setState((s) => ({ ...s, overrides: new Map() }))}>clear</button>
            </span>
          )}
        </div>
        <PianoRoll lanes={lanes} tpb={tpb} totalTicks={total} sig={sig} laneHeight={height} />
      </Section>

      <Section title="Apply">
        <div className="row">
          <label>Right hand → <ChannelSelect value={opts.rightChannel} onChange={(c) => c !== null && setOpts({ ...opts, rightChannel: c })} /></label>
          <label>Left hand → <ChannelSelect value={opts.leftChannel} onChange={(c) => c !== null && setOpts({ ...opts, leftChannel: c })} /></label>
          <label>Layout <select value={opts.layout} onChange={(e) => setOpts({ ...opts, layout: e.target.value as HandApplyOptions['layout'] })}>
            <option value="inPlace">Keep notes in their tracks</option>
            <option value="twoTracks">Move into “Right Hand” / “Left Hand” tracks</option>
          </select></label>
        </div>
        {conflicts.length > 0 && (
          <p className="warn small">
            {conflicts.map((s) => `Track ${s.track} ch ${ch(s.channel)}`).join(', ')} already use{conflicts.length === 1 ? 's' : ''} a target
            channel and would mix with the hands. Set {conflicts.length === 1 ? 'it' : 'them'} to a hand, or move {conflicts.length === 1 ? 'it' : 'them'} on the Channels tab first.
          </p>
        )}
        {opts.rightChannel === opts.leftChannel && <p className="warn small">Both hands are set to the same channel.</p>}
        <div className="row">
          <button className="btn primary" disabled={nothing} onClick={() => doApply(false)}>Apply to this file</button>
          <button className="btn" disabled={nothing} onClick={() => doApply(true)}>Save as a new copy</button>
          <span className="muted small">Instrument, sustain pedal and other controller events are copied to both hand channels.</span>
        </div>
      </Section>
    </div>
  );
}

function NoteInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? noteName(value);
  return (
    <span className="note-input">
      <input
        className={`short ${draft !== null && parseNoteName(draft) === null ? 'invalid' : ''}`}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNoteName(e.target.value);
          if (n !== null) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
      <button className="btn icon" onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <button className="btn icon" onClick={() => onChange(Math.min(127, value + 1))}>+</button>
    </span>
  );
}

function summarize(d: HandDetection, stats: VoiceStats[], ch: (c: number) => string): string {
  const label = (id: string) => {
    const s = stats.find((x) => x.id === id);
    return s ? `track ${s.track} ch ${ch(s.channel)}${s.trackName ? ` (“${s.trackName}”)` : ''}` : id;
  };
  const combined = d.combined.map(label).join(', ');
  if (d.right && d.left) {
    const base = `Hands look separate already: right hand is ${label(d.right)}, left hand is ${label(d.left)}.`;
    return combined ? `${base} ${combined} also looks two-handed.` : base;
  }
  if (combined) return `Both hands appear to share ${combined}. Pick a split algorithm below.`;
  if (d.right) return `Only one playable voice, ${label(d.right)}. It is set to Split in case it holds both hands.`;
  return 'No piano-like voices found.';
}
