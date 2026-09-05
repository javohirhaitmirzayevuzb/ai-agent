'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/session';
import { Btn, Field, Note, Spinner } from '@/components/ui';

const SHOWCASE = [
  { t: 'Reel cover', s: 'neon dark + heavy caps', g: 'linear-gradient(150deg,#7c5cff,#22e3c4)' },
  { t: 'Promo post', s: 'editorial grid, 3 colours', g: 'linear-gradient(150deg,#ff5c86,#ffb020)' },
  { t: 'Sale banner', s: 'big number, glow, 21:9', g: 'linear-gradient(150deg,#22e3c4,#0b3a53)' },
  { t: 'Course card', s: 'split layout, photo scrim', g: 'linear-gradient(150deg,#3ea8ff,#7c5cff)' },
];

function LoginInner() {
  const { user, loading, login, toast } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const [firstName, setFirstName] = useState(sp.get('first') || '');
  const [lastName, setLastName] = useState(sp.get('last') || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPick((p) => (p + 1) % SHOWCASE.length), 2600);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace(user.isAdmin && sp.get('next') === '/admin' ? '/admin' : '/studio');
  }, [loading, user, router, sp]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!firstName.trim() || !lastName.trim()) {
      setErr('Ikkala maydon ham kerak — name va surname.');
      return;
    }
    setBusy(true);
    try {
      const u = await login(firstName, lastName);
      toast(`Xush kelibsiz, ${u.firstName}!`, 'good');
      router.replace(u.isAdmin && sp.get('next') === '/admin' ? '/admin' : '/studio');
    } catch (e2) {
      setErr(e2.message || 'Kira olmadi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="side">
        <div>
          <div className="brand" style={{ marginBottom: 34 }}>
            <span className="dot" /> Studio <small>cover &amp; post ai</small>
          </div>
          <h1>
            Drop a cover you love.
            <br />
            Get <span style={{ background: 'linear-gradient(120deg,#7c5cff,#22e3c4)', WebkitBackgroundClip: 'text', color: 'transparent' }}>yours</span>, same taste.
          </h1>
          <p className="lead mt">
            The studio reads the reference first — palette, type, layout rhythm, and any company name printed in it — then asks you three short
            questions before it draws.
          </p>
          <div className="marquee mt">
            {SHOWCASE.map((c, i) => (
              <div
                key={c.t}
                className="card"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  opacity: i === pick ? 1 : 0.5,
                  transform: i === pick ? 'translateY(-3px)' : 'none',
                  transition: '.5s cubic-bezier(.2,1.3,.4,1)',
                  borderColor: i === pick ? 'rgba(255,255,255,.22)' : 'var(--line)',
                }}
              >
                <span style={{ width: 26, height: 26, borderRadius: 9, background: c.g, flex: 'none' }} />
                <span>
                  <b className="fs-13">{c.t}</b>
                  <div className="muted fs-11">{c.s}</div>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="muted tiny">
          Name + surname is the whole login. No password, no email.
          <br />
          <span style={{ opacity: 0.7 }}>Ism va familiya — kirish uchun shu yetarli.</span>
        </div>
        <div className="tilts">
          <span style={{ position: 'relative' }}>“Same style,
            <br /> my message.”</span>
        </div>
      </section>

      <section className="form">
        <form className="card auth-card" onSubmit={submit} style={{ padding: 26 }}>
          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="eyebrow">welcome back</span>
              <h2 style={{ marginTop: 4 }}>Sign in</h2>
            </div>
            <button
              type="button"
              className="chip"
              title="Fill the admin identity (javohir / ali)"
              onClick={() => {
                setFirstName('javohir');
                setLastName('ali');
              }}
            >
              ✨ use admin demo
            </button>
          </div>

          <div className="stack mt">
            <Field label="Name" hint="Ismingiz">
              <input
                className="input"
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Javohir"
                autoComplete="given-name"
                maxLength={40}
              />
            </Field>
            <Field label="Surname" hint="Familiyangiz">
              <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ali" autoComplete="family-name" maxLength={40} />
            </Field>
          </div>

          {err && (
            <div className="mt">
              <Note kind="bad">{err}</Note>
            </div>
          )}

          <Btn type="submit" variant="primary" size="lg" className="btn-block mt" loading={busy}>
            {busy ? 'Checking…' : 'Enter the studio →'}
          </Btn>

          <div className="hr" />
          <p className="muted tiny" style={{ lineHeight: 1.7 }}>
            <b style={{ color: 'var(--ink-dim)' }}>Admin access:</b> sign in as <code>javohir</code> + <code>ali</code> and the workspace admin panel
            unlocks — AI provider keys, model names, users and activity all live there.
            <br />
            <span style={{ opacity: 0.75 }}>Admin panel faqat name = javohir, surname = ali bo’lganda ochiladi.</span>
          </p>
          {loading && (
            <div className="center muted tiny mt">
              <Spinner /> restoring session
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
