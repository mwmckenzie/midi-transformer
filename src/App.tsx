import { useEffect, useRef, useState } from 'react';
import { useLibrary, type LoadError } from './state/library';
import { writeMidi } from './midi/write';
import { demoCombined, demoSeparate } from './midi/demo';
import { download, makeZip } from './state/zip';
import { ChannelBaseContext, CommitInput, ConfirmButton } from './components/common';
import { OverviewPanel } from './components/OverviewPanel';
import { MetadataPanel } from './components/MetadataPanel';
import { ChannelsPanel } from './components/ChannelsPanel';
import { RollPanel } from './components/RollPanel';
import { HandsPanel } from './components/HandsPanel';
import { BatchPanel } from './components/BatchPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'channels', label: 'Channels & instruments' },
  { id: 'roll', label: 'Piano roll' },
  { id: 'hands', label: 'Hands' },
  { id: 'batch', label: 'Batch edit' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const readPref = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const writePref = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export default function App() {
  const lib = useLibrary();
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabId>(() => readPref('tab', 'overview'));
  const [base, setBase] = useState<0 | 1>(() => readPref('channelBase', 0));
  const [errors, setErrors] = useState<LoadError[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => writePref('tab', tab), [tab]);
  useEffect(() => writePref('channelBase', base), [base]);

  const file = lib.files.find((f) => f.id === selected) ?? lib.files[0] ?? null;
  const checkedFiles = lib.files.filter((f) => checked.has(f.id));
  const batchFiles = checkedFiles.length ? checkedFiles : file ? [file] : [];

  const add = async (list: File[]) => {
    const { added, errors } = await lib.addFiles(list);
    setErrors(errors);
    if (added.length) setSelected(added[0].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!file || !(e.metaKey || e.ctrlKey)) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        lib.undo(file.id);
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        lib.redo(file.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, lib]);

  const toggleCheck = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const exportFiles = (ids: string[]) => {
    const fs = lib.files.filter((f) => ids.includes(f.id));
    if (fs.length === 1) download(new Blob([writeMidi(fs[0].midi) as BlobPart], { type: 'audio/midi' }), ensureExt(fs[0].name));
    else if (fs.length) download(makeZip(fs.map((f) => ({ name: ensureExt(f.name), data: writeMidi(f.midi) }))), 'midi-files.zip');
  };

  return (
    <ChannelBaseContext.Provider value={base}>
      <div
        className={`app ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add([...e.dataTransfer.files]);
        }}
      >
        <header className="topbar">
          <h1>MIDI Transformer</h1>
          <button className="btn primary" onClick={() => inputRef.current?.click()}>Open MIDI files…</button>
          <input
            ref={inputRef} type="file" multiple accept=".mid,.midi,.kar,.rmi,audio/midi,audio/x-midi" hidden
            onChange={(e) => {
              add([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <div className="spacer" />
          <label className="small">
            Channel numbers{' '}
            <select value={base} onChange={(e) => setBase(Number(e.target.value) as 0 | 1)}>
              <option value={0}>0–15</option>
              <option value={1}>1–16 (as in most DAWs)</option>
            </select>
          </label>
        </header>

        {errors.length > 0 && (
          <div className="banner warn">
            Could not read {errors.map((e) => `${e.name} (${e.message})`).join(', ')}.
            <button className="btn link" onClick={() => setErrors([])}>Dismiss</button>
          </div>
        )}

        <div className="body">
          <aside className="library">
            <div className="library-head">
              <label className="check" title="Tick all">
                <input
                  type="checkbox"
                  checked={lib.files.length > 0 && checked.size === lib.files.length}
                  onChange={(e) => setChecked(e.target.checked ? new Set(lib.files.map((f) => f.id)) : new Set())}
                />
                <strong>Library</strong> <span className="muted">({lib.files.length})</span>
              </label>
            </div>
            <ul className="files">
              {lib.files.map((f) => (
                <li key={f.id} className={f.id === file?.id ? 'active' : ''} onClick={() => setSelected(f.id)}>
                  <input type="checkbox" checked={checked.has(f.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCheck(f.id)} />
                  <span className="fname" title={f.name}>{f.name}</span>
                  {f.dirty && <span className="dot" title="Edited" />}
                </li>
              ))}
            </ul>
            {!lib.files.length && lib.loaded && (
              <div className="empty">
                <p>Drop .mid files anywhere, or open them with the button above. Files stay in this browser.</p>
                <button
                  className="btn"
                  onClick={() => {
                    lib.addMidi('Demo - both hands one channel.mid', demoCombined());
                    const f = lib.addMidi('Demo - separate hands.mid', demoSeparate());
                    setSelected(f.id);
                  }}
                >Load demo files</button>
              </div>
            )}
            <div className="library-actions">
              <span className="muted small">{checked.size ? `${checked.size} ticked` : 'Selected file'}</span>
              <button className="btn small" disabled={!file} onClick={() => {
                const ids = checked.size ? [...checked] : file ? [file.id] : [];
                let last;
                for (const id of ids) last = lib.duplicate(id);
                if (last) setSelected(last.id);
              }}>Duplicate</button>
              <button className="btn small" disabled={!file} onClick={() => exportFiles(checked.size ? [...checked] : [file!.id])}>
                {checked.size > 1 ? 'Export .zip' : 'Export .mid'}
              </button>
              <ConfirmButton className="btn small danger" disabled={!file} confirmLabel="Click again to remove" onConfirm={() => {
                lib.removeFiles(checked.size ? [...checked] : [file!.id]);
                setChecked(new Set());
              }}>Remove</ConfirmButton>
            </div>
          </aside>

          <main className="main">
            {file ? (
              <>
                <div className="file-head">
                  <CommitInput className="title-input" value={file.name} onCommit={(v) => v.trim() && lib.rename(file.id, v.trim())} />
                  <div className="spacer" />
                  <button className="btn small" disabled={!file.past.length} title={file.past.length ? `Undo ${file.past[file.past.length - 1].label}` : ''} onClick={() => lib.undo(file.id)}>↶ Undo</button>
                  <button className="btn small" disabled={!file.future.length} onClick={() => lib.redo(file.id)}>↷ Redo</button>
                  <button className="btn small" disabled={!file.dirty} title="Go back to the file as loaded (undoable)" onClick={() => lib.revert(file.id)}>Revert</button>
                  <button className="btn small primary" onClick={() => exportFiles([file.id])}>Export .mid</button>
                </div>
                {file.past.length > 0 && <div className="muted small history">Last change: {file.past[file.past.length - 1].label}</div>}
                <nav className="tabs">
                  {TABS.map((t) => (
                    <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>
                      {t.label}
                      {t.id === 'batch' && checked.size > 0 && <span className="badge">{checked.size}</span>}
                    </button>
                  ))}
                </nav>
                <div className="tab-body">
                  {tab === 'overview' && <OverviewPanel file={file} lib={lib} />}
                  {tab === 'metadata' && <MetadataPanel file={file} lib={lib} />}
                  {tab === 'channels' && <ChannelsPanel key={file.id} file={file} lib={lib} checked={[...checked]} />}
                  {tab === 'roll' && <RollPanel key={file.id} file={file} />}
                  {tab === 'hands' && <HandsPanel key={file.id} file={file} lib={lib} />}
                  {tab === 'batch' && <BatchPanel files={batchFiles} lib={lib} />}
                </div>
              </>
            ) : (
              <div className="welcome">
                <h2>Organise, inspect and transform your MIDI files</h2>
                <p>Open or drop MIDI files to start. Everything runs in your browser; nothing is uploaded.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </ChannelBaseContext.Provider>
  );
}

function ensureExt(name: string) {
  return /\.(mid|midi|kar|rmi)$/i.test(name) ? name : `${name}.mid`;
}
