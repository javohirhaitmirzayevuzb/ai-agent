'use client';
import { Badge } from '@/components/ui';
/**
 * The live trail a generation deserves: which stage is running, which model is being
 * called, how many variations have landed and how long it has taken. The server pushes
 * these as NDJSON events while it works, so this is a real progress report, not a
 * decorative spinner.
 */
const ICON = { run: '◐', done: '✓', fail: '✕', skip: '–' };

function fmt(ms) {
  if (!ms) return '';
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

export default function GenTrail({ stages = [], progress, elapsed = 0, model = '' }) {
  if (!stages.length && !progress) return null;
  const running = stages.find((s) => s.status === 'run');
  const pct = progress?.total ? Math.min(96, Math.round((progress.done / progress.total) * 88) + 8) : null;
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="between wrap" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {model && <Badge kind="ai">{model}</Badge>}
          {stages.map((s) => (
            <span
              key={s.id}
              className="chip"
              title={s.detail || ''}
              style={{
                borderColor: s.status === 'fail' ? 'rgba(255,107,107,.5)' : s.status === 'run' ? 'var(--accent)' : 'var(--line)',
                color: s.status === 'fail' ? 'var(--bad)' : s.status === 'done' ? 'var(--fg)' : 'var(--muted)',
              }}
            >
              <span style={{ marginRight: 6, opacity: 0.85 }}>{ICON[s.status] || '·'}</span>
              {s.label || s.id}
            </span>
          ))}
        </div>
        <span className="muted tiny" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {progress?.total ? `${progress.done}/${progress.total} variations` : ''}
          {progress?.ms ? ` · ${fmt(progress.ms)}` : elapsed ? ` · ${elapsed}s` : ''}
        </span>
      </div>

      {pct !== null && (
        <div style={{ height: 3, background: 'var(--line)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'linear-gradient(90deg,var(--accent),var(--accent-2))',
              transition: 'width .45s cubic-bezier(.2,.8,.2,1)',
            }}
          />
        </div>
      )}

      {running && <div className="muted tiny mt-s">{running.hint || 'waiting on the model — image calls take 10–60s each'}</div>}
    </div>
  );
}
