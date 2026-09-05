#!/usr/bin/env node
/**
 * Studio doctor — tells you WHY a generation cannot work yet.
 *
 *   npm run doctor                          # everything, with network probes
 *   npm run doctor -- --no-net              # local/config only (safe offline / in CI)
 *   npm run doctor -- --json                # machine readable
 *   npm run doctor -- --provider gemini --api-key AIza…   # test a key before pasting it anywhere
 *
 * The point is the distinction nobody can guess from the UI alone: a key that Google rejects,
 * a machine with no internet, and a sandbox that allow-lists some hosts and refuses others are
 * three different problems — so they get three different verdicts and three different fixes.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const opt = (name, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const JSON_OUT = flags.has('--json');
const NO_NET = flags.has('--no-net');
const ONLY = opt('provider', null);
const CLI_KEY = opt('api-key', null);
const NET_TIMEOUT = Number(opt('timeout', 5000)) || 5000;
// a control host: if it answers and the provider does not, the host is filtered, not offline
const CONTROL = opt('control', 'https://registry.npmjs.org/');
const STARTED = Date.now();

const C = JSON_OUT || !process.stdout.isTTY ? { g: '', r: '', y: '', b: '', d: '', x: '' } : { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const out = (...a) => {
  if (!JSON_OUT) console.log(...a);
};
const check = (row) => {
  (check.rows ||= []).push(row);
  const mark = row.status === 'ok' ? `${C.g}✓${C.x}` : row.status === 'warn' ? `${C.y}!${C.x}` : row.status === 'fail' ? `${C.r}✗${C.x}` : `${C.d}·${C.x}`;
  out(`  ${mark} ${row.name}${row.detail ? ` ${C.d}— ${row.detail}${C.x}` : ''}`);
};
const section = (t) => out(`\n${C.b}${t}${C.x}`);

/* ------------------------------------------------------------------ store */

let store = null;
let storeError = null;
const mask = { maskKey: (v) => `${String(v).slice(0, 3)}…${String(v).slice(-4)}`, fingerprint: () => '' };
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
try {
  const mod = pathToFileURL(path.join(process.cwd(), 'src/lib/store.js')).href;
  const { readStore } = await import(mod);
  store = readStore(); // same defaults merge the app uses, so baseUrl/imageModel match reality
  const { maskKey, fingerprint } = await import(pathToFileURL(path.join(process.cwd(), 'src/lib/crypto.js')).href);
  Object.assign(mask, { maskKey, fingerprint });
} catch (err) {
  storeError = String(err?.message || err);
}

/* ------------------------------------------------------------ local checks */

section('Runtime');
const nodeMajor = Number(process.versions.node.split('.')[0]);
const nodeMinor = Number(process.versions.node.split('.')[1]);
const nodeOk = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 17); // global fetch + AbortSignal.timeout
check({ name: `node ${process.versions.node}`, status: nodeOk ? 'ok' : 'fail', detail: nodeOk ? '' : 'Node 18.17+ (20 LTS recommended) — older runtimes have no global fetch' });
check({ name: 'platform', status: 'ok', detail: `${process.platform} · ${process.arch}` });

