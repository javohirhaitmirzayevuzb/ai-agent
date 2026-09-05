/**
 * End-to-end smoke test for the Studio.
 *
 *   node scripts/selftest.mjs [baseUrl]
 *
 * It builds a synthetic "reference design" PNG, measures it the way the browser
 * canvas does, then drives the real HTTP API: name+surname login, the admin key
 * panel, analysis, generation, file serving (and its ownership rules), the
 * profile/brand kit, history, favourites and deletion.
 */
import zlib from 'node:zlib';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
let pass = 0;
let fail = 0;
const cookie = {};

function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? ` \x1b[2m${extra}\x1b[0m` : ''}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`);
  }
}

async function req(path, { method = 'GET', body, who = 'admin', raw = false } = {}) {
  const headers = { cookie: cookie[who] || '' };
  if (body) headers['content-type'] = 'application/json';
  const full = path.startsWith('/api') ? path : '/api' + path;
  const res = await fetch(BASE + full, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && who) cookie[who] = setCookie.split(',')[0].split(';')[0];
  if (raw) return { res, text: await res.text() };
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { _text: text.slice(0, 200) };
  }
  return { status: res.status, json, headers: res.headers };
}

/* ------------------------------------------------------------ tiny PNG io */

function crcTable() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** a fake poster: dark field, violet block, big white bar, accent stripe */
function makeReference(w = 360, h = 500) {
  const px = Buffer.alloc(w * h * 4);
  const put = (x, y, [r, g, b]) => {
    const i = (y * w + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) put(x, y, c);
  };
  rect(0, 0, w, h, [13, 17, 23]);
  rect(Math.round(w * 0.55), 0, w, Math.round(h * 0.42), [124, 92, 255]);
  rect(20, Math.round(h * 0.5), Math.round(w * 0.86), Math.round(h * 0.58), [238, 242, 255]);
  rect(20, Math.round(h * 0.62), Math.round(w * 0.5), Math.round(h * 0.66), [34, 227, 196]);
  for (let i = 0; i < 900; i++) put((i * 37) % w, (i * 53) % h, [255, 92, 134]); // detail specks
  return { px, w, h };
}

/** same math as src/lib/clientImage.measureImage, in miniature */
function measure({ px, w, h }) {
  const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const buckets = new Map();
  const gray = new Float32Array(w * h);
  let sumL = 0;
  let sumS = 0;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    sumL += 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const mx = Math.max(r, g, b);
    sumS += mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  const n = w * h;
  const luminance = Number((sumL / n).toFixed(3));
  let v = 0;
  for (let i = 0; i < n; i += 4) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const d = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) - luminance;
    v += d * d;
  }
  const palette = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((b) => ({
      hex: '#' + [b.r, b.g, b.b].map((c) => Math.round(c / b.n).toString(16).padStart(2, '0')).join(''),
      share: Number((b.n / n).toFixed(3)),
    }));
  let grad = 0;
  const regions = {};
  const keys = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  for (const k of keys) regions[k] = { energy: 0, light: 0, n: 0 };
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const e = Math.min(255, Math.hypot(gray[i - 1] - gray[i + 1], gray[i - w] - gray[i + w]));
      grad += e;
      const reg = regions[keys[(y < h / 3 ? 0 : y < (2 * h) / 3 ? 3 : 6) + (x < w / 3 ? 0 : x < (2 * w) / 3 ? 1 : 2)]];
      reg.energy += e;
      reg.light += gray[i];
      reg.n++;
    }
  const pxCount = Math.max(1, (w - 2) * (h - 2));
  for (const k of keys) {
    regions[k] = { energy: Number((regions[k].energy / pxCount / 255).toFixed(3)), light: Number((regions[k].light / Math.max(1, regions[k].n) / 255).toFixed(3)) };
  }
  const sorted = keys.slice().sort((a, b) => regions[a].energy - regions[b].energy);
  return {
    width: w,
    height: h,
    ratio: Number((w / h).toFixed(3)),
    ratioLabel: '2:3',
    luminance,
    contrast: Number(Math.min(1, Math.sqrt(v / (n / 4)) * 2.6).toFixed(3)),
    saturation: Number((sumS / n).toFixed(3)),
    edgeDensity: Number((grad / pxCount / 255).toFixed(3)),
    regions,
    calmRegion: sorted[0],
    hotRegion: sorted[sorted.length - 1],
    palette,
    coverage: 1,
    typeGuess: 'flat graphic blocks with one heavy bar',
  };
}

/* ------------------------------------------------------------------ tests */

console.log(`\n\x1b[1mStudio selftest\x1b[0m → ${BASE}\n`);

console.log('auth');
{
  const r = await req('/api/auth/me', { who: 'none' });
  ok('anon has no session', r.json.user === null);

  const bad = await req('/api/auth/login', { method: 'POST', body: { firstName: 'x', lastName: '' }, who: 'tmp' });
  ok('rejects empty surname', bad.status === 400, `(${bad.json.error})`);

  const admin = await req('/api/auth/login', { method: 'POST', body: { firstName: 'Javohir', lastName: 'Ali' }, who: 'admin' });
  ok('name+surname login works', admin.json.user?.displayName === 'Javohir Ali');
  const sloppy = await req('/api/auth/login', { method: 'POST', body: { firstName: 'javohir', lastName: 'ali' }, who: 'admin' });
  ok('lowercase re-login never downgrades the saved name', sloppy.json.user?.displayName === 'Javohir Ali');

  ok('admin role from the exact pair', admin.json.user?.isAdmin === true);

  const weird = await req('/api/auth/login', { method: 'POST', body: { firstName: 'Javohir', lastName: 'Ali2' }, who: 'almost' });
  ok('near-miss is not admin', weird.json.user?.isAdmin === false);

  await req('/api/auth/login', { method: 'POST', body: { firstName: 'Madina', lastName: 'Rustamova' }, who: 'user' });
  ok('second member can sign in', cookie.user);
}

console.log('\nsession cookies + bearer fallback');
{
  // one login must cover every context the app can be opened in: top-level http,
  // top-level https, cross-site iframe, iframe with third-party cookies blocked.
  // Guessing the context from proxy headers is what broke the preview, so we write
  // all three flavours and let the browser keep whichever its rules allow.
  const loginAs = async (first, last, headers = {}) => {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ firstName: first, lastName: last }),
    });
    return { res, json: await res.json().catch(() => null), all: res.headers.getSetCookie?.() || [] };
  };
  const attrs = (list, name) => (list.find((c) => c.toLowerCase().startsWith(name.toLowerCase() + '=')) || '').toLowerCase();

  const emb = await loginAs('Embedded', 'Viewer', { 'x-forwarded-proto': 'https' });
  ok('login writes three cookie flavours', emb.all.length === 3, `(${emb.all.length})`);
  const lax = attrs(emb.all, 'studio_session');
  const tls = attrs(emb.all, 'studio_session_tls');
  const chip = attrs(emb.all, 'studio_session_chip');
  ok('first-party flavour: Lax without Secure (http://localhost works)', lax.includes('samesite=lax') && !lax.includes('secure'), lax.split(';').slice(1).join(';').trim().slice(0, 60));
  ok('embedded flavour: None + Secure', tls.includes('samesite=none') && tls.includes('secure'));
  ok('CHIPS flavour: None + Secure + Partitioned', chip.includes('samesite=none') && chip.includes('secure') && chip.includes('partitioned'));
  ok('all flavours carry the same token', new Set(emb.all.map((c) => c.split(';')[0].split('=').slice(1).join('='))).size === 1);
  ok('no flavour is Partitioned-only (rejected outside an embed)', !lax.includes('partitioned') && !tls.includes('partitioned'));

  // a context that stores nothing must still work: mirror the token in a header
  const token = emb.json.token;
  ok('login returns a bearer mirror for cookie-less contexts', typeof token === 'string' && token.includes('.'));
  const viaHeader = await fetch(BASE + '/api/auth/me', { headers: { 'x-studio-session': token } });
  ok('header token authenticates /api/auth/me', viaHeader.status === 200 && (await viaHeader.json()).user?.firstName === 'Embedded');
  const adminGate = await fetch(BASE + '/api/admin/providers', { headers: { 'x-studio-session': token } });
  ok('admin guard recognises the header session (403 = seen, not admin)', adminGate.status === 403, `(${adminGate.status})`);
  const tampered = await fetch(BASE + '/api/auth/me', { headers: { 'x-studio-session': token.slice(0, -4) + 'AAAA' } });
  ok('tampered bearer header is anonymous', (await tampered.json()).user === null);

  const embedOrigin = await fetch(BASE + '/api/auth/me', { headers: { cookie: emb.all[0].split(';')[0], origin: 'https://some-embedder.example' } });
  ok('session works when called from an embedded origin', embedOrigin.status === 200 && (await embedOrigin.json()).user?.isAdmin === false);

  // logout must kill the mirrored token too, not just the cookie
  const out = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'x-studio-session': token } });
  const cleared = out.headers.getSetCookie?.() || [];
  ok('logout empties every flavour', cleared.length === 3 && cleared.every((c) => { const l = c.toLowerCase(); return l.includes('max-age=0') && l.includes('expires=thu, 01 jan 1970'); }), `(${cleared.length})`);
  ok('logout keeps each flavour’s own attributes', /partitioned/.test((cleared[2] || '').toLowerCase()));
  const after = await fetch(BASE + '/api/auth/me', { headers: { 'x-studio-session': token, cookie: emb.all[0].split(';')[0] } });
  ok('signed-out token is dead even with a valid signature', (await after.json()).user === null);
}

console.log('\ncapabilities without keys');
{
  const me = await req('/api/auth/me', { who: 'user' });
  const caps = me.json.capabilities;
  ok('studio reports no image key yet', caps.image === false);
  ok('studio reports no vision key yet', caps.analyse === false);
  ok('self-serve keys allowed by default', caps.allowSelfServeKeys === true);
}

console.log('\nadmin guard');
{
  const blocked = await req('/api/admin/providers', { who: 'user' });
  ok('members cannot read provider keys', blocked.status === 403);
  const anon = await req('/api/admin/users', { who: 'none' });
  ok('anonymous cannot read users', anon.status === 401);
  const list = await req('/api/admin/providers', { who: 'admin' });
  ok('admin sees the provider list', (list.json.providers || []).length >= 3, `(gemini, openai, custom)`);
  ok('keys are masked in responses', !JSON.stringify(list.json).includes('apiKeyEnc'));
}

console.log('\nanalyse (heuristic path, no key)');
const ref = makeReference();
const signals = measure(ref);
let designId = '';
{
  const dataUrl = 'data:image/png;base64,' + encodePng(ref.w, ref.h, ref.px).toString('base64');
  const a = await req('/api/analyze', { method: 'POST', who: 'admin', body: { image: dataUrl, signals, title: 'selftest' } });
  designId = a.json.designId;
  const an = a.json.analysis || {};
  ok('returns a design id', Boolean(designId));
  ok('palette carried over from the file', (an.palette || []).length >= 3, `${(an.palette || []).length} swatches`);
  ok('brightness/contrast measured', an.measured?.luminance != null && an.measured?.contrast > 0);
  ok('no false company name invented', an.companyName === null);
  ok('asks the user for the missing info', (an.questionsToAsk || []).length >= 2, an.questionsToAsk.map((q) => q.field).join('+'));
  ok('suggests a format from the aspect', Boolean(an.formatSuggestion), an.formatSuggestion);
  ok('reads a layout archetype', Boolean(an.layout?.archetype), an.layout?.archetype);
  ok('marks the render mode as local', a.json.readiness?.renderMode === 'local-svg');
  ok('reference file is stored', Boolean(a.json.refUrl));
}

console.log('\ngenerate (local vector composer)');
let itemId = '';
let itemUrl = '';
{
  const g = await req('/api/generate', {
    method: 'POST',
    who: 'admin',
    body: {
      designId,
      brief: {
        companyName: 'Nova Agency',
        topic: 'how we rebuilt a coffee brand feed in 7 days',
        headline: 'GROWTH IS A SYSTEM',
        subhead: 'weekly reels that compound',
        cta: 'WATCH EP. 12',
        footer: '@nova.agency',
        insight: 'owners are tired of pretty but empty posts — show proof, not vibes',
        format: 'reel-9x16',
        count: 2,
        tone: 'premium, direct',
        audience: 'founders',
      },
    },
  });
  const items = g.json.items || [];
  itemId = items[0]?.id || '';
  itemUrl = items[0]?.url || '';
  ok('2 variations returned', items.length === 2, `mode=${g.json.mode}`);
  ok('every item has a file url', items.every((i) => i.url?.startsWith('/api/file/')));
  ok('art-director note skipped without a key', g.json.direction === '');
  ok('prompt captured for each variation', items[0]?.prompt?.includes('GROWTH IS A SYSTEM'));
  ok('prompt keeps the reference palette', items[0]?.prompt?.includes('#'));
  ok('prompt names the topic to communicate', items[0]?.prompt?.includes('coffee brand'));

  const f = await req(itemUrl, { raw: true, who: 'admin' });
  ok('rendered cover is served', f.res.status === 200 && (f.res.headers.get('content-type') || '').includes('svg'), `${f.text.length}b svg`);
  ok('cover embeds the headline', f.text.includes('GROWTH IS A SYSTEM'));
  ok('cover embeds the brand name', f.text.includes('NOVA AGENCY'));
  ok('cover uses the extracted palette', signals.palette.some((p) => f.text.toLowerCase().includes(p.hex)));
}

console.log('\nownership');
{
  const stolen = await req(itemUrl, { raw: true, who: 'user' });
  ok("other members can't read your files", stolen.res.status === 403);
  const anon = await req(itemUrl, { raw: true, who: 'none' });
  ok('anonymous cannot read files', anon.res.status === 401);
  const adminSees = await req(itemUrl, { raw: true, who: 'admin' });
  ok('admin can read any file', adminSees.res.status === 200);
}

console.log('\nremix loop');
{
  const r = await req('/api/generate', {
    method: 'POST',
    who: 'admin',
    body: { designId, brief: { companyName: 'Nova Agency', headline: 'GROWTH IS A SYSTEM', format: 'reel-9x16', count: 1, iterateOn: itemId, instruction: 'headline twice as big' }, analysis: null },
  });
  ok('remix with an instruction returns a new take', (r.json.items || []).length === 1);
  ok('instruction is folded into the prompt', r.json.items?.[0]?.prompt?.includes('headline twice as big'));
}

console.log('\nhistory · favourite · profile');
{
  const h = await req('/designs?limit=10', { who: 'admin' });
  ok('history lists the design', (h.json.designs || []).some((d) => d.id === designId));
  const full = await req(`/designs?id=${designId}`, { who: 'admin' });
  ok('detail view carries brief + analysis', Boolean(full.json.design?.brief?.companyName) && Boolean(full.json.design?.analysis?.palette));
  const fav = await req('/designs', { method: 'PATCH', who: 'admin', body: { id: designId, favoriteItemId: itemId, saveToProfile: true } });
  ok('favourite toggles on', fav.json.design?.favoriteItemId === itemId);
  const prof = await req('/api/auth/me', { who: 'admin' });
  const refs = prof.json.user?.profile?.references || [];
  ok('favourite saved into profile reference bank', refs.some((r) => r.file.includes(designId)), `${refs.length} saved`);
  await req('/profile', { method: 'PUT', who: 'admin', body: { company: 'Nova', tagline: 'growth systems', brandColors: ['#7c5cff', '#22e3c4', 'nope'] } });
  const prof2 = await req('/api/auth/me', { who: 'admin' });
  ok('brand kit persists', prof2.json.user?.profile?.company === 'Nova');
  ok('invalid colour rejected', (prof2.json.user?.profile?.brandColors || []).length === 2);
  const favOff = await req('/designs', { method: 'PATCH', who: 'admin', body: { id: designId, favoriteItemId: itemId } });
  ok('favourite toggles off', favOff.json.design?.favoriteItemId === '');
}

console.log('\nadmin: keys, defaults, validation');
{
  const fake = await req('/api/admin/providers', { method: 'PUT', who: 'admin', body: { providerId: 'gemini', apiKey: 'short' } });
  ok('rejects a too-short key', fake.status === 400);
  const save = await req('/api/admin/providers', { method: 'PUT', who: 'admin', body: { providerId: 'gemini', apiKey: 'test-key-1234567890', visionModel: 'gemini-2.5-flash', setAsDefault: true } });
  ok('saves a key', save.status === 200);
  const list = await req('/api/admin/providers', { who: 'admin' });
  const gem = list.json.providers.find((p) => p.id === 'gemini');
  ok('key masked, never echoed back', gem.masked === 'tes…7890' && !JSON.stringify(list.json).includes('test-key-1234567890'), gem.masked);
  ok('masked view keeps a fingerprint', Boolean(gem.fingerprint));
  ok('default provider switched', list.json.defaultProvider === 'gemini');
  const caps = (await req('/api/auth/me', { who: 'user' })).json.capabilities;
  ok('members inherit the workspace key', caps.providers.find((p) => p.id === 'gemini')?.hasKey === true);
  ok('workspace key unlocks vision for members', caps.analyse === true);
  ok('workspace key unlocks image generation', caps.image === true);
  ok('provider is marked as their scope', caps.providers.find((p) => p.id === 'gemini')?.scope === 'admin key');

  const badModel = await req('/api/admin/providers', { method: 'PUT', who: 'admin', body: { providerId: 'gemini', imageModel: 'javascript:alert(1)' } });
  ok('rejects a junk model name', badModel.status === 400);

  // with a bogus key saved, generation must still deliver art (local fallback) instead of dying
  const a = await req('/api/analyze', { method: 'POST', who: 'admin', body: { image: 'data:image/png;base64,' + encodePng(ref.w, ref.h, ref.px).toString('base64'), signals } });
  const fallback = await req('/api/generate', { method: 'POST', who: 'admin', body: { designId: a.json.designId, brief: { headline: 'PROOF NOT VIBES', format: 'post-1x1', count: 1 } } });
  ok('a bad vendor key degrades to the local composer', (fallback.json.items || []).length === 1 && fallback.json.mode === 'local-svg');
  ok('the vendor error is surfaced as a warning', Boolean((fallback.json.warnings || [])[0]?.error), String((fallback.json.warnings || [])[0]?.error || '').slice(0, 60));
  ok('a saved provider routes through its own protocol', (await req('/api/admin/test', { method: 'POST', who: 'admin', body: { providerId: 'gemini' } })).json.test?.checks?.some((c) => c.kind === 'vision'));
  ok('analysis survives a failing vision call', Boolean(a.json.analysis?.palette?.length) && Boolean(a.json.analysis?.aiError || a.json.analysis?.aiProvider));
  await req('/designs', { method: 'DELETE', who: 'admin', body: { id: a.json.designId } });
  const clear = await req('/api/admin/providers', { method: 'DELETE', who: 'admin', body: { providerId: 'gemini' } });
  ok('key can be cleared', clear.status === 200 && !(await req('/api/admin/providers', { who: 'admin' })).json.providers.find((p) => p.id === 'gemini').hasKey);
}

console.log('\nself-serve keys');
{
  await req('/api/admin/settings', { method: 'PUT', who: 'admin', body: { allowSelfServeKeys: true } });
  const k = await req('/api/keys', { method: 'PUT', who: 'user', body: { providerId: 'openai', apiKey: 'user-own-key-098765' } });
  ok('member stores own key', k.json.user?.keys?.openai?.hasKey === true);
  ok('own key never leaks plaintext', !JSON.stringify(k.json).includes('user-own-key-098765'));
  await req('/api/admin/settings', { method: 'PUT', who: 'admin', body: { allowSelfServeKeys: false } });
  const off = await req('/api/keys', { method: 'PUT', who: 'user', body: { providerId: 'openai', apiKey: 'another-key-0000' } });
  ok('admin can disable self-serve keys', off.status === 403);
  await req('/api/admin/settings', { method: 'PUT', who: 'admin', body: { allowSelfServeKeys: true } });
  await req('/api/keys', { method: 'DELETE', who: 'user', body: { providerId: 'openai' } });
  const removed = await req('/api/auth/me', { who: 'user' });
  ok('member can remove own key', !removed.json.user.keys?.openai?.hasKey);
}

console.log('\npayload guards');
{
  const huge = await req('/api/analyze', { method: 'POST', who: 'user', body: { image: 'data:image/tiff;base64,' + 'A'.repeat(400), signals } });
  ok('unsupported image type rejected cleanly', huge.status === 400);
  const noSig = await req('/api/analyze', { method: 'POST', who: 'user', body: { image: 'data:image/png;base64,' + encodePng(20, 20, Buffer.alloc(20 * 20 * 4, 128)).toString('base64') } });
  ok('analysis needs the canvas signals', noSig.status === 400);
  const genNoRef = await req('/api/generate', { method: 'POST', who: 'user', body: { designId: 'dsg_nope', brief: { headline: 'x' } } });
  ok('unknown design id rejected', genNoRef.status === 404);
}

console.log('\nactivity + users');
{
  const ev = await req('/admin/events?limit=200', { who: 'admin' });
  const kinds = (ev.json.events || []).map((e) => e.kind);
  ok('events recorded', kinds.includes('design.analysed') && kinds.includes('design.generated') && kinds.includes('provider.key-cleared'));
  ok('no api keys in the activity log', !/apiKey|sk-|AIza/.test(JSON.stringify(ev.json.events || [])));
  const u = await req('/admin/users', { who: 'admin' });
  ok('user list counts designs', (u.json.users || []).length >= 3 && u.json.totals.designs >= 1);
  const target = u.json.users.find((x) => x.id === 'madina.rustamova');
  await req('/admin/users', { method: 'PATCH', who: 'admin', body: { userId: target.id, role: 'admin' } });
  const promoted = await req('/admin/users', { who: 'admin' });
  ok('admin can grant admin', promoted.json.users.find((x) => x.id === target.id)?.isAdmin === true);
  await req('/admin/users', { method: 'PATCH', who: 'admin', body: { userId: target.id, role: 'user' } });
}

console.log('\ndelete');
{
  const d = await req('/designs', { method: 'DELETE', who: 'admin', body: { id: designId } });
  ok('design deleted', d.status === 200);
  const gone = await req(itemUrl, { raw: true, who: 'admin' });
  ok('its files are gone', gone.res.status === 404 || gone.res.status === 500);
  const otherDelete = await req('/designs', { method: 'DELETE', who: 'user', body: { id: designId } });
  ok('cannot delete what you do not own', otherDelete.status === 404);
}

console.log(`\n\x1b[1m${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
