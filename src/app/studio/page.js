'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Shell } from '@/components/shell';
import { useApp } from '@/components/session';
import { BEARER_HEADER, readBearer, markCookieAuth, clearBearer } from '@/lib/bearer';
import RefDrop, { MiniUpload } from '@/components/RefDrop';
import AnalysisPanel from '@/components/AnalysisPanel';
import BriefForm from '@/components/BriefForm';
import ResultsGrid from '@/components/ResultsGrid';
import { Badge, Btn, Note, Skeleton, Stat } from '@/components/ui';
import { authedSrc } from '@/components/session';

const STEP_DEFS = [
  { id: 'upload', n: 1, label: 'Drop a reference' },
  { id: 'read', n: 2, label: 'Style DNA read' },
  { id: 'brief', n: 3, label: 'Your brief' },
  { id: 'draw', n: 4, label: 'New covers' },
];

function guessFormat(ratioLabel) {
  return (
    {
      '9:16': 'reel-9x16',
      '4:5': 'post-4x5',
      '16:9': 'wide-16x9',
      '21:9': 'wide-21x9',
      '2:3': 'poster-2x3',
      '1:1': 'post-1x1',
    }[ratioLabel] || 'post-1x1'
  );
}

function Steps({ stage }) {
  const order = ['upload', 'read', 'brief', 'draw'];
  const cur = order.indexOf(stage);
  return (
    <div className="steps">
      {STEP_DEFS.map((s, i) => (
        <div key={s.id} className="step" data-state={i === cur ? 'on' : i < cur ? 'done' : 'off'}>
          <b>{i < cur ? '✓' : s.n}</b>
          {s.label}
        </div>
      ))}
    </div>
  );
}

