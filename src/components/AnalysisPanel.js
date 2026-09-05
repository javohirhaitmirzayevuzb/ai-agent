'use client';
/**
 * Step 2 — the read-out. Everything the studio learned from the reference:
 * measured numbers, extracted palette, layout archetype, readable text, whether a
 * company name is printed in it, and the questions we still need answered.
 */
import { useState } from 'react';
import { Badge, Copy, Note, PaletteStrip, Seg } from '@/components/ui';

const REGION_LABEL = {
  tl: 'top-left',
  tc: 'top',
  tr: 'top-right',
  ml: 'left',
  mc: 'centre',
  mr: 'right',
  bl: 'bottom-left',
  bc: 'bottom',
  br: 'bottom-right',
};

function pct(n, d = 100) {
  return n == null ? '—' : `${Math.round(n * d)}%`;
}

export default function AnalysisPanel({ ref: reference, analysis, company, readiness, onAnswer }) {
  const [view, setView] = useState('clean');
  const [openJson, setOpenJson] = useState(false);
  if (!analysis) return null;

  const regions = analysis.measured?.regions || reference?.signals?.regions || null;
  const maxEnergy = regions ? Math.max(0.0001, ...Object.values(regions).map((r) => r.energy || 0)) : 1;

  return (
    <div className="stack">
      <div className="between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">step 2 · read of your reference</span>
          <h2 style={{ marginTop: 4, maxWidth: '22ch' }}>{analysis.summary || 'Design DNA'}</h2>
        </div>
        <div className="center" style={{ gap: 8 }}>
          {analysis.aiProvider && <Badge kind="ai">{analysis.aiProvider} · vision</Badge>}
          {analysis.engine === 'heuristic' && <Badge kind="local">canvas measure</Badge>}
          <Seg
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'clean', label: 'image' },
              { value: 'heat', label: 'heat map' },
            ]}
          />
        </div>
      </div>

      <div className="studio-grid">
        <div className="stack">
          {reference?.dataUrl && (
            <div className="preview">
              <img src={reference.dataUrl} alt="reference design" />
              {view === 'heat' && regions && (
                <div className="overlay" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' }}>
                  {['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((k) => {
                    const e = (regions[k]?.energy || 0) / maxEnergy;
                    return (
                      <div
                        key={k}
                        style={{
                          background: `linear-gradient(0deg, rgba(124,92,255,${(e * 0.55).toFixed(3)}), rgba(34,227,196,${(e * 0.25).toFixed(3)}))`,
                          border: '1px solid rgba(255,255,255,.09)',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 10,
                          letterSpacing: '.08em',
                          textTransform: 'uppercase',
                          color: `rgba(255,255,255,${(0.35 + e * 0.55).toFixed(2)})`,
                        }}
                      >
                        {REGION_LABEL[k]}
                        <br />
                        {pct(regions[k]?.energy || 0, 140)}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="preview-tag">
                <span className="badge badge-ai" style={{ background: 'rgba(6,8,15,.75)', border: '1px solid var(--line)' }}>
                  {analysis.aspectRatio || reference.signals?.ratioLabel || '1:1'} · {analysis.layout?.density || '—'} density
                </span>
                {analysis.layout?.safeZones?.[0] && (
                  <span className="badge badge-local" style={{ background: 'rgba(6,8,15,.75)', border: '1px solid var(--line)' }}>
                    calm: {analysis.layout.safeZones[0]}
                  </span>
                )}
              </div>
            </div>
          )}

          {analysis.palette?.length > 0 && (
            <PaletteStrip colors={analysis.palette.map((p) => p.hex)} shares={analysis.palette.map((p) => p.coverage)} />
          )}

          <div className="card card-pad">
            <span className="eyebrow">measured from the file</span>
            <dl className="kv mt-s">
              <dt>size</dt>
              <dd>
                {analysis.measured?.width || '—'} × {analysis.measured?.height || '—'} px ({analysis.measured?.ratioLabel || '—'})
              </dd>
              <dt>brightness</dt>
              <dd>{pct(analysis.measured?.luminance)} {analysis.measured?.dark ? '· dark' : '· light'}</dd>
              <dt>contrast</dt>
              <dd>{pct(analysis.measured?.contrast)}</dd>
              <dt>saturation</dt>
              <dd>{pct(analysis.measured?.saturation)}</dd>
              <dt>detail</dt>
              <dd>{pct(analysis.measured?.edgeDensity)} · {analysis.measured?.typeGuess || '—'}</dd>
              <dt>layout</dt>
              <dd>{analysis.layout?.archetype || '—'} · {analysis.layout?.alignment || '—'} aligned</dd>
            </dl>
          </div>
        </div>

        <div className="stack">
          {company?.found ? (
            <Note kind="good">
              <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <b>Company name found in the design:</b> {company.value}
                  <div className="muted tiny">Pre-filled below — change it if this reference belongs to someone else.</div>
                </div>
                <button className="btn btn-sm btn-accent" onClick={() => onAnswer?.('companyName', company.value)}>
                  use it →
                </button>
              </div>
            </Note>
          ) : (
            <Note kind="warn">
              <b>No company name was printed in this design.</b>
              <div className="muted tiny mt-s">{company?.text || 'Tell us whose brand this is for and we’ll set the wordmark.'}</div>
              <form
                className="center mt-s"
                style={{ gap: 8, flexWrap: 'wrap' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const el = e.currentTarget.elements.company;
                  if (el.value.trim()) {
                    onAnswer?.('companyName', el.value.trim());
                    el.value = '';
                  }
                }}
              >
                <input className="input" name="company" style={{ maxWidth: 280 }} placeholder="company / brand name…" maxLength={60} />
                <button className="btn btn-sm btn-accent" type="submit">apply ⏎</button>
              </form>
            </Note>
          )}

          {analysis.detectedText?.length > 0 && (
            <div className="card card-pad">
              <div className="between">
                <span className="eyebrow">text read from the reference</span>
                <span className="muted tiny">never copied — used for style only</span>
              </div>
              <div className="chips mt-s">
                {analysis.detectedText.slice(0, 14).map((t, i) => (
                  <span key={i} className="chip chip-static" title={t.role}>
                    <b style={{ fontWeight: 700 }}>{t.text}</b>
                    {t.role && <span className="muted" style={{ fontSize: 11 }}>{t.role}</span>}
                  </span>
                ))}
              </div>
              {analysis.handles?.length > 0 && <p className="muted tiny mt-s">handles seen: {analysis.handles.join(' · ')}</p>}
            </div>
          )}

          <div className="grid-2">
            <div className="card card-pad">
              <span className="eyebrow">type</span>
              <p className="fs-13 mt-s" style={{ color: 'var(--ink-dim)' }}>{analysis.typography?.headlineStyle || '—'}</p>
              {analysis.typography?.pairing && <p className="muted tiny mt-s">pairing: {analysis.typography.pairing}</p>}
              {analysis.typography?.hierarchy && <p className="muted tiny">hierarchy: {analysis.typography.hierarchy}</p>}
            </div>
            <div className="card card-pad">
              <span className="eyebrow">background</span>
              <p className="fs-13 mt-s" style={{ color: 'var(--ink-dim)' }}>{analysis.background?.description || '—'}</p>
              {analysis.colorStory && <p className="muted tiny mt-s">{analysis.colorStory}</p>}
            </div>
          </div>

          {analysis.whatMakesItWork?.length > 0 && (
            <div className="card card-pad">
              <span className="eyebrow">why it works — we reproduce these</span>
              <ul className="list mt-s">
                {analysis.whatMakesItWork.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {(analysis.styleTags?.length > 0 || analysis.mood?.length > 0) && (
            <div className="card card-pad">
              <span className="eyebrow">style tags</span>
              <div className="chips mt-s">
                {[...(analysis.styleTags || []), ...(analysis.mood || []).map((m) => `mood: ${m}`)].map((t, i) => (
                  <span key={i} className="chip chip-static">{t}</span>
                ))}
              </div>
              {analysis.decoration?.length > 0 && <p className="muted tiny mt-s">effects: {analysis.decoration.join(', ')}</p>}
            </div>
          )}

          {analysis.questionsToAsk?.length > 0 && (
            <Note kind="accent">
              <span className="eyebrow" style={{ color: 'inherit', opacity: .8 }}>to answer before we draw</span>
              <ol className="list mt-s" style={{ paddingLeft: 20 }}>
                {analysis.questionsToAsk.map((q, i) => (
                  <li key={i}>
                    <button
                      className="chip"
                      style={{ border: 0, background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer' }}
                      onClick={() => onAnswer?.(q.field === 'insight' ? 'insight' : q.field, '')}
                    >
                      {q.question}
                    </button>
                    <div className="muted tiny">{q.why}</div>
                  </li>
                ))}
              </ol>
            </Note>
          )}

          {analysis.textRisk?.length > 0 && <Note kind="warn">⚠ {analysis.textRisk.join(' · ')}</Note>}
          {analysis.aiError && <Note kind="bad">Vision call: {analysis.aiError}</Note>}
          {readiness?.note && <Note>{readiness.note}</Note>}

          <details>
            <summary className="muted tiny">
              <span className="tri">▸</span> raw analysis json
            </summary>
            <pre
              style={{
                background: 'rgba(0,0,0,.35)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: 12,
                maxHeight: 260,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(analysis, null, 1)}
            </pre>
            <div className="center mt-s">
              <Copy text={JSON.stringify(analysis)} label="copy json" />
              <button className="btn btn-sm btn-ghost" onClick={() => setOpenJson((v) => !v)}>
                {openJson ? 'hide' : 'toggle'} notes
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
