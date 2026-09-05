'use client';
/**
 * Step 1 — drop a reference design in. Measures it in the browser canvas
 * (palette / brightness / detail energy) before anything hits the server, and
 * offers generated samples so the flow is testable with zero files on hand.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { measureImage, prepareImage, imageFromPaste, rasterizeDataUrl } from '@/lib/clientImage';
import { Btn, Field, Skeleton } from '@/components/ui';

const SAMPLES = [
  {
    id: 'neon',
    label: 'Neon reel cover',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
<defs><radialGradient id="g1" cx="30%" cy="18%" r="70%"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#07060f"/></radialGradient>
<linearGradient id="g2" x1="0" x2="1"><stop offset="0" stop-color="#22e3c4"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
<rect width="720" height="1280" fill="url(#g1)"/>
<g fill="none" stroke="url(#g2)" stroke-width="7" opacity=".85"><circle cx="560" cy="330" r="150"/><circle cx="560" cy="330" r="215" opacity=".5"/></g>
<rect x="60" y="150" width="120" height="8" rx="4" fill="url(#g2)"/>
<text x="60" y="120" font-family="Arial" font-size="26" letter-spacing="6" fill="#22e3c4" font-weight="700">NOVA AGENCY</text>
<text x="60" y="620" font-family="Arial Black,Arial" font-size="96" font-weight="900" fill="#fff">GROWTH</text>
<text x="60" y="712" font-family="Arial Black,Arial" font-size="96" font-weight="900" fill="#fff">IS A</text>
<text x="60" y="804" font-family="Arial Black,Arial" font-size="96" font-weight="900" fill="url(#g2)">SYSTEM</text>
<text x="60" y="900" font-family="Arial" font-size="30" fill="#c8c6e8">Weekly reels that compound.</text>
<rect x="60" y="1000" width="270" height="70" rx="35" fill="#fff"/>
<text x="118" y="1044" font-family="Arial" font-size="26" font-weight="800" fill="#0b0a18">WATCH EP. 12</text>
<text x="60" y="1200" font-family="Arial" font-size="22" letter-spacing="2" fill="#8f8bb8">@nova.agency · 2024</text></svg>`,
  },
  {
    id: 'editorial',
    label: 'Editorial promo',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<rect width="1080" height="1080" fill="#f3efe6"/>
<line x1="90" y1="300" x2="990" y2="300" stroke="#1a1a1a" stroke-width="2"/>
<line x1="90" y1="780" x2="990" y2="780" stroke="#1a1a1a" stroke-width="2"/>
<g stroke="#1a1a1a" stroke-width="1" opacity=".25"><line x1="390" y1="300" x2="390" y2="780"/><line x1="690" y1="300" x2="690" y2="780"/></g>
<text x="90" y="150" font-family="Georgia,serif" font-size="34" fill="#1a1a1a" letter-spacing="4">ATELIER NORD</text>
<text x="90" y="240" font-family="Georgia,serif" font-size="22" fill="#8a8375" font-style="italic">furniture &amp; light — since 1998</text>
<text x="90" y="440" font-family="Georgia,serif" font-size="86" fill="#1a1a1a">Winter</text>
<text x="90" y="540" font-family="Georgia,serif" font-size="86" fill="#1a1a1a">Collection</text>
<rect x="90" y="620" width="240" height="8" fill="#b1442f"/>
<text x="90" y="700" font-family="Georgia,serif" font-size="30" fill="#4a4638">Showroom open Thu–Sun.</text>
<text x="90" y="860" font-family="Georgia,serif" font-size="24" fill="#8a8375" letter-spacing="3">NEW ARRIVALS · ATELIER-NORD.COM</text>
<rect x="700" y="620" width="290" height="290" fill="#b1442f" opacity=".92"/>
<circle cx="845" cy="765" r="86" fill="#f3efe6" opacity=".28"/></svg>`,
  },
  {
    id: 'bold',
    label: 'Bold sale banner',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<rect width="1280" height="720" fill="#12c26b"/>
<rect x="0" y="0" width="1280" height="720" fill="#000" opacity=".06"/>
<g opacity=".22" fill="#fff"><rect x="820" y="-60" width="220" height="900" transform="rotate(18 930 390)"/></g>
<text x="80" y="180" font-family="Arial Black,Arial" font-size="40" letter-spacing="10" fill="#04331c" font-weight="800">FLASH WEEK</text>
<text x="80" y="400" font-family="Arial Black,Arial" font-size="200" font-weight="900" fill="#04331c">−50%</text>
<text x="80" y="480" font-family="Arial" font-size="34" fill="#063d22">Everything in the store. 72 hours only.</text>
<rect x="80" y="540" width="300" height="80" rx="12" fill="#04331c"/>
<text x="128" y="590" font-family="Arial" font-size="30" font-weight="800" fill="#12c26b">SHOP NOW →</text>
<text x="1200" y="680" text-anchor="end" font-family="Arial" font-size="20" fill="#04331c" opacity=".8">kod: FLASH50</text></svg>`,
  },
];

function sampleDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function RefDrop({ onReady, busy, error, onPickSample }) {
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState('');
  const inputRef = useRef(null);

  const handleFile = useCallback(
    async (file, tag = 'reference') => {
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        setStatus('Faqat rasm fayllari (PNG / JPG / WEBP / SVG).');
        return;
      }
      setStatus('Measuring the file…');
      try {
        const prepared = await prepareImage(file);
        const signals = await measureImage(prepared.dataUrl);
        setStatus('');
        onReady({ ...prepared, signals, name: file.name || tag });
      } catch (e) {
        setStatus(String(e?.message || 'O’qib bo’lmadi.'));
      }
    },
    [onReady]
  );

  useEffect(() => {
    const onPaste = (e) => {
      const file = imageFromPaste(e);
      if (file) {
        e.preventDefault();
        handleFile(file, 'pasted');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  return (
    <div className="stack">
      <div
        className="drop"
        data-over={over}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFile(e.dataTransfer?.files?.[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <div className="drop-ico">⤓</div>
        <h3 style={{ marginBottom: 6 }}>{busy ? 'Reading the design…' : 'Drop the cover or post you like'}</h3>
        <p className="muted" style={{ fontSize: 13.5 }}>
          PNG · JPG · WEBP · SVG — yoki <b>Ctrl+V</b> bilan paste qiling. Fayl faqat shu brauzerda o’lchanadi, keyin tahlil qilinadi.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {busy && (
          <div style={{ marginTop: 16 }}>
            <Skeleton h={16} style={{ maxWidth: 260, margin: '0 auto' }} />
          </div>
        )}
        {status && <p className="tiny" style={{ color: 'var(--warn)', marginTop: 10 }}>{status}</p>}
        {error && (
          <p className="tiny" style={{ color: 'var(--bad)', marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>

      <div className="between" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="eyebrow">no file handy?</span>
        <div className="chips">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              className="chip"
              onClick={async () => {
                setStatus(`Loading “${s.label}”…`);
                try {
                  // the sample is authored as SVG — flatten it so the AI endpoints get a bitmap
                  const flat = await rasterizeDataUrl(sampleDataUrl(s.svg), 'image/svg+xml');
                  const signals = await measureImage(flat.dataUrl);
                  setStatus('');
                  onReady({ ...flat, signals, name: `${s.id}-sample`, sample: s.id });
                  onPickSample?.(s);
                } catch (e) {
                  setStatus(String(e?.message || 'sample failed'));
                }
              }}
            >
              ✨ {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MiniUpload({ onReady, label = 'replace reference' }) {
  const ref = useRef(null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" onClick={() => ref.current?.click()}>
        ↻ {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const prepared = await prepareImage(f);
          const signals = await measureImage(prepared.dataUrl);
          onReady({ ...prepared, signals, name: f.name });
        }}
      />
    </>
  );
}
