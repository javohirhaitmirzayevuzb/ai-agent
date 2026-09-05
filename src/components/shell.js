'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApp } from '@/components/session';
import { Spinner } from '@/components/ui';

const NAV = [
  { href: '/studio', label: 'Studio', show: true },
  { href: '/admin', label: 'Admin', show: 'admin' },
  { href: '/profile', label: 'Profile', show: true },
];

export function Shell({ children, bare = false }) {
  const { user, caps, loading, logout } = useApp();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (user && pathname?.startsWith('/admin') && !user.isAdmin) router.replace('/studio');
  }, [user, pathname, router]);

  if (loading || !user) {
    return (
      <div className="center" style={{ minHeight: '100vh', justifyContent: 'center', gap: 12, color: 'var(--muted)' }}>
        <Spinner /> <span>Studio…</span>
      </div>
    );
  }

  const hue = (String(user.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 23) % 360;

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/studio" className="brand">
          <span className="dot" />
          Studio <small>cover &amp; post ai</small>
        </Link>
        <nav className="nav">
          {NAV.filter((n) => n.show === true || (n.show === 'admin' && user.isAdmin)).map((n) => (
            <Link key={n.href} href={n.href} data-active={pathname?.startsWith(n.href)}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        {caps && !caps.image && (
          <span className="badge badge-warn" title="No image model key yet — the studio falls back to its local vector composer.">
            local render
          </span>
        )}
        <div className="userchip">
          <span className="avatar" style={{ '--hue': hue }}>
            {initials(user)}
          </span>
          <span className="fs-13" style={{ fontWeight: 650 }}>
            {user.displayName}
            {user.isAdmin && (
              <>
                {' '}
                <span className="badge badge-admin">admin</span>
              </>
            )}
          </span>
          <button className="iconbtn" title="Sign out" onClick={logout}>
            ⏻
          </button>
        </div>
      </header>
      <main className="main" style={bare ? { maxWidth: 'none', padding: 0 } : undefined}>
        {children}
      </main>
    </div>
  );
}

export function initials(u) {
  return `${(u.firstName || '?')[0] || ''}${(u.lastName || '')[0] || ''}`.toUpperCase();
}