function StudioInner() {
  const { user, caps, api, toast, refresh } = useApp();
  const sp = useSearchParams();
  const openedRef = useRef('');
  const [reference, setReference] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [company, setCompany] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [designId, setDesignId] = useState('');
  const [brief, setBrief] = useState({ count: 2, format: 'post-1x1', mode: 'auto' });
  const [focusField, setFocusField] = useState('');
  const [generating, setGenerating] = useState(false);
  const [trail, setTrail] = useState([]);
  const [progress, setProgress] = useState(null);
  const [genError, setGenError] = useState(null);
  const [items, setItems] = useState([]);
  const [direction, setDirection] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [runInfo, setRunInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [favoriteItemId, setFavoriteItemId] = useState('');

  const stage = useMemo(
    () => (!analysis ? (reference ? 'read' : 'upload') : items.length ? 'draw' : 'brief'),
    [analysis, reference, items.length]
  );

  const loadHistory = useCallback(async () => {
    try {
      const d = await api('/designs?limit=18');
      setHistory(d.designs || []);
    } catch {
      /* offline is fine */
    }
  }, [api]);

  useEffect(() => {
    if (user) loadHistory();
  }, [user, loadHistory]);

  // /studio?open=<designId> — deep link used by the profile history grid
  useEffect(() => {
    const id = sp.get('open') || '';
    if (!id || !user || openedRef.current === id) return;
    openedRef.current = id;
    openDesign(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, user]);

  /* ----------------------------------------------------------- analysis */

  async function runAnalysis(payload) {
    setAnalysing(true);
    setAnalyseError('');
    try {
      const res = await api('/analyze', {
        method: 'POST',
        body: {
          image: payload.dataUrl,
          signals: payload.signals,
          title: payload.name?.replace(/\.[^.]+$/, '').slice(0, 60),
          designId: designId || undefined,
        },
      });
      setAnalysis(res.analysis);
      setCompany(res.company);
      setReadiness(res.readiness);
      setDesignId(res.designId);
      setBrief((b) => ({
        ...b,
        companyName: res.analysis.companyName || b.companyName || user?.profile?.company || '',
        tagline: b.tagline || user?.profile?.tagline || '',
        tone: b.tone || user?.profile?.tone || '',
        audience: b.audience || user?.profile?.audience || '',
        format: b.formatTouched ? b.format : res.analysis.formatSuggestion || guessFormat(res.analysis.aspectRatio),
      }));
      toast(
        res.readiness?.analysisMode === 'ai-vision' ? 'Reference read by the vision model.' : 'Measured locally — add a vision key in Admin for a deeper read.',
        'good'
      );
      loadHistory();
      setTimeout(() => window.scrollTo({ top: 90, behavior: 'smooth' }), 80);
    } catch (e) {
      setAnalyseError(e.message || 'Tahlilda xato.');
    } finally {
      setAnalysing(false);
    }
  }

  async function handleReady(payload) {
    setReference(payload);
    setItems([]);
    setDirection('');
    setRunInfo(null);
    await runAnalysis(payload);
  }

  /* ---------------------------------------------------------- generation */

  /**
   * Runs a generation, reading the server's NDJSON trail so variations appear one by
   * one and the stage list says what is actually happening (which model, how many
   * left). Falls back to a plain JSON call if streaming is unavailable.
   */
  async function generate(extra = {}) {
    if (!analysis) {
      toast('Avval reference dizaynni tahlil qildiring.', 'error');
      return;
    }
    setGenerating(true);
    setWarnings([]);
    setGenError(null);
    setProgress({ done: 0, total: Number(brief.count) || 2, ms: 0 });
    setTrail([{ id: 'queue', label: 'queued', status: 'run' }]);
    const payload = {
      designId,
      analysis,
      provider: brief.provider || undefined,
      title: brief.companyName || brief.headline || undefined,
      brief: { ...brief, refine: caps?.refinePrompt !== false, ...extra },
      stream: true,
    };
    const onEvent = (ev) => {
      if (ev.type === 'stage') {
        setTrail((prev) => {
          const i = prev.findIndex((x) => x.id === ev.id);
          const merged = { ...(i >= 0 ? prev[i] : {}), ...ev };
          if (i < 0) return [...prev, merged];
          const next = [...prev];
          next[i] = merged;
          return next;
        });
      } else if (ev.type === 'progress') {
        setProgress(ev);
      } else if (ev.type === 'item') {
        setItems((prev) => [ev.item, ...prev]);
        setProgress((p) => (p ? { ...p, done: Math.min(p.total, p.done + 1) } : p));
      } else if (ev.type === 'error') {
        setGenError({ error: ev.error, retryable: true });
      }
    };

    try {
      const headers = { 'content-type': 'application/json' };
      const bearer = readBearer();
      if (bearer) headers[BEARER_HEADER] = bearer;
      const res = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' });
      if (res.headers.get('x-studio-auth') === 'cookie') markCookieAuth();
      if (res.status === 401) {
        // this call bypasses api(), so bounce it the same way a dead session is bounced
        clearBearer();
        window.location.assign('/login?again=1');
        return;
      }
      if (!res.ok && !res.body) throw new Error(`HTTP ${res.status}`);

      let final = null;
      if (res.headers.get('content-type')?.includes('ndjson') && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev = null;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.type === 'done') final = ev;
            else onEvent(ev);
          }
        }
      } else {
        const data = await res.json();
        if (data?.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
        final = data;
        setItems((prev) => [...(data.items || []), ...prev]);
      }

      if (!final) throw new Error('Javob bo‘sh qaytdi.');
      setTrail((prev) => (prev.length ? prev.map((x) => (x.status === 'run' ? { ...x, status: final.failed ? 'fail' : 'done' } : x)) : prev));
      setDirection(final.direction || '');
      setWarnings(final.warnings || []);
      setRunInfo({ mode: final.mode, provider: final.provider, model: final.model, ms: final.ms, count: (final.items || []).length });
      if (final.designId && final.designId !== designId) setDesignId(final.designId);
      if (final.failed) {
        setGenError({ error: final.error, model: final.model, provider: final.provider, retryable: true });
        toast('Model rasm qaytarmadi — pastda sababi va qayta urinish tugmasi.', 'error');
      } else {
        toast(
          final.mode === 'image-model'
            ? `${final.items.length} cover · ${final.model} · ${(final.ms / 1000).toFixed(0)}s`
            : `${final.items.length} vektor kompozitsiya (image kalit yo‘q, lekin to‘liq ishlaydi).`,
          'good'
        );
      }
      loadHistory();
    } catch (err) {
      setGenError({ error: String(err?.message || err), retryable: true });
      toast(String(err?.message || 'Generatsiya bajarilmadi.'), 'error');
    } finally {
      setGenerating(false);
      setProgress(null);
      setTimeout(() => {
        const el = document.getElementById('results');
        if (el) window.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' });
      }, 90);
    }
  }

  /** One-click retry of the last brief, and the explicit local-composer escape hatch. */
  function retryGeneration(local) {
    setGenError(null);
    return generate(local ? { allowLocal: true } : {});
  }

  function reset() {
    setReference(null);
    setAnalysis(null);
    setCompany(null);
    setItems([]);
    setDirection('');
    setRunInfo(null);
    setDesignId('');
    setFavoriteItemId('');
    setBrief((b) => ({ count: b.count, format: b.format, mode: b.mode, companyName: b.companyName, tone: b.tone, audience: b.audience, provider: b.provider }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function answer(field, value) {
    if (field === 'companyName') {
      setBrief((b) => ({ ...b, companyName: value }));
      toast('Company name set — “wordmark” will use it.', 'good');
      document.getElementById('brief')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (value) setBrief((b) => ({ ...b, [field]: value }));
    setFocusField('');
    setTimeout(() => setFocusField(field), 30);
  }

  async function favorite(item) {
    if (!designId) return;
    try {
      const res = await api('/designs', { method: 'PATCH', body: { id: designId, favoriteItemId: item.id, saveToProfile: true } });
      setFavoriteItemId(res.design?.favoriteItemId || '');
      toast(res.design?.favoriteItemId ? 'Favourite saved to your profile references.' : 'Removed from profile.', 'good');
      refresh();
      loadHistory();
    } catch {
      /* handled */
    }
  }

  async function openDesign(id, label) {
    try {
      const res = await api(`/designs?id=${id}`);
      const full = res.design;
      setDesignId(full.id);
      setAnalysis(full.analysis || null);
      setReference(full.refUrl ? { dataUrl: full.refUrl, signals: full.analysis?.measured || null, name: full.title } : null);
      setCompany(null);
      setBrief({ ...brief, ...(full.brief || {}), count: full.brief?.count || brief.count, provider: brief.provider });
      setItems(full.items || []);
      setDirection(full.direction || '');
      setFavoriteItemId(full.favoriteItemId || '');
      setRunInfo(full.runs?.[full.runs.length - 1] ? { ...full.runs[full.runs.length - 1], count: full.items?.length || 0 } : null);
      toast(`Reopened “${full.title || label}”.`, 'info');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* handled */
    }
  }

  const openFromHistory = (d) => openDesign(d.id, d.title);

  async function saveBrandKit() {
    await api('/profile', {
      method: 'PUT',
      body: {
        company: brief.companyName,
        tagline: brief.tagline || brief.subhead,
        audience: brief.audience,
        tone: brief.tone,
        niche: brief.offer,
        defaultFormat: brief.format,
        brandColors: (analysis?.palette || []).map((p) => p.hex).slice(0, 5),
      },
    });
    refresh();
    toast('Brand kit saved — it prefills your next brief.', 'good');
  }

  if (!user) return null;
  const aiOn = caps?.image;

  return (
    <>
      <div className="between wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <Steps stage={stage} />
          <h1 style={{ maxWidth: '21ch' }}>
            {stage === 'upload' ? 'Start from a cover you like.' : stage === 'draw' ? 'Your new key art.' : stage === 'read' ? 'Reading the design…' : 'Now tell it what to say.'}
          </h1>
          <p className="lead mt-s">
            It analyses the reference first — palette, type, layout rhythm, any company name printed in it — then asks what’s missing before drawing a
            fresh piece in the same taste.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {reference && (
            <>
              <MiniUpload onReady={handleReady} />
              <Btn size="sm" variant="ghost" onClick={reset}>
                ✕ clear
              </Btn>
            </>
          )}
          <div className="card" style={{ padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`badge ${aiOn ? 'badge-ai' : 'badge-warn'}`}>{aiOn ? `image · ${caps.defaultProvider}` : 'no image key'}</span>
            <span className={`badge ${caps?.analyse ? 'badge-ai' : 'badge-local'}`}>{caps?.analyse ? 'vision · on' : 'vision · off'}</span>
          </div>
        </div>
      </div>

      <div className="statgrid mt">
        <Stat label="my designs" value={history.length} sub="saved in this workspace" />
        <Stat label="covers drawn" value={user.stats?.generations || 0} sub="lifetime" />
        <Stat
          label="render engine"
          value={aiOn ? caps.defaultProvider : 'vector'}
          sub={aiOn ? caps.providers?.find((p) => p.id === caps.defaultProvider)?.imageModel || '' : 'local composer · add a key for AI art'}
        />
        <Stat label="signed in" value={user.displayName.split(' ')[0]} sub={user.isAdmin ? 'admin — keys live in /admin' : `member since ${new Date(user.createdAt).toLocaleDateString()}`} />
      </div>

      {stage === 'upload' && (
        <div className="card mt" style={{ overflow: 'hidden' }}>
          <div className="card-pad">
            <RefDrop onReady={handleReady} busy={analysing} error={analyseError} />
          </div>
          <div className="row" style={{ borderTop: '1px solid var(--line)', padding: '14px 20px', gap: 20, background: 'rgba(0,0,0,.22)' }}>
            {['reads the palette, type & layout', 'checks for a printed company name', 'asks for topic + your insight', 'redraws it in the same taste'].map((t, i) => (
              <span key={t} className="center" style={{ gap: 8, color: 'var(--ink-dim)', fontSize: 13 }}>
                <i style={{ width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--panel-2)', fontSize: 11, fontStyle: 'normal', flex: 'none' }}>
                  {i + 1}
                </i>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {(analysing || (stage === 'read' && !analysis)) && (
        <div className="card card-pad mt stack">
          <div className="center">
            <span className="spin" /> <b>Analysing your reference…</b>
            <span className="muted tiny">palette · type · layout · readable text · brand mark</span>
          </div>
          <Skeleton h={18} style={{ maxWidth: '70%' }} />
          <Skeleton h={18} style={{ maxWidth: '52%' }} />
          <div className="grid-2">
            <Skeleton h={150} />
            <Skeleton h={150} />
          </div>
          {analyseError && <Note kind="bad">{analyseError}</Note>}
        </div>
      )}

      {analysis && !analysing && (
        <div className="mt stack" style={{ gap: 26 }}>
          <div className="card card-pad">
            <AnalysisPanel reference={reference} analysis={analysis} company={company} readiness={readiness} onAnswer={answer} />
          </div>

          <div className="card card-pad" id="brief">
            <BriefForm
              analysis={analysis}
              brief={brief}
              setBrief={(b) => setBrief({ ...b, formatTouched: true })}
              caps={caps}
              profile={user.profile}
              busy={generating}
              focusField={focusField}
              onSubmit={() => generate()}
              onSaveBrandKit={saveBrandKit}
            />
          </div>

          {direction && (
            <Note kind="accent">
              <b>Art direction, from your insight</b>
              <div className="mt-s" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.62 }}>{direction}</div>
            </Note>
          )}

          {warnings.length > 0 && (
            <Note kind="warn">
              {warnings.length} variation(s) failed on the image model{items.length ? ' — the local composer covered them' : ''}: {warnings.map((w) => w.error).join(' | ').slice(0, 240)}
            </Note>
          )}

          <div id="results" className="stack" style={{ gap: 12 }}>
            <div className="between">
              <div>
                <span className="eyebrow">step 4 · results</span>
                <h2 style={{ marginTop: 2 }}>Generated covers</h2>
              </div>
              {runInfo && (
                <span className="center muted tiny" style={{ gap: 8 }}>
                  <Badge kind={runInfo.mode === 'image-model' ? 'ai' : 'local'}>
                    {runInfo.mode === 'image-model' ? `${runInfo.provider} · ${runInfo.model}` : 'local vector composer'}
                  </Badge>
                  {runInfo.count} image{runInfo.count > 1 ? 's' : ''} in {((runInfo.ms || 0) / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {genError && (
              <Note kind="bad">
                <b>{genError.model ? `${genError.model} ishlamadi` : 'Generatsiya bajarilmadi'}</b>
                <div className="mt-s" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{genError.error}</div>
                <div className="row mt" style={{ gap: 8 }}>
                  <Btn size="sm" variant="primary" loading={generating} onClick={() => retryGeneration(false)}>
                    {`Retry with ${genError.model || 'the image model'}`}
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => retryGeneration(true)}>
                    draw it locally instead
                  </Btn>
                </div>
                <div className="muted tiny mt-s">
                  {genError.provider === 'gemini'
                    ? 'Kalit Admin → AI keys bo‘limida saqlanganmi va “enabled” ekanini tekshiring. Base URL https://generativelanguage.googleapis.com/v1beta bo‘lsin.'
                    : 'Provider kaliti va model nomini tekshiring.'}
                </div>
              </Note>
            )}

            <ResultsGrid
              items={items}
              loading={generating}
              trail={trail}
              progress={progress}
              model={runInfo?.model || (caps?.providers?.find((x) => x.id === (brief.provider || caps?.defaultProvider))?.imageModel ?? '')}
              favoriteItemId={favoriteItemId}
              onFavorite={favorite}
              onRemix={async (item, instruction) => {
                await generate({ instruction, iterateOn: item.id });
                toast('Remix added to the top of the grid.', 'good');
              }}
            />
            {items.length === 0 && !generating && (
              <Note>
                Fill the brief and hit <b>Generate</b>. The live draft already shows the layout the vector composer builds; with an image key the model
                renders the finished artwork from the same brief.
              </Note>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt" style={{ marginTop: 34 }}>
          <div className="between">
            <span className="eyebrow">recent in this workspace</span>
            <button className="btn btn-sm btn-ghost" onClick={loadHistory}>
              ↻ refresh
            </button>
          </div>
          <div className="scroll-x mt-s">
            <div style={{ display: 'flex', gap: 12, paddingBottom: 6 }}>
              {history.map((d) => (
                <button
                  key={d.id}
                  className="card"
                  style={{
                    width: 196,
                    flex: 'none',
                    padding: 0,
                    overflow: 'hidden',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: d.id === designId ? '1px solid rgba(124,92,255,.65)' : '1px solid var(--line)',
                  }}
                  onClick={() => openFromHistory(d)}
                >
                  <div style={{ aspectRatio: '4/3', background: '#0b0e16', position: 'relative' }}>
                    {d.refUrl ? (
                      <img src={authedSrc(d.refUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(140deg, ${d.palette?.[0] || '#232838'}, ${d.palette?.[1] || '#0d1018'})` }} />
                    )}
                    <div className="preview-tag">
                      <span className="badge badge-local" style={{ background: 'rgba(6,8,15,.8)' }}>
                        {d.counts?.ai || 0} ai · {d.counts?.local || 0} vec
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '9px 11px' }}>
                    <b className="fs-13" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.title || 'untitled'}
                    </b>
                    <span className="muted tiny">
                      {d.archetype || d.formatLabel} · {new Date(d.updatedAt || d.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <Shell>
        <StudioInner />
      </Shell>
    </Suspense>
  );
}