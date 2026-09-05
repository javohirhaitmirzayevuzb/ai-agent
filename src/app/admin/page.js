'use client';
/**
 * Admin panel — unlocked only when name is "javohir" and surname is "ali".
 * This is where the workspace's AI keys live: save/replace a provider key, point
 * it at a different base URL or model, probe it, and switch which provider the
 * studio defaults to. Plus user and activity oversight.
 */
import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/shell';
import { useApp } from '@/components/session';
import { Badge, Btn, Field, Modal, Note, SelectInput, Stat, Switch, Tabs, TextInput } from '@/components/ui';

import { MODEL_HINTS } from '@/lib/providers';
import { normalizeApiKey } from '@/lib/keyFormat';

function ProviderCard({ p, isDefault, onSave, onTest, onClear, onMakeDefault, busy }) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [models, setModels] = useState({ visionModel: p.visionModel || '', textModel: p.textModel || '', imageModel: p.imageModel || '' });
  const [baseUrl, setBaseUrl] = useState(p.baseUrl || '');
  const [enabled, setEnabled] = useState(p.enabled);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const hints = MODEL_HINTS[p.id] || {};

  useEffect(() => {
    setModels({ visionModel: p.visionModel || '', textModel: p.textModel || '', imageModel: p.imageModel || '' });
    setBaseUrl(p.baseUrl || '');
    setEnabled(p.enabled);
    setTest(null);
  }, [p]);

  const save = async (withTest) => {
    const clean = normalizeApiKey(key);
    setKeyError(clean.error);
    if (clean.error) return;
    if (clean.value !== key) setKey(clean.value);
    setBusy?.(p.id, true);
    const payload = { providerId: p.id, enabled, baseUrl, ...models, setAsDefault: isDefault };
    if (clean.value) payload.apiKey = clean.value;
    try {
      // persist FIRST — a connectivity probe can be slow or unreachable, and that must
      // never be able to cost the user the save they just asked for
      await onSave(payload);
      setSavedAt(new Date().toLocaleTimeString());
      setKey('');
      if (withTest) {
        setTesting(true);
        try {
          setTest(await onTest({ providerId: p.id }));
        } catch (e) {
          setTest({ ok: false, checks: [{ kind: 'key', ok: false, note: String(e?.message || e) }] });
        } finally {
          setTesting(false);
        }
      }
    } catch (e) {
      setKeyError(String(e?.message || e));
    } finally {
      setBusy?.(p.id, false);
    }
  };

  const ready = p.hasKey && p.enabled;

  const runTestOnly = async () => {
    setTesting(true);
    try {
      setTest(await onTest({ providerId: p.id }));
    } catch (e) {
      setTest({ ok: false, checks: [{ kind: 'key', ok: false, note: String(e?.message || e) }] });
    } finally {
      setTesting(false);
    }
  };

  return (
    // a <form> so Enter/Return in the key field saves — the way every other settings UI works
    <form
      className="card"
      style={{ borderColor: ready ? 'rgba(53,224,138,.28)' : 'var(--line)' }}
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <div className="card-head">
        <span
          className="avatar"
          style={{
            background:
              p.id === 'gemini'
                ? 'linear-gradient(135deg,#4285f4,#34a853)'
                : p.id === 'openai'
                  ? 'linear-gradient(135deg,#10a37f,#0b6e5a)'
                  : 'linear-gradient(135deg,#7c5cff,#22e3c4)',
            color: '#fff',
            width: 26,
            height: 26,
            borderRadius: 8,
          }}
        >
          {p.label[0]}
        </span>
        <div style={{ flex: 1 }}>
          <h3 style={{ lineHeight: 1.2 }}>{p.label}</h3>
          <span className="muted tiny">
            {p.hasKey ? `key ${p.masked || '••••'}${p.updatedAt ? ` · updated ${new Date(p.updatedAt).toLocaleDateString()}` : ''}` : 'no key yet'}
            {p.scope === 'own key' ? ' · per-user keys allowed' : ''}
          </span>
        </div>
        {isDefault && <Badge kind="ai">default</Badge>}
        <Badge kind={ready ? 'local' : 'warn'}>{ready ? 'ready' : p.enabled ? 'needs key' : 'disabled'}</Badge>
      </div>

      <div className="card-pad stack">
        {hints.note && <p className="muted tiny" style={{ marginTop: 0 }}>{hints.note}</p>}
        <Field label="API key" hint={p.hasKey ? 'Saqlangan — yangi kalit yozsangiz almashtiriladi. / Paste a new key to replace it.' : hints.key}>
          <div className="center" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              type={show ? 'text' : 'password'}
              value={key}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setKey(e.target.value);
                if (keyError) setKeyError('');
              }}
              onPaste={() => setTimeout(() => setKeyError(''), 0)}
              placeholder={p.hasKey ? `replace ${p.masked || '••••'}…` : 'paste key, then Enter'}
            />
            <button className="iconbtn" title={show ? 'hide' : 'reveal'} onClick={() => setShow((s) => !s)}>
              {show ? '🙈' : '👁'}
            </button>
          </div>
        </Field>

        <div className="grid-3">
          {['visionModel', 'textModel', 'imageModel'].map((m) => (
            <Field key={m} label={m.replace('Model', '') + ' model'}>
              <TextInput value={models[m]} placeholder={hints[m]} onChange={(e) => setModels({ ...models, [m]: e.target.value })} spellCheck={false} />
            </Field>
          ))}
        </div>

        <Field label="Base URL" hint={p.id === 'custom' ? 'Masalan: https://gateway.example.com/v1' : 'OpenAI-compatible gateway yoki proxy bo‘lsa o‘zgartiring.'}>
          <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </Field>

        <div className="between wrap">
          <Switch checked={enabled} onChange={setEnabled} label="Enabled for the workspace" />
          {!isDefault && p.hasKey && (
            <button className="chip" onClick={() => onMakeDefault(p.id)}>
              ★ make default
            </button>
          )}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <Btn type="submit" variant="primary" size="sm" loading={busy === p.id}>
            {key.trim() ? 'save key' : 'save'}
          </Btn>
          <Btn variant="ghost" size="sm" disabled={busy === p.id} loading={testing} onClick={() => (key.trim() ? save(true) : runTestOnly())}>
            {key.trim() ? 'save & test' : 'test'}
          </Btn>
          {p.hasKey && (
            <Btn variant="danger" size="sm" onClick={() => onClear(p.id)}>
              remove key
            </Btn>
          )}
        </div>

        {keyError && <Note kind="bad">{keyError}</Note>}
        {!keyError && savedAt && !key.trim() && (
          <Note kind="good">
            Saved {savedAt}. Saqlandi. {p.masked ? ` Key ${p.masked}.` : ''}
          </Note>
        )}

        {test && (
          <div className="stack">
            {test.error && <Note kind="bad">{test.error}</Note>}
            <div className="stack" style={{ gap: 6 }}>
              {(test.checks || []).map((c, i) => (
                <div key={i} className="keyline" style={{ borderColor: c.ok ? 'rgba(53,224,138,.35)' : 'rgba(255,107,107,.35)' }}>
                  <span style={{ width: 62, color: 'var(--muted)' }}>{c.kind}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.model}</span>
                  <span style={{ color: c.ok ? 'var(--good)' : 'var(--bad)' }}>{c.ok ? '✓' : '✕'}</span>
                  <span style={{ color: 'var(--muted)', width: 56, textAlign: 'right' }}>{c.ms ? `${(c.ms / 1000).toFixed(1)}s` : ''}</span>
                  <span className="muted" style={{ width: 190, textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.note}>
                    {c.note}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

function AdminInner() {
  const { user, api, toast, refresh } = useApp();
  const [tab, setTab] = useState('keys');
  const [providers, setProviders] = useState([]);
  const [settings, setSettings] = useState({ defaultProvider: 'gemini', allowSelfServeKeys: true, refinePrompt: true, maxVariations: 4, appName: 'Studio' });
  const [users, setUsers] = useState([]);
  const [totals, setTotals] = useState({});
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // allSettled: a single failing endpoint must not blank the whole panel
      const [p, u, e] = await Promise.allSettled([api('/admin/providers'), api('/admin/users'), api('/admin/events?limit=60')]);
      if (p.status === 'rejected') return;
      setProviders(p.value.providers || []);
      setSettings({
        defaultProvider: p.value.defaultProvider,
        allowSelfServeKeys: p.value.allowSelfServeKeys,
        refinePrompt: p.value.refinePrompt,
        maxVariations: p.value.maxVariations,
        appName: p.value.appName || 'Studio',
      });
      if (u.status === 'fulfilled') {
        setUsers(u.value.users || []);
        setTotals(u.value.totals || {});
      }
      if (e.status === 'fulfilled') setEvents(e.value.events || []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (user?.isAdmin) load();
  }, [user, load]);

  if (!user) return null;
  if (!user.isAdmin) {
    return (
      <Note kind="bad">
        <b>Admin access is closed for this account.</b>
        <div className="mt-s tiny">
          Panel faqat <code>name = javohir</code> va <code>surname = ali</code> bo‘lganda ochiladi. Ask that account to sign in, or ask it to grant you
          admin from Users.
        </div>
      </Note>
    );
  }

  const saveProviders = async (payload) => {
    await api('/admin/providers', { method: 'PUT', body: payload });
    await load();
    await refresh();
    toast(`${payload.providerId} updated.`, 'good');
  };
  const testProvider = async (payload) => {
    try {
      const res = await api('/admin/test', { method: 'POST', body: payload, silent: true });
      return res.test || { ok: false, checks: [{ kind: 'key', ok: false, note: res.error }] };
    } catch (e) {
      return { ok: false, checks: [{ kind: 'key', ok: false, note: e.message }] };
    }
  };

  const readyCount = providers.filter((p) => p.hasKey && p.enabled).length;
  const withImage = providers.filter((p) => p.hasKey && p.enabled && p.imageModel).length;

  return (
    <>
      <div className="between wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <span className="eyebrow">admin · {user.displayName}</span>
          <h1 style={{ marginTop: 4 }}>Workspace control</h1>
          <p className="lead mt-s">
            Keys are encrypted at rest, only the last 4 characters are ever shown, and users never see them — they just inherit whatever is enabled
            here.
          </p>
        </div>
        <div className="center" style={{ gap: 8 }}>
          <Btn variant="ghost" size="sm" onClick={load} loading={loading}>
            ↻ reload
          </Btn>
        </div>
      </div>

      <div className="statgrid mt">
        <Stat label="providers ready" value={`${readyCount}/${providers.length}`} sub={`${withImage} with an image model`} />
        <Stat label="members" value={totals.users ?? '—'} sub={`${totals.admins ?? 0} admin`} />
        <Stat label="designs" value={totals.designs ?? '—'} sub="analysed references" />
        <Stat label="covers drawn" value={totals.generations ?? '—'} sub="all users" />
      </div>

      <div className="mt">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'keys', label: '🔑 AI keys' },
            { value: 'behaviour', label: '⚙️ Studio behaviour' },
            { value: 'users', label: '👥 Users', count: users.length },
            { value: 'activity', label: '📜 Activity', count: events.length },
          ]}
        />
      </div>

      {tab === 'keys' && (
        <div className="stack">
          {!providers.some((p) => p.hasKey) && (
            <Note kind="warn">
              <b>No AI key yet.</b> Paste a Google Gemini key below and the studio instantly gets both vision analysis and image generation — one key
              covers the whole flow. Until then the studio runs in local-vector mode.
            </Note>
          )}
          <div className="grid-2">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                p={p}
                busy={busy}
                setBusy={(id, v) => setBusy(v ? id : '')}
                isDefault={settings.defaultProvider === p.id}
                onSave={saveProviders}
                onTest={testProvider}
                onMakeDefault={async (id) => {
                  await api('/admin/settings', { method: 'PUT', body: { defaultProvider: id } });
                  load();
                  refresh();
                  toast(`Default provider → ${id}`, 'good');
                }}
                onClear={setConfirmClear}
              />
            ))}
          </div>
          <Note>
            <b>How the studio chooses a key:</b> a user’s own key wins, then the default provider above, then any other enabled provider with a key.
            Vision + text + image models are resolved independently, so you can analyse with Gemini and render with OpenAI.
          </Note>
        </div>
      )}

      {tab === 'behaviour' && (
        <div className="card card-pad stack" style={{ maxWidth: 720 }}>
          <Field label="Workspace name">
            <div className="center" style={{ gap: 8 }}>
              <TextInput
                value={settings.appName}
                onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
                onBlur={() => api('/admin/settings', { method: 'PUT', body: { appName: settings.appName } })}
                maxLength={40}
              />
            </div>
          </Field>
          <Field label="Default provider">
            <SelectInput
              value={settings.defaultProvider}
              onChange={async (v) => {
                setSettings({ ...settings, defaultProvider: v });
                await api('/admin/settings', { method: 'PUT', body: { defaultProvider: v } });
                load();
              }}
              options={providers.map((p) => ({ value: p.id, label: `${p.label}${p.hasKey ? '' : ' (no key)'}` }))}
            />
          </Field>
          <Field label="Max variations per run" hint="1–4. Higher is slower and costs more per click.">
            <SelectInput
              value={String(settings.maxVariations)}
              onChange={async (v) => {
                setSettings({ ...settings, maxVariations: Number(v) });
                await api('/admin/settings', { method: 'PUT', body: { maxVariations: Number(v) } });
              }}
              options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} cover${n > 1 ? 's' : ''}` }))}
            />
          </Field>
          <div className="hr" />
          <Switch
            checked={settings.allowSelfServeKeys}
            onChange={async (v) => {
              setSettings({ ...settings, allowSelfServeKeys: v });
              await api('/admin/settings', { method: 'PUT', body: { allowSelfServeKeys: v } });
              toast(v ? 'Members may add their own key.' : 'Member keys disabled — workspace key only.', 'info');
            }}
            label="Let members bring their own API key (Profile → Keys)"
          />
          <Switch
            checked={settings.refinePrompt}
            onChange={async (v) => {
              setSettings({ ...settings, refinePrompt: v });
              await api('/admin/settings', { method: 'PUT', body: { refinePrompt: v } });
              toast(v ? 'Art-director pass enabled.' : 'Art-director pass skipped — faster.', 'info');
            }}
            label="Art-director pass (turn the user’s insight into written direction before drawing)"
          />
        </div>
      )}

      {tab === 'users' && (
        <div className="card">
          <div className="card-head">
            <h3 style={{ flex: 1 }}>Members</h3>
            <input className="input" style={{ maxWidth: 220 }} placeholder="filter…" onChange={(e) => api(`/admin/users?q=${encodeURIComponent(e.target.value)}`).then((d) => setUsers(d.users || []))} />
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>name</th>
                  <th>role</th>
                  <th className="num">designs</th>
                  <th className="num">covers</th>
                  <th className="num">logins</th>
                  <th>own key</th>
                  <th>last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.displayName}</b>
                      <div className="muted tiny mono">{u.id}</div>
                    </td>
                    <td>{u.isAdmin ? <Badge kind="admin">admin</Badge> : <span className="muted">member</span>}</td>
                    <td className="num">{u.designs}</td>
                    <td className="num">{u.stats?.generations || 0}</td>
                    <td className="num">{u.logins}</td>
                    <td className="tiny muted">{Object.keys(u.ownKeyProviders || {}).join(', ') || '—'}</td>
                    <td className="tiny muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          await api('/admin/users', { method: 'PATCH', body: { userId: u.id, role: u.isAdmin ? 'user' : 'admin' } });
                          load();
                          toast(`${u.displayName} is now ${u.isAdmin ? 'a member' : 'an admin'}.`, 'good');
                        }}
                      >
                        {u.isAdmin ? 'revoke admin' : 'make admin'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!users.length && (
                  <tr>
                    <td colSpan={8} className="muted t-c" style={{ padding: 28 }}>
                      no members yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
            <Note kind="info">
              Identity is the name+surname pair, so re-signing with the same pair returns you to the same workspace, history and brand kit. Granting
              admin here also works, but <code>javohir / ali</code> is always admin.
            </Note>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="card card-pad">
          <div className="log">
            <div style={{ color: 'var(--muted)', fontWeight: 700 }}>
              <span>when</span>
              <span>event</span>
              <span>detail</span>
            </div>
            {events.map((e) => (
              <div key={e.id}>
                <span>{new Date(e.at).toLocaleString()}</span>
                <span style={{ color: e.kind.includes('error') ? 'var(--bad)' : 'var(--accent-2)' }}>{e.kind}</span>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[e.actor, e.providerId, e.designId, e.mode, e.count ? `${e.count}×` : '', e.ms ? `${(e.ms / 1000).toFixed(1)}s` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            ))}
            {!events.length && <div className="muted">no activity yet</div>}
          </div>
        </div>
      )}

      <Modal open={!!confirmClear} onClose={() => setConfirmClear(null)} title="Remove this key?">
        <div className="stack">
          <p className="muted">
            The studio will stop using <b>{confirmClear}</b> for everyone in this workspace until a new key is saved. Generated history is untouched.
          </p>
          <div className="row">
            <Btn
              variant="danger"
              onClick={async () => {
                await api('/admin/providers', { method: 'DELETE', body: { providerId: confirmClear } });
                setConfirmClear(null);
                load();
                refresh();
                toast('Key removed.', 'good');
              }}
            >
              yes, remove key
            </Btn>
            <Btn variant="ghost" onClick={() => setConfirmClear(null)}>
              cancel
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function AdminPage() {
  return (
    <Shell>
      <AdminInner />
    </Shell>
  );
}
