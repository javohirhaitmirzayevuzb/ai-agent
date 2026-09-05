'use client';
import { useEffect, useRef, useState } from 'react';

export function Field({ label, hint, badge, children, style }) {
  return (
    <div className="field" style={style}>
      {(label || badge) && (
        <div className="label">
          {label}
          {badge}
        </div>
      )}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export const TextInput = ({ as = 'input', ...p }) => <input className="input" {...p} />;
export const TextArea = (p) => <textarea className="textarea" {...p} />;

export function SelectInput({ options = [], value, onChange, ...p }) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...p}>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? String(o)}
        </option>
      ))}
    </select>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className={`switch ${disabled ? 'muted' : ''}`} style={{ opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <i />
      <span className="fs-13">{label}</span>
    </label>
  );
}

export function Seg({ options = [], value, onChange, size }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value ?? o}
          type="button"
          data-on={(o.value ?? o) === value}
          onClick={() => onChange?.(o.value ?? o)}
          style={size === 'sm' ? { padding: '4px 9px', fontSize: 12 } : undefined}
        >
          {o.label ?? String(o)}
        </button>
      ))}
    </div>
  );
}

export function ChipToggle({ on, children, onClick, title }) {
  return (
    <button type="button" className="chip" data-on={on ? 'true' : 'false'} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export const Badge = ({ kind = 'ai', children }) => <span className={`badge badge-${kind}`}>{children}</span>;

export function Note({ kind = 'info', children, style }) {
  return (
    <div className={`note ${kind !== 'info' ? `note-${kind}` : ''}`} style={style}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Stepper({ value = 1, min = 1, max = 4, onChange }) {
  const set = (n) => onChange?.(Math.max(min, Math.min(max, n)));
  return (
    <div className="stepper">
      <button type="button" onClick={() => set(value - 1)} aria-label="kamaytirish">
        −
      </button>
      <span>{value}</span>
      <button type="button" onClick={() => set(value + 1)} aria-label="oshirish">
        +
      </button>
    </div>
  );
}

export function Spinner({ style }) {
  return <span className="spin" style={style} />;
}

export function Btn({ variant = '', size, loading, children, className = '', ...p }) {
  return (
    <button
      type="button"
      className={`btn ${variant ? `btn-${variant}` : ''} ${size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={loading || p.disabled}
      {...p}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className={`modal card ${wide ? '' : ''}`} style={{ width: wide ? undefined : 'min(620px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'rgba(9,12,20,.95)', backdropFilter: 'blur(10px)', zIndex: 2 }}>
          <h3 style={{ flex: 1 }}>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="yopish">
            ✕
          </button>
        </div>
        <div className="card-pad">{children}</div>
      </div>
    </div>
  );
}

export function PaletteStrip({ colors = [], shares }) {
  if (!colors.length) return null;
  return (
    <div className="palette" title="Extracted palette">
      {colors.map((c, i) => (
        <div
          key={i}
          style={{ background: c, flex: (shares?.[i] ? 0.6 + shares[i] * 4 : 1).toString(), color: isLight(c) ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.85)', textShadow: 'none' }}
          title={c}
        >
          {c.toUpperCase()}
        </div>
      ))}
    </div>
  );
}

export function SwatchPicker({ colors = [], onChange }) {
  const ref = useRef(null);
  return (
    <div className="center wrap">
      {colors.map((c, i) => (
        <div key={i} className="center" style={{ gap: 4 }}>
          <input
            ref={i === 0 ? ref : undefined}
            type="color"
            value={c}
            onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))}
            style={{ width: 30, height: 30, padding: 0, border: '1px solid var(--line-strong)', borderRadius: 9, background: 'transparent' }}
          />
          <button className="iconbtn" title="remove" onClick={() => onChange(colors.filter((_, j) => j !== i))} style={{ width: 24, height: 24, fontSize: 11 }}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-sm btn-ghost" onClick={() => onChange([...colors, '#7c5cff'])}>
        + color
      </button>
    </div>
  );
}

export const isLight = (hex) => {
  const v = String(hex || '#000').replace('#', '');
  if (v.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
};

export function Copy({ text, label = 'copy', onDone }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        onDone?.();
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'copied ✓' : label}
    </button>
  );
}

export function Tabs({ tabs = [], value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.value} data-on={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count != null && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Stat = ({ label, value, sub }) => (
  <div className="stat">
    <span className="eyebrow">{label}</span>
    <b>{value}</b>
    {sub && <span className="muted tiny">{sub}</span>}
  </div>
);

export const Progress = ({ pct = 0, indeterminate }) => (
  <div className="progress">
    <i style={{ width: indeterminate ? '40%' : `${Math.round(pct * 100)}%`, animation: indeterminate ? 'shine 1.1s linear infinite' : undefined }} />
  </div>
);

export const Skeleton = ({ h = 120, style }) => <div className="shimmer" style={{ height: h, ...style }} />;