if (storeError) {
  check({ name: 'store readable', status: 'fail', detail: storeError });
} else {
  const storeFile = path.join(DATA_DIR, 'store.json');
  check({ name: 'store readable', status: 'ok', detail: `${storeFile}${fs.existsSync(storeFile) ? ` (${fs.statSync(storeFile).size} bytes)` : ' (new — nothing saved yet)'}` });
  let writable = true;
  try {
    const probe = path.join(DATA_DIR, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch {
    writable = false;
  }
  check({ name: 'store writable', status: writable ? 'ok' : 'fail', detail: writable ? '' : 'data dir is read-only — nothing can be saved' });
  const users = Object.keys(store.users || {}).length;
  const designs = Object.keys(store.designs || {}).length;
  check({ name: 'workspace', status: 'ok', detail: `${users} user(s) · ${designs} design(s) · app “${store.settings.appName || 'Studio'}”` });
  check({ name: 'self-serve keys', status: 'ok', detail: store.settings.allowSelfServeKeys ? 'users may store their own key' : 'admin only' });
  const mv = Number(store.settings.maxVariations || 0);
  check({ name: 'maxVariations', status: mv >= 1 && mv <= 8 ? 'ok' : 'warn', detail: String(mv || 'unset') });
}

// orphan files: history rows pointing at bytes that are not on disk render as broken images
const orphans = [];
if (store) {
  for (const d of Object.values(store.designs || {})) {
    const refs = [d.reference?.file, ...(d.items || []).map((i) => i.file)].filter(Boolean);
    for (const rel of refs) {
      if (!fs.existsSync(path.join(DATA_DIR, 'files', rel))) orphans.push(`${d.id}/${rel}`);
    }
  }
}
check({ name: 'stored image files', status: orphans.length ? 'warn' : 'ok', detail: orphans.length ? `${orphans.length} missing (broken thumbnails in history)` : 'every item and reference resolves on disk' });

/* -------------------------------------------------------------- providers */

const providerIds = store ? Object.keys(store.settings.providers || {}) : [];
const wanted = ONLY ? [ONLY] : providerIds;
const defaultProvider = store?.settings?.defaultProvider;
const providers = [];

if (store) {
  section('AI lanes');
  check({ name: 'defaultProvider', status: wanted.includes(defaultProvider) ? 'ok' : 'warn', detail: String(defaultProvider || 'unset') });
}

for (const id of wanted) {
  const p = store?.settings?.providers?.[id];
  if (!p) {
    check({ name: `provider “${id}”`, status: 'fail', detail: 'not in settings.providers' });
    continue;
  }
  const enc = p.apiKeyEnc || '';
  let apiKey = '';
  if (CLI_KEY) apiKey = CLI_KEY.trim();
  else if (enc) {
    const { decryptSecret } = await import(pathToFileURL(path.join(process.cwd(), 'src/lib/crypto.js')).href);
    apiKey = decryptSecret(store.secret, enc) || '';
  }
  const keySource = CLI_KEY ? '--api-key flag' : enc ? 'encrypted in store' : '';
  const family = id === 'gemini' ? 'gemini' : 'openai';
  const baseUrl = (p.baseUrl || '').replace(/\/+$/, '');
  const rec = {
    id,
    family,
    label: p.label || id,
    enabled: p.enabled !== false,
    baseUrl,
    imageModel: p.imageModel || '',
    visionModel: p.visionModel || '',
    textModel: p.textModel || '',
    imageSize: p.imageSize || '',
    keySaved: Boolean(apiKey),
    keySource,
    masked: apiKey ? mask.maskKey(apiKey) : '',
    fingerprint: apiKey ? mask.fingerprint(apiKey) : '',
    http: { attempted: false },
  };
  providers.push(rec);

  out(`\n  ${C.b}${rec.label}${C.x} ${C.d}(${id} · ${family} wire)${C.x}`);
  check({ name: 'enabled', status: rec.enabled ? 'ok' : 'warn', detail: rec.enabled ? '' : 'disabled — the studio will not call it' });
  let url = null;
  try {
    url = new URL(baseUrl);
    check({ name: 'base URL', status: url.protocol === 'https:' ? 'ok' : 'warn', detail: `${baseUrl}${url.protocol === 'https:' ? '' : ' — plain http, keys travel unreadable'}` });
  } catch {
    check({ name: 'base URL', status: 'fail', detail: `“${baseUrl || '(empty)'}” is not an absolute URL — e.g. https://generativelanguage.googleapis.com/v1beta` });
  }
  check({
    name: 'API key',
    status: apiKey ? 'ok' : 'fail',
    detail: apiKey ? `${rec.masked} · fp ${rec.fingerprint} · ${keySource}` : 'none saved — admin → AI keys, or pass --api-key for a dry run',
  });
  if (apiKey && looksMasked(apiKey)) {
    check({ name: 'key shape', status: 'fail', detail: 'this looks like a masked value from the UI (has an ellipsis) — paste the full key' });
  } else if (apiKey) {
    check({ name: 'key shape', status: apiKey.length >= 20 ? 'ok' : 'warn', detail: `${apiKey.length} chars` });
  }
  const legacy = ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation'];
  if (!rec.imageModel) {
    check({ name: 'image model', status: 'fail', detail: 'empty — no image lane, generation cannot run' });
  } else if (/imagen/i.test(rec.imageModel)) {
    check({ name: 'image model', status: 'fail', detail: `${rec.imageModel} is not a generateContent model here — use gemini-3.1-flash-image-preview (Nano Banana 2)` });
  } else if (legacy.includes(rec.imageModel)) {
    check({ name: 'image model', status: 'warn', detail: `${rec.imageModel} is the legacy lane; Nano Banana 2 = gemini-3.1-flash-image-preview` });
  } else {
    check({ name: 'image model', status: 'ok', detail: rec.imageModel });
  }
  if (family === 'gemini') {
    const szOk = ['', '1K', '2K', '4K'].includes(rec.imageSize);
    check({ name: 'image size', status: szOk ? 'ok' : 'fail', detail: `${rec.imageSize || 'provider default'}${szOk ? '' : ' — 1K, 2K or 4K only (anything else is a 400 from Google)'}` });
  }

  if (!NO_NET && url) await probeProvider(rec, apiKey, url, providers);
  else if (NO_NET) check({ name: 'network', status: 'skip', detail: '--no-net' });
}

/* ---------------------------------------------------------------- verdict */

let verdict = 'ready';
const advice = [];
const failed = (v, ...lines) => {
  if (verdict === 'ready') verdict = v;
  advice.push(...lines);
};
const defaultRec = providers.find((p) => p.id === defaultProvider) || providers[0];

if (storeError) failed('store_unreadable', `Fix data/store.json (${storeError}), then re-run.`);
if (!providers.length) failed('no_provider', 'Add a provider: admin → AI keys.');
if (defaultRec) {
  if (!defaultRec.enabled) failed('disabled', `Enable “${defaultRec.label}” in admin → AI keys.`);
  if (!defaultRec.baseUrl) failed('bad_url', `Set a Base URL on “${defaultRec.label}”, e.g. https://generativelanguage.googleapis.com/v1beta`);
  if (!defaultRec.keySaved) failed('no_key', `Paste the real key into admin → AI keys on “${defaultRec.label}” and press Enter.`);
  if (!defaultRec.imageModel) failed('no_image_model', 'Set the image model: gemini-3.1-flash-image-preview (Nano Banana 2).');
  if (defaultRec.http?.status && (defaultRec.http.status === 401 || defaultRec.http.status === 403)) failed('key_rejected', `Google/OpenAI rejected the key (HTTP ${defaultRec.http.status}). Check it is enabled on a project with the Generative Language API on, and that it is not restricted to other IPs/referrers.`);
  if (defaultRec.http?.status === 429) failed('rate_limited', 'Provider says 429 — wait a minute, then lower maxVariations.');
  if (defaultRec.http && defaultRec.http.transport === 'filtered') failed('filtered', `This machine reaches ${CONTROL.replace(/^https?:\/\//, '')} but not ${defaultRec.http.host}. The egress allow-list does not include the provider host — this is the Arena sandbox case. Run “npm run dev” where you have internet, or point Base URL at a gateway this box can reach.`);
  if (defaultRec.http && defaultRec.http.transport === 'no_network') failed('no_network', 'No outbound network at all (the control host is unreachable too).');
  if (defaultRec.http && defaultRec.http.transport === 'dns_failed') failed('dns_failed', `DNS cannot resolve ${defaultRec.http.host}. Check /etc/resolv.conf, VPN or a hosts-file entry.`);
  if (defaultRec.http && defaultRec.http.transport === 'tls_failed') failed('tls_failed', `TCP reaches ${defaultRec.http.host} but TLS fails — a MITM proxy or a missing CA. Set NODE_EXTRA_CA_CERTS to your proxy CA.`);
  if (defaultRec.http && defaultRec.http.transport === 'timeout') failed('timeout', `No answer from ${defaultRec.http.host} within ${NET_TIMEOUT} ms.`);
  if (defaultRec.http?.status === 200 && defaultRec.http.known && !defaultRec.http.modelPresent && defaultRec.http.modelLookup === 'complete') failed('model_missing', `${defaultRec.imageModel} is not in ${defaultRec.http.host}’s model list. Available image models: ${defaultRec.http.imageModels.slice(0, 6).join(', ') || '(none listed)'}`);
}
if (NO_NET && verdict === 'ready') verdict = 'unverified';

section(verdict === 'ready' ? `${C.g}Ready to generate.${C.x}` : `${C.y}${verdict}${C.x} — not ready`);
for (const a of advice) out(`  ${C.d}→${C.x} ${a}`);
if (verdict === 'unverified') out(`  ${C.d}→${C.x} config looks fine; re-run without --no-net to prove the endpoint answers`);
if (verdict === 'ready') out(`  ${C.d}→${C.x} key ${defaultRec.masked} will be called as ${defaultRec.baseUrl}/models/${defaultRec.imageModel}:generateContent`);
out(`\n  ${C.d}finished in ${((Date.now() - STARTED) / 1000).toFixed(1)}s${C.x}\n`);

const payload = {
  ok: verdict === 'ready',
  verdict,
  advice,
  dataDir: DATA_DIR,
  defaultProvider,
  elapsedMs: Date.now() - STARTED,
  orphans: orphans.slice(0, 10),
  providers: providers.map((p) => ({
    id: p.id,
    enabled: p.enabled,
    baseUrl: p.baseUrl,
    imageModel: p.imageModel,
    imageSize: p.imageSize,
    keySaved: p.keySaved,
    masked: p.masked,
    fingerprint: p.fingerprint,
    http: p.http,
  })),
};
if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
process.exit(verdict === 'ready' ? 0 : 1);

/* ------------------------------------------------------------------ utils */

function looksMasked(v) {
  return /\u2026|\.\.\./.test(String(v));
}

/**
 * DNS → TCP → TLS → one authenticated list call. Any HTTP status at all proves the route
 * exists, so reachability is decided before the key is judged. The control host is only probed
 * when the provider one fails, which is what separates "no internet" from "this host is filtered".
 */
async function probeProvider(rec, apiKey, url, _all) {
  const host = url.hostname;
  rec.http = { attempted: true, host };
  const t0 = Date.now();

  let ip = null;
  try {
    const recs = await withTimeout(dns.lookup(host, { all: true }), NET_TIMEOUT);
    ip = recs?.[0]?.address || null;
    rec.http.dns = { ok: Boolean(ip), addresses: (recs || []).map((r) => r.address).slice(0, 4) };
  } catch (err) {
    rec.http.transport = 'dns_failed';
    rec.http.dns = { ok: false, error: String(err?.code || err?.message || err) };
    check({ name: 'DNS', status: 'fail', detail: `${host} → ${rec.http.dns.error}` });
    await controlProbe(rec);
    return;
  }

  const sock = await tcpReach(host, 443, NET_TIMEOUT);
  if (!sock.ok) {
    rec.http.transport = classifyConnect(sock);
    rec.http.tcp = { ok: false, ms: sock.ms, code: sock.code };
    check({ name: 'TCP 443', status: 'fail', detail: `${host} (${ip}) → ${sock.code || 'failed'} after ${sock.ms} ms` });
    await controlProbe(rec);
    if (rec.http.transport === 'unknown') rec.http.transport = 'timeout';
    return;
  }
  rec.http.tcp = { ok: true, ms: sock.ms };
  sock.socket?.destroy();

  const endpoint = `${rec.baseUrl}/models`;
  const headers = {};
  if (apiKey) headers[rec.family === 'gemini' ? 'x-goog-api-key' : 'Authorization'] = rec.family === 'gemini' ? apiKey : `Bearer ${apiKey}`;
  try {
    const res = await withTimeout(fetch(endpoint, { headers, signal: AbortSignal.timeout(NET_TIMEOUT * 3), redirect: 'manual' }), NET_TIMEOUT * 3 + 200);
    rec.http.status = res.status;
    rec.http.ms = Date.now() - t0;
    if (res.ok) {
      let names = [];
      try {
        const j = await res.json();
        names = (j.data || j.models || []).map((m) => String(m.name || m.id || m)).map((n) => n.replace(/^models\//, ''));
      } catch {
        /* a gateway that does not list models still answered — that is the point */
      }
      if (names.length) {
        rec.http.known = true;
        rec.http.modelLookup = 'complete';
        rec.http.modelPresent = names.includes(rec.imageModel);
        rec.http.imageModels = names.filter((n) => /image|imagen/i.test(n));
        rec.http.total = names.length;
      }
      check({ name: 'endpoint', status: 'ok', detail: `${endpoint} → 200 in ${rec.http.ms} ms${names.length ? ` · ${names.length} models listed` : ''}` });
      if (names.length) {
        check({
          name: 'image model exists',
          status: rec.http.modelPresent ? 'ok' : 'fail',
          detail: rec.http.modelPresent ? `${rec.imageModel} is offered by this key` : `${rec.imageModel} not listed; image-capable: ${(rec.http.imageModels.slice(0, 4).join(', ') || 'none')}`,
        });
      }
    } else {
      const body = (await res.text().catch(() => '')).slice(0, 240).replace(/\s+/g, ' ');
      const hard = res.status === 401 || res.status === 403;
      check({ name: 'endpoint', status: hard ? 'fail' : 'warn', detail: `${endpoint} → HTTP ${res.status} ${body}` });
    }
  } catch (err) {
    const code = String(err?.cause?.code || err?.code || err?.name || err);
    rec.http.transport = /abort|timeout/i.test(code) ? 'timeout' : /self-signed|certificate|CERT|handshake/i.test(code) ? 'tls_failed' : 'unknown';
    rec.http.error = code;
    rec.http.ms = Date.now() - t0;
    check({ name: 'endpoint', status: 'fail', detail: `${endpoint} → ${code} after ${rec.http.ms} ms` });
    await controlProbe(rec);
    if (rec.http.transport === 'unknown') rec.http.transport = 'filtered';
  }
}

/** Reachability of a host that is expected to be allowed, to tell "offline" from "filtered". */
async function controlProbe(rec) {
  try {
    const u = new URL(CONTROL);
    const t = Date.now();
    const r = await fetch(u, { signal: AbortSignal.timeout(NET_TIMEOUT), method: 'HEAD', redirect: 'manual' }).catch(async () => fetch(u, { signal: AbortSignal.timeout(NET_TIMEOUT), redirect: 'manual' }));
    rec.http.control = { ok: true, host: u.hostname, status: r.status, ms: Date.now() - t };
  } catch (err) {
    rec.http.control = { ok: false, host: new URL(CONTROL).hostname, error: String(err?.cause?.code || err?.code || err?.name || err) };
  }
  const providerBlocked = rec.http.transport && rec.http.transport !== 'tls_failed';
  if (rec.http.control.ok && providerBlocked) rec.http.transport = 'filtered';
  else if (!rec.http.control.ok && providerBlocked) rec.http.transport = 'no_network';
  check({
    name: 'control host',
    status: rec.http.control.ok ? 'ok' : 'fail',
    detail: rec.http.control.ok
      ? `${rec.http.control.host} answered HTTP ${rec.http.control.status} in ${rec.http.control.ms} ms → the box has internet, so ${rec.http.host} itself is blocked${C.x}`
      : `${rec.http.control.host} unreachable too → no outbound network from this machine`,
  });
}

function classifyConnect({ code, ms }) {
  if (/ENETUNREACH|EHOSTUNREACH|ENONET/.test(code || '')) return 'no_network';
  if (/ECONNREFUSED|ECONNRESET|EPIPE/.test(code || '')) return ms < 1500 ? 'filtered' : 'unknown';
  if (/ETIMEDOUT/.test(code || '')) return 'timeout';
  return 'unknown';
}

function tcpReach(host, port, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve({ ...v, ms: Date.now() - t0 });
    };
    const socket = tls.connect({ host, port, servername: host, timeout, ALPNProtocols: ['http/1.1'] }, () => finish({ ok: true, socket }));
    socket.on('error', (err) => finish({ ok: false, code: String(err.code || err.message), socket }));
    socket.on('timeout', () => finish({ ok: false, code: 'ETIMEDOUT(tls)', socket }));
    // no separate net.connect: TLS handshake failures (proxy interception) then look like timeouts
    void net;
  });
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise.finally(() => clearTimeout(timer)), new Promise((_, reject) => (timer = setTimeout(() => reject(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })), ms)))]);
}
