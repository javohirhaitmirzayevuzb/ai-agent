'use client';
/**
 * Step 4 — results. Each card can be opened full-size, exported to PNG, copied
 * (its prompt), favourited into the profile, or remixed with one instruction —
 * the remix feeds the previous image back in as a reference.
 */
import { useEffect, useState } from 'react';
import { Badge, Btn, Copy, Modal } from '@/components/ui';
import { exportPng, download } from '@/lib/clientImage';
import { authedSrc } from '@/components/session';
import GenTrail from '@/components/GenTrail';

export default function ResultsGrid({ items = [], loading, onRemix, onFavorite, favoriteItemId, onDone, trail, progress, model = '' }) {
  const [open, setOpen] = useState(null);
  const [remixFor, setRemixFor] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const quick = ['make the headline twice as big', 'more whitespace, fewer shapes', 'swap accent to electric blue', 'make it darker + premium', 'add a subtle grain and glow'];

  async function runRemix(item, instruction) {
    setBusy(item.id);
    try {
      await onRemix?.(item, instruction);
      setRemixFor(null);
      setText('');
    } finally {
      setBusy('');
    }
  }

  const trailEl = <GenTrail stages={trail} progress={progress} elapsed={elapsed} model={model} />;

  // variations that have not landed yet — shown as they are waited for, not hidden
  const total = progress?.total || items.length || 2;
  const pending = loading ? Math.max(1, total - items.length) : 0;
  const skeletons = (n, offset = 0) =>
    Array.from({ length: n }, (_, i) => (
      <div key={`sk-${offset}-${i}`} className="art">
        <div className="frame" style={{ minHeight: 300 }}>
          <div className="shimmer" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
        </div>
        <div className="bar">
          <span className="muted tiny">
            {model ? `${model} · ` : ''}generating… {elapsed}s
            {elapsed > 25 ? ' — image models can take up to a minute per variation' : ''}
          </span>
        </div>
      </div>
    ));

  if (loading && !items.length) {
    return (
      <div className="stack">
        <GenTrail stages={trail} progress={progress} elapsed={elapsed} model={model} />
        <div className="results">{skeletons(Math.min(4, total || 2))}</div>
      </div>
    );
  }


  if (!items.length) return loading ? trailEl : null;

  return (
    <>
      {loading ? trailEl : null}
      <div className="results">
        {loading ? skeletons(pending, 0) : null}
        {items.map((it) => (
          <div key={it.id} className="art fade-in">
            <button className="frame" style={{ border: 0, cursor: 'zoom-in', padding: 0, display: 'block', width: '100%' }} onClick={() => setOpen(it)}>
              <img src={authedSrc(it.url)} alt={it.label || 'generated cover'} loading="lazy" />
            </button>
            <div className="bar">
              <div className="meta">
                <b>{it.label || it.model}</b>
                <span>
                  {it.mode === 'ai' ? `${it.provider} · ${it.model}` : 'local vector composer'}
                  {it.bytes ? ` · ${(it.bytes / 1024).toFixed(0)}kb` : ''}
                </span>
              </div>
              <button className="iconbtn" data-on={favoriteItemId === it.id} title="save to profile" onClick={() => onFavorite?.(it)}>
                ★
              </button>
              <button
                className="iconbtn"
                title="download png"
                onClick={async () => {
                  setBusy(it.id);
                  await exportPng(it.url, `${(it.label || 'studio').replace(/[^\w.-]+/g, '_')}.png`);
                  setBusy('');
                }}
              >
                {busy === it.id ? <span className="spin" /> : '⤓'}
              </button>
              {it.mime === 'image/svg+xml' && (
                <button className="iconbtn" title="download svg" onClick={() => download(it.url, `${(it.label || 'studio').replace(/[^\w.-]+/g, '_')}.svg`)}>
                  ‹›
                </button>
              )}
              <button className="iconbtn" title="remix with an instruction" onClick={() => setRemixFor(remixFor === it.id ? null : it.id)}>
                ✦
              </button>
            </div>

            {remixFor === it.id && (
              <div style={{ padding: 12, borderTop: '1px solid var(--line)', background: 'rgba(0,0,0,.22)' }}>
                <span className="eyebrow">one-line change</span>
                <div className="row mt-s" style={{ gap: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 160 }}
                    autoFocus
                    placeholder="e.g. headline bigger, remove the circle, warmer colours…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && text.trim() && runRemix(it, text.trim())}
                  />
                  <Btn variant="accent" loading={busy === it.id} onClick={() => runRemix(it, text.trim() || 'polish it, keep everything else')}>
                    remix
                  </Btn>
                </div>
                <div className="chips mt-s">
                  {quick.map((q) => (
                    <button key={q} className="chip" onClick={() => setText(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.label || 'result'} wide>
        {open && (
          <div className="stack">
            <div className="preview" style={{ background: '#0a0d16' }}>
              <img src={authedSrc(open.url)} alt="result" style={{ maxHeight: '66vh', width: 'auto', margin: '0 auto' }} />
            </div>
            <div className="between wrap">
              <div className="center" style={{ gap: 8 }}>
                <Badge kind={open.mode === 'ai' ? 'ai' : 'local'}>{open.mode === 'ai' ? `${open.provider} · ${open.model}` : 'local composer'}</Badge>
                {open.variation != null && <span className="muted tiny">variation {open.variation + 1}</span>}
              </div>
              <div className="center" style={{ gap: 8 }}>
                <Btn size="sm" onClick={() => exportPng(open.url, 'studio-cover.png')}>
                  ⤓ png
                </Btn>
                <Copy text={open.prompt || ''} label="copy prompt" />
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setOpen(null);
                    setRemixFor(open);
                  }}
                >
                  ✦ remix this
                </Btn>
              </div>
            </div>
            {open.prompt && (
              <details>
                <summary className="muted tiny">
                  <span className="tri">▸</span> prompt
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.4)', padding: 12, borderRadius: 12, maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                  {open.prompt}
                </pre>
              </details>
            )}
          </div>
        )}
      </Modal>
      {onDone}
    </>
  );
}