'use client';
/**
 * Step 3 — the brief. Company name (pre-filled when it was printed in the
 * reference), the topic of the reel/post, format, and one free-text box that
 * carries the creator's own insight. The vector draft on the right is rendered
 * live from those answers, so you can see the composition move as you type.
 */
import { useEffect, useMemo, useState } from 'react';
import { FORMATS, buildGenerationPrompt } from '@/lib/prompts';
import { renderCover } from '@/lib/localRender';
import { svgToDataUrl, exportPng } from '@/lib/clientImage';
import { Badge, Btn, ChipToggle, Copy, Field, Note, SelectInput, Stepper, TextArea, TextInput } from '@/components/ui';

const TONES = ['premium', 'bold', 'minimal', 'playful', 'techy', 'luxury', 'street', 'editorial', 'warm', 'urgent'];

export default function BriefForm({ analysis, brief, setBrief, caps, busy, onSubmit, onSaveBrandKit, profile, focusField }) {
  const [wire, setWire] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!focusField) return;
    const el = document.querySelector(`[data-field="${focusField}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }
  }, [focusField]);
  const set = (k, v) => setBrief({ ...brief, [k]: v });
  const toggleTone = (t) => {
    const list = String(brief.tone || '').split(',').map((s) => s.trim()).filter(Boolean);
    set('tone', (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]).join(', '));
  };

  const draft = useMemo(() => {
    try {
      return renderCover({ analysis, brief, variation: 0, format: brief.format, wireframe: wire });
    } catch {
      return null;
    }
  }, [analysis, brief, wire]);

  const draftUrl = draft ? svgToDataUrl(draft.svg) : '';
  const promptPreview = useMemo(() => {
    try {
      return buildGenerationPrompt({ analysis, brief: { ...brief, count: 1 }, variation: 0 });
    } catch {
      return '';
    }
  }, [analysis, brief]);

  const missing = !brief.headline && !brief.topic?.trim();
  const noKey = !caps?.image;

  return (
    <div className="studio-grid">
      <div className="stack">
        <div className="card card-pad stack">
          <div className="between">
            <div>
              <span className="eyebrow">step 3 · your brief</span>
              <h3 style={{ marginTop: 2 }}>What should the new piece say?</h3>
            </div>
            {analysis?.companyName && <Badge kind="ai">name pre-filled</Badge>}
          </div>

          <div className="grid-2">
            <Field label="Company / brand name" hint={analysis?.companyName ? `Read from the reference: ${analysis.companyName}` : 'Not found in the reference — type it in.'}>
              <TextInput data-field="companyName" value={brief.companyName || ''} onChange={(e) => set('companyName', e.target.value)} placeholder="Nova Agency" maxLength={60} />
            </Field>
            <Field label="Kicker (small line above)">
              <TextInput data-field="kicker" value={brief.kicker || ''} onChange={(e) => set('kicker', e.target.value)} placeholder="new episode · drop 04" maxLength={60} />
            </Field>
          </div>

          <Field
            label="Topic of the reel / post"
            hint="Mavzu — nima haqida? Bir gap yetadi. Sarlavha bo‘sh bo‘lsa, shu mavzudan yozamiz."
          >
            <TextArea
              data-field="topic"
              value={brief.topic || ''}
              onChange={(e) => set('topic', e.target.value)}
              placeholder="Reel about how we rebuilt a coffee brand’s feed in 7 days — before/after, 3 hooks, results."
              style={{ minHeight: 74 }}
              maxLength={600}
            />
          </Field>

          <div className="grid-2">
            <Field label="Headline (exact wording)">
              <TextInput data-field="headline" value={brief.headline || ''} onChange={(e) => set('headline', e.target.value)} placeholder="GROWTH IS A SYSTEM" maxLength={90} />
            </Field>
            <Field label="Sub-headline">
              <TextInput data-field="subhead" value={brief.subhead || ''} onChange={(e) => set('subhead', e.target.value)} placeholder="Weekly reels that compound" maxLength={120} />
            </Field>
          </div>

          <div className="grid-2">
            <Field label="CTA / button">
              <TextInput data-field="cta" value={brief.cta || ''} onChange={(e) => set('cta', e.target.value)} placeholder="WATCH EP. 12" maxLength={40} />
            </Field>
            <Field label="Footer line (date · price · handle)">
              <TextInput data-field="footer" value={brief.footer || ''} onChange={(e) => set('footer', e.target.value)} placeholder="@nova.agency · tashkent" maxLength={80} />
            </Field>
          </div>

          <div className="hr" style={{ margin: '4px 0' }} />

          <Field label="Format">
            <div className="chips">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className="chip"
                  data-on={brief.format === f.id}
                  onClick={() => set('format', f.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <i
                    style={{
                      display: 'block',
                      width: f.css === '1 / 1' ? 13 : 13,
                      height: 13,
                      aspectRatio: f.css,
                      background: brief.format === f.id ? '#fff' : 'var(--line-strong)',
                      borderRadius: 3,
                      maxHeight: 17,
                      maxWidth: 26,
                    }}
                  />
                  {f.label} <span className="muted" style={{ fontSize: 11 }}>{f.gemini}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Tone">
            <div className="chips">
              {TONES.map((t) => (
                <ChipToggle key={t} on={String(brief.tone || '').includes(t)} onClick={() => toggleTone(t)}>
                  {t}
                </ChipToggle>
              ))}
            </div>
          </Field>

          <div className="grid-2">
            <Field label="Audience">
              <TextInput data-field="audience" value={brief.audience || ''} onChange={(e) => set('audience', e.target.value)} placeholder="founders of small DTC brands" maxLength={120} />
            </Field>
            <Field label="Offer / proof (optional)">
              <TextInput data-field="offer" value={brief.offer || ''} onChange={(e) => set('offer', e.target.value)} placeholder="free audit, 3 ideas in 48h" maxLength={140} />
            </Field>
          </div>

          <Field
            label="Your insight"
            badge={<Badge kind="local">the important one</Badge>}
            hint="Bu bitta prompt — sizning ichki fikringiz. Kim uchun, nimaga isontirish kerak, qanday his qoldirsin. Batafsil yozsangiz, dizayn shuncha aniq chiqadi."
          >
            <TextArea
              data-field="insight"
              value={brief.insight || ''}
              onChange={(e) => set('insight', e.target.value)}
              placeholder="Owners are tired of pretty-but-empty posts. I want this cover to feel like a system that makes money — proof first, not vibes. The one thing they must remember: 7 days, 3 hooks, real numbers."
              style={{ minHeight: 116 }}
              maxLength={2400}
            />
            <span className="hint" style={{ textAlign: 'right' }}>
              {(brief.insight || '').length} chars
            </span>
          </Field>

          <div className="between wrap" style={{ gap: 14 }}>
            <Field label="Variations">
              <div className="center">
                <Stepper value={brief.count} min={1} max={caps?.maxVariations || 4} onChange={(n) => set('count', n)} />
                <span className="muted tiny">× {brief.count}</span>
              </div>
            </Field>
            <Field label="Render mode">
              <SelectInput
                value={brief.mode || 'auto'}
                onChange={(v) => set('mode', v)}
                options={[
                  { value: 'auto', label: noKey ? 'auto → local vector (no image key)' : 'auto → AI image model' },
                  { value: 'ai', label: 'AI image model only' },
                  { value: 'local', label: 'local vector composer' },
                ]}
              />
            </Field>
            {caps?.providers?.filter((p) => p.hasKey).length > 1 && (
              <Field label="Provider">
                <SelectInput
                  value={brief.provider || caps.defaultProvider || ''}
                  onChange={(v) => set('provider', v)}
                  options={[
                    { value: '', label: `default (${caps.defaultProvider})` },
                    ...caps.providers.filter((p) => p.hasKey).map((p) => ({ value: p.id, label: `${p.label} · ${p.imageModel}` })),
                  ]}
                />
              </Field>
            )}
          </div>

          {missing && <Note kind="warn">Topic yoki headline — kamida bittasini yozing. / Give it a topic or a headline.</Note>}

          <div className="between wrap" style={{ gap: 10 }}>
            <Btn variant="primary" size="lg" loading={busy} onClick={onSubmit} disabled={missing}>
              {busy ? 'Drawing…' : `Generate ${brief.count} cover${brief.count > 1 ? 's' : ''} →`}
            </Btn>
            <div className="center" style={{ gap: 8 }}>
              <Btn variant="ghost" size="sm" onClick={() => setShowPrompt((v) => !v)}>
                {showPrompt ? 'hide prompt' : 'prompt preview'}
              </Btn>
              {profile && (
                <Btn variant="ghost" size="sm" onClick={onSaveBrandKit}>
                  save as my brand kit
                </Btn>
              )}
            </div>
          </div>

          {showPrompt && (
            <div>
              <div className="between">
                <span className="eyebrow">exact text handed to the model</span>
                <Copy text={promptPreview} />
              </div>
              <pre
                style={{
                  background: 'rgba(0,0,0,.4)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: 12,
                  maxHeight: 220,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {promptPreview}
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="stack sticky">
        <div className="card">
          <div className="card-head">
            <h3 style={{ flex: 1 }}>Live draft</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => setWire((w) => !w)}>
              {wire ? 'show art' : 'safe zones'}
            </button>
          </div>
          <div className="card-pad stack">
            {draftUrl && (
              <div className="preview">
                <img src={draftUrl} alt="live vector draft" />
              </div>
            )}
            <div className="between wrap">
              <span className="muted tiny">
                {draft ? `${draft.width}×${draft.height} · ${draft.archetype}` : '—'} · composed from your answers
              </span>
              <div className="center" style={{ gap: 6 }}>
                <Btn size="sm" variant="ghost" onClick={() => draftUrl && exportPng(draftUrl, `${(brief.companyName || "studio")}-draft.png`)}>
                  ⤓ png
                </Btn>
              </div>
            </div>
            <Note kind={noKey ? 'warn' : 'info'}>
              {noKey
                ? 'No image-model key in this workspace yet, so “Generate” will use this vector composer. Add a key in Admin → Providers for photographic/illustrated renders. Bu rejimda ham real palitra va layout ishlatiladi.'
                : `The vector draft is a preview of layout & hierarchy. Generation uses ${caps?.providers?.find((p) => p.id === (brief.provider || caps?.defaultProvider))?.imageModel || 'the image model'} for the finished art.`}
            </Note>
          </div>
        </div>
      </div>
    </div>
  );
}
