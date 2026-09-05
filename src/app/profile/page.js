'use client';
/**
 * Profile — the creator's identity, brand kit, saved reference covers (the
 * "example post" bank the studio can reuse) and their own provider keys.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { useApp } from '@/components/session';
import { Badge, Btn, Field, Modal, Note, SelectInput, Stat, SwatchPicker, Tabs, TextArea, TextInput } from '@/components/ui';
import { FORMATS } from '@/lib/prompts';
import { MODEL_HINTS } from '@/lib/providers';
import { authedSrc } from '@/components/session';

function ProfileInner() {
  const { user, caps, api, toast, refresh } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState('brand');
  const [profile, setProfile] = useState(user?.profile || {});
  const [designs, setDesigns] = useState([]);
  const [saving, setSaving] = useState(false);
  const [keyDraft, setKeyDraft] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (user?.profile) setProfile(user.profile);
  }, [user]);

  const loadDesigns = useCallback(async () => {
    try {
      const d = await api('/designs?limit=40');
      setDesigns(d.designs || []);
    } catch {
      /* ignore */
    }
  }, [api]);

  useEffect(() => {
    if (user) loadDesigns();
  }, [user, loadDesigns]);

  if (!user) return null;

  const save = async () => {
    setSaving(true);
    try {
      await api('/profile', { method: 'PUT', body: profile });
      await refresh();
      toast('Profile saved.', 'good');
    } finally {
      setSaving(false);
    }
  };

  const removeRef = async (file) => {
    await api('/profile', {
      method: 'PUT',
      body: { ...profile, references: (profile.references || []).filter((r) => r.file !== file) },
    });
    refresh();
    toast('Reference removed.', 'info');
  };

  return (
    <>
      <div className="card card-pad">
        <div className="between wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
          <div className="center" style={{ gap: 14 }}>
            <span
              className="avatar"
              style={{
                width: 62,
                height: 62,
                fontSize: 21,
                borderRadius: 20,
                '--hue': (String(user.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 23) % 360,
              }}
            >
              {`${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase()}
            </span>
            <div>
              <h1 style={{ fontSize: 26 }}>
                {user.displayName} {user.isAdmin && <Badge kind="admin">admin</Badge>}
              </h1>
              <p className="muted tiny mt-s">
                id <code>{user.id}</code> · joined {new Date(user.createdAt).toLocaleDateString()} · signed in {user.logins}× · last seen{' '}
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'now'}
              </p>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href="/studio">→ open studio</Link>
            {user.isAdmin && (
              <Link className="btn" href="/admin">
                admin panel
              </Link>
            )}
          </div>
        </div>
        <div className="statgrid mt">
          <Stat label="designs" value={designs.length} sub="analysed references" />
          <Stat label="covers" value={user.stats?.generations || 0} sub="generated" />
          <Stat label="saved refs" value={(profile.references || []).length} sub="in your brand bank" />
          <Stat
            label="key in use"
            value={Object.keys(user.keys || {}).length ? 'own' : caps?.image ? 'workspace' : 'none'}
            sub={caps?.image ? `default · ${caps.defaultProvider}` : 'local vector composer'}
          />
        </div>
      </div>

      <div className="mt">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'brand', label: '🎨 Brand kit' },
            { value: 'refs', label: '🗂 Reference bank', count: (profile.references || []).length },
            { value: 'keys', label: '🔑 My keys' },
            { value: 'history', label: '🕑 History', count: designs.length },
          ]}
        />
      </div>

      {tab === 'brand' && (
        <div className="card card-pad stack" style={{ maxWidth: 860 }}>
          <div>
            <span className="eyebrow">brand kit</span>
            <p className="muted tiny mt-s">
              Shu maydonlar studio brief’ini avtomatik to’ldiradi — har safar nom va ohangni qayta yozmaysiz. These prefill the brief in the studio.
            </p>
          </div>
          <div className="grid-2">
            <Field label="Company / brand">
              <TextInput value={profile.company || ''} onChange={(e) => setProfile({ ...profile, company: e.target.value })} placeholder="Nova Agency" />
            </Field>
            <Field label="Tagline">
              <TextInput value={profile.tagline || ''} onChange={(e) => setProfile({ ...profile, tagline: e.target.value })} placeholder="growth systems for small brands" />
            </Field>
            <Field label="Niche / what you sell">
              <TextInput value={profile.niche || ''} onChange={(e) => setProfile({ ...profile, niche: e.target.value })} placeholder="short-form video for DTC brands" />
            </Field>
            <Field label="Audience">
              <TextInput value={profile.audience || ''} onChange={(e) => setProfile({ ...profile, audience: e.target.value })} placeholder="founders, 25-40" />
            </Field>
            <Field label="Default tone">
              <TextInput value={profile.tone || ''} onChange={(e) => setProfile({ ...profile, tone: e.target.value })} placeholder="premium, direct, a bit playful" />
            </Field>
            <Field label="Default format">
              <SelectInput
                value={profile.defaultFormat || 'post-1x1'}
                onChange={(v) => setProfile({ ...profile, defaultFormat: v })}
                options={FORMATS.map((f) => ({ value: f.id, label: f.label }))}
              />
            </Field>
            <Field label="Handles / contact line">
              <TextInput value={profile.handles || ''} onChange={(e) => setProfile({ ...profile, handles: e.target.value })} placeholder="@nova.agency · tashkent" />
            </Field>
            <Field label="Website">
              <TextInput value={profile.website || ''} onChange={(e) => setProfile({ ...profile, website: e.target.value })} placeholder="nova.agency" />
            </Field>
          </div>
          <Field label="Brand colours" hint="Drag the colour squares to edit; these steer the palette when a reference has none.">
            <SwatchPicker colors={profile.brandColors || []} onChange={(c) => setProfile({ ...profile, brandColors: c })} />
          </Field>
          <div className="row">
            <Btn variant="primary" loading={saving} onClick={save}>
              save profile
            </Btn>
            <Btn variant="ghost" onClick={() => setProfile(user.profile || {})}>
              revert
            </Btn>
          </div>
        </div>
      )}

      {tab === 'refs' && (
        <div className="stack">
          <Note>
            Your saved favourite covers. Drop one into the studio as a style donor, or keep it as a reference for the team. Saqlangan eng yaxshi
            natijalar shu yerda turadi.
          </Note>
          {(profile.references || []).length === 0 ? (
            <div className="card card-pad t-c" style={{ padding: 42 }}>
              <div style={{ fontSize: 30 }}>🖼️</div>
              <h3 className="mt-s">Nothing saved yet</h3>
              <p className="muted tiny mt-s">Hit ★ on any generated cover in the studio and it lands here.</p>
              <Link className="btn btn-primary mt" href="/studio">
                go to studio →
              </Link>
            </div>
          ) : (
            <div className="results">
              {(profile.references || []).map((r) => (
                <div key={r.id} className="art">
                  <div className="frame">
                    <img src={authedSrc(`/api/file/${r.file}`)} alt={r.label || 'saved reference'} />
                  </div>
                  <div className="bar">
                    <div className="meta">
                      <b>{r.label || 'saved cover'}</b>
                      <span>{r.note || 'from studio favourite'}</span>
                    </div>
                    <button className="iconbtn" title="remove" onClick={() => removeRef(r.file)}>
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'keys' && (
        <div className="stack" style={{ maxWidth: 860 }}>
          {!caps?.allowSelfServeKeys ? (
            <Note kind="warn">
              The admin disabled personal keys for this workspace — you are using the shared keys. / Admin shaxsiy kalitlarni o‘chirib qo‘ygan.
            </Note>
          ) : (
            <Note kind="accent">
              Bring your own key and your generations run on your account (it wins over the workspace key in the studio). Stored encrypted, only the
              last 4 characters are shown back.
            </Note>
          )}
          {(caps?.providers || []).map((p) => {
            const own = user.keys?.[p.id]?.hasKey;
            return (
              <div key={p.id} className="card card-pad">
                <div className="between wrap">
                  <div>
                    <h3>
                      {p.label} {own && <Badge kind="local">own key set</Badge>}
                    </h3>
                    <span className="muted tiny">
                      {p.imageModel ? `image: ${p.imageModel}` : 'no image model'} · vision: {p.visionModel || '—'}
                    </span>
                  </div>
                  {own && (
                    <Btn
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        await api('/keys', { method: 'DELETE', body: { providerId: p.id } });
                        refresh();
                        toast('Own key removed.', 'info');
                      }}
                    >
                      remove
                    </Btn>
                  )}
                </div>
                <div className="grid-2 mt">
                  <Field label="API key" hint={MODEL_HINTS[p.id]?.key}>
                    <TextInput
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={own ? `replace ${user.keys[p.id].fingerprint}…` : 'paste your key…'}
                      value={keyDraft[p.id] || ''}
                      onChange={(e) => setKeyDraft({ ...keyDraft, [p.id]: e.target.value })}
                    />
                  </Field>
                  <Field label="Optional: override image model">
                    <TextInput
                      placeholder={p.imageModel || ''}
                      value={keyDraft[`${p.id}:image`] || ''}
                      onChange={(e) => setKeyDraft({ ...keyDraft, [`${p.id}:image`]: e.target.value })}
                    />
                  </Field>
                </div>
                <Btn
                  variant="primary"
                  size="sm"
                  disabled={!String(keyDraft[p.id] || '').trim()}
                  onClick={async () => {
                    await api('/keys', {
                      method: 'PUT',
                      body: { providerId: p.id, apiKey: keyDraft[p.id].trim(), imageModel: keyDraft[`${p.id}:image`] || undefined },
                    });
                    setKeyDraft({ ...keyDraft, [p.id]: '', [`${p.id}:image`]: '' });
                    refresh();
                    toast(`${p.label} key saved.`, 'good');
                  }}
                >
                  save my key
                </Btn>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'history' && (
        <div className="stack">
          {!designs.length ? (
            <Note>No designs yet — generate something in the studio first.</Note>
          ) : (
            <div className="results">
              {designs.map((d) => (
                <div key={d.id} className="art">
                  <div className="frame" style={{ minHeight: 150 }}>
                    {d.items?.[0]?.url ? (
                      <img src={authedSrc(d.items[0].url)} alt={d.title} />
                    ) : d.refUrl ? (
                      <img src={authedSrc(d.refUrl)} alt={d.title} style={{ filter: 'saturate(.9)' }} />
                    ) : (
                      <div style={{ width: '100%', height: 150, background: `linear-gradient(140deg,${d.palette?.[0] || '#222'},${d.palette?.[1] || '#111'})` }} />
                    )}
                  </div>
                  <div className="bar">
                    <div className="meta">
                      <b>{d.title || 'untitled'}</b>
                      <span>
                        {new Date(d.updatedAt || d.createdAt).toLocaleDateString()} · {d.counts?.ai || 0} ai · {d.counts?.local || 0} vec
                      </span>
                    </div>
                    <button className="iconbtn" title="open in studio" onClick={() => router.push(`/studio?open=${d.id}`)}>
                      ↗
                    </button>
                    <button className="iconbtn" title="delete design" onClick={() => setConfirmDelete(d)}>
                      🗑
                    </button>
                  </div>
                  {d.styleTags?.length > 0 && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {d.styleTags.slice(0, 3).map((t) => (
                        <span key={t} className="chip chip-static" style={{ fontSize: 11 }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this design?">
        <div className="stack">
          <p className="muted">
            “{confirmDelete?.title}” and its {confirmDelete?.items?.length || 0} generated file(s) will be removed from disk. This cannot be undone.
          </p>
          <div className="row">
            <Btn
              variant="danger"
              onClick={async () => {
                await api('/designs', { method: 'DELETE', body: { id: confirmDelete.id } });
                setConfirmDelete(null);
                loadDesigns();
                toast('Design deleted.', 'info');
              }}
            >
              delete
            </Btn>
            <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>
              cancel
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function ProfilePage() {
  return (
    <Shell>
      <ProfileInner />
    </Shell>
  );
}