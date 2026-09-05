/**
 * Tiny JSON-file datastore with atomic writes + in-process cache.
 *
 * Everything this app needs (users, encrypted AI keys, design history, events)
 * lives in DATA_DIR/store.json. No DB server, no native modules, and the file
 * is git-ignored because it holds API keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');

const STORE_FILE = path.join(DATA_DIR, 'store.json');

export const MAX_EVENTS = 400;
export const MAX_DESIGNS = 500;

const empty = () => ({
  version: 1,
  secret: '',
  settings: {
    appName: 'Studio',
    defaultProvider: 'gemini',
    allowSelfServeKeys: true,
    maxVariations: 4,
    refinePrompt: true,
    providers: {
      gemini: {
        label: 'Google Gemini',
        apiKeyEnc: '',
        enabled: true,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        visionModel: 'gemini-2.5-flash',
        textModel: 'gemini-2.5-flash',
        imageModel: 'gemini-2.5-flash-image',
      },
      openai: {
        label: 'OpenAI',
        apiKeyEnc: '',
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
        visionModel: 'gpt-4o-mini',
        textModel: 'gpt-4o-mini',
        imageModel: 'gpt-image-1',
      },
      custom: {
        label: 'Custom (OpenAI-compatible)',
        apiKeyEnc: '',
        enabled: false,
        baseUrl: '',
        visionModel: 'gpt-4o-mini',
        textModel: 'gpt-4o-mini',
        imageModel: 'gpt-image-1',
      },
    },
  },
  users: {},
  designs: {},
  events: [],
});

let cache = null;
let writeTimer = null;
let mutex = Promise.resolve();

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function loadSync() {
  if (cache) return cache;
  ensureDirs();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...empty(), ...parsed };
    cache.settings = { ...empty().settings, ...(parsed.settings || {}) };
    cache.settings.providers = {
      ...empty().settings.providers,
      ...(parsed.settings?.providers || {}),
    };
  } catch {
    cache = empty();
  }
  if (!cache.secret) {
    cache.secret = crypto.randomBytes(32).toString('hex');
    persistSync();
  }
  return cache;
}

function persistSync() {
  ensureDirs();
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

/** Debounced write-behind flush (keeps hot paths cheap). */
function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      persistSync();
    } catch (err) {
      console.error('[store] persist failed', err);
    }
  }, 120);
  if (typeof writeTimer.unref === 'function') writeTimer.unref();
}

/**
 * Read-modify-write against the store, serialized so writes never interleave.
 * A failed transaction must never poison the queue for the callers after it.
 */
export async function withStore(mutator) {
  const run = async () => {
    const s = loadSync();
    const out = await mutator(s);
    schedulePersist();
    return out;
  };
  mutex = mutex.catch(() => {}).then(run);
  return mutex;
}

export function readStore() {
  return loadSync();
}

/** The write-behind timer is short, but never lose a key save on shutdown. */
if (typeof process !== 'undefined' && process.on && !process.env.NEXT_RUNTIME?.includes('edge')) {
  for (const sig of ['SIGINT', 'SIGTERM', 'beforeExit']) {
    try {
      process.on(sig, () => flushStore());
    } catch {
      /* ignore */
    }
  }
}

export function flushStore() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (cache) persistSync();
}

export function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

/** slug for "javohir.ali" style identity from name + surname */
export function slugName(firstName, lastName) {
  return `${firstName} ${lastName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/* ------------------------------------------------------------------ files */

function safeJoin(rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(FILES_DIR, clean);
  if (!abs.startsWith(path.resolve(FILES_DIR))) throw new Error('bad path');
  return abs;
}

export async function saveFile(rel, buf, mime = 'image/png') {
  const abs = safeJoin(rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf);
  await fs.promises.writeFile(`${abs}.mime`, mime).catch(() => {});
  return { rel, bytes: buf.length, mime };
}

export async function readFile(rel) {
  const abs = safeJoin(rel);
  const buf = await fs.promises.readFile(abs);
  let mime = 'application/octet-stream';
  try {
    mime = (await fs.promises.readFile(`${abs}.mime`, 'utf8')).trim();
  } catch {
    mime = mimeForPath(abs);
  }
  return { buf, mime };
}

export async function deleteFile(rel) {
  const abs = safeJoin(rel);
  await fs.promises.rm(abs, { force: true });
  await fs.promises.rm(`${abs}.mime`, { force: true });
}

export function mimeForPath(p) {
  const ext = path.extname(p).toLowerCase();
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream'
  );
}

/* --------------------------------------------------------------- helpers */

export function pushEvent(s, ev) {
  s.events = Array.isArray(s.events) ? s.events : [];
  s.events.unshift({ id: uid('ev_'), at: new Date().toISOString(), ...ev });
  if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
}

export async function upsertDesign(s, design) {
  s.designs = s.designs || {};
  const id = design.id || uid('dsg_');
  const prev = s.designs[id] || {};
  s.designs[id] = { ...prev, ...design, id, updatedAt: new Date().toISOString() };
  const ids = Object.values(s.designs)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(MAX_DESIGNS)
    .map((d) => d.id);
  for (const drop of ids) {
    for (const item of drop.items || []) if (item.file) await deleteFile(item.file).catch(() => {});
    delete s.designs[drop];
  }
  return s.designs[id];
}
