'use client';
/**
 * Session context: who is logged in, what the workspace can do (AI keys), plus a
 * tiny fetch wrapper and toast queue shared by every page.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const Ctx = createContext(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [caps, setCaps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4200);
  }, []);

  const api = useCallback(async (path, { method = 'GET', body, silent = false } = {}) => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* html error page */
    }
    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.error || data?.detail || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      if (!silent) toast(err.message, 'error');
      throw err;
    }
    return data || {};
  }, [toast]);

  const apply = useCallback((d) => {
    if (!d) return;
    if (d.user !== undefined) setUser(d.user);
    if (d.capabilities) setCaps(d.capabilities);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const d = await res.json();
      setUser(d.user || null);
      setCaps(d.capabilities || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (firstName, lastName) => {
      const d = await api('/auth/login', { method: 'POST', body: { firstName, lastName }, silent: true });
      apply(d);
      return d.user;
    },
    [api, apply]
  );

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setUser(null);
    setCaps(null);
    window.location.href = '/login';
  }, []);

  const value = useMemo(
    () => ({ user, caps, loading, setUser, setCaps, api, toast, refresh, login, logout }),
    [user, caps, loading, api, toast, refresh, login, logout, apply]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast"
            style={{
              borderColor:
                t.kind === 'error' ? 'rgba(255,107,107,.45)' : t.kind === 'good' ? 'rgba(53,224,138,.45)' : 'var(--line-strong)',
            }}
          >
            <span style={{ marginRight: 8 }}>{t.kind === 'error' ? '⚠️' : t.kind === 'good' ? '✅' : '💡'}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
