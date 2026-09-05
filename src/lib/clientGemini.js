/**
 * Browser-side Gemini image lane.
 *
 * The studio normally asks the server to call the model. This module exists for the case where the
 * *server* cannot reach the provider (locked-down egress) but the person using it can: the tab calls
 * generateContent directly, with a key it keeps in sessionStorage — never sent to the server, never
 * written to disk, gone when the tab closes. The wire shape mirrors src/lib/ai.js exactly, including
 * the degradation ladder, so a browser run is not a second-class request.
 */
import { normalizeApiKey, fingerprintHex } from './keyFormat.js'; // relative, like the rest of src/lib: loadable by node as well as webpack
import { geminiTargets, isKeyRejection, withQueryKey, describeTargets, expressBase } from './geminiEndpoints.js';

const STORE_KEY = 'studio.geminiBrowserKey';

/**
 * A pasted masked value (AQ.…3f4w) is not a credential, and Google answers it with a bare
 * "API key not valid" — which reads as "your key is broken". So the tab checks the shape with
 * the same rules the admin form uses, and says what is wrong locally instead.
 */
function usableKey(key) {
  const { value, error } = normalizeApiKey(key, { min: 20 });
  if (!value) {
    const e = new Error('Brauzer kaliti bo‘sh — Admin → Gemini → “Browser lane” bo‘limiga to‘liq kalitni yozing.');
    e.preFlight = true;
    throw e;
  }
  if (error) {
    const e = new Error(error);
    e.preFlight = true;
    throw e;
  }
  return value;
}

/**
 * Tag every failure with the shape of the string that was sent. "API key not valid" on its own sends
 * a user back to the console; "a 9-character string was sent" tells them the paste never left the card.
 */
async function describeKeySent(value) {
  return { keyLength: String(value || '').length, keyFingerprint: await fingerprintHex(value), keyPrefix: String(value || '').slice(0, 3) };
}

function tagError(err, sent, endpoints) {
  Object.assign(err, sent, { endpoints: endpoints || err.endpoints || '' });
  return err;
}

export function readBrowserKey() {
  try {
    return sessionStorage.getItem(STORE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeBrowserKey(value) {
  try {
    const v = String(value || '').trim();
    if (v) sessionStorage.setItem(STORE_KEY, v);
    else sessionStorage.removeItem(STORE_KEY);
    return v;
  } catch {
    return '';
  }
}

function headersFor(key) {
  // header, not query string — a URL key lands in logs and history
  return { 'content-type': 'application/json', 'x-goog-api-key': String(key || '') };
}

function hostOf(baseUrl) {
  try {
    const u = new URL(String(baseUrl).replace(/\/+$/, '') + '/models');
    return `${u.host}${u.pathname}`;
  } catch {
    return String(baseUrl || 'endpoint');
  }
}

/** same rule as the server: only the Gemini-3 image lanes understand imageSize */
const wantsSize = (model) => /gemini-3|gemini-3\.1|nano/i.test(String(model || ''));

function bodyFor({ prompt, refs, aspect, size, model }) {
  const parts = [{ text: prompt }];
  for (const r of refs || []) {
    const mime = /^data:([^;]+);/.exec(r)?.[1] || 'image/png';
    parts.push({ inlineData: { mimeType: mime, data: String(r).replace(/^data:[^,]+,/, '') } });
  }
  const imageConfig = { ...(aspect ? { aspectRatio: aspect } : {}), ...(size && wantsSize(model) ? { imageSize: size } : {}) };
  return JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      temperature: 0.9,
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  });
}

function parseImages(data) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const images = (parts || []).filter((p) => p.inlineData?.data).map((p) => ({ mime: p.inlineData.mimeType || 'image/png', base64: p.inlineData.data }));
  return { images, note: parts.map((p) => p.text || '').join(' ').trim(), finishReason: cand?.finishReason || '' };
}

async function post(target, body, key, signal) {
  const url = target.queryKey ? withQueryKey(target.url, key) : target.url;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: target.headers ? target.headers(key) : headersFor(key), body, credentials: 'omit', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Bekor qilindi.');
    throw new Error(`Brauzerdan ${hostOf(url)} ga borib bo‘lmadi (${String(err?.message || err)}). Internet, VPN yoki “API keys are restricted by HTTP referrer” ekanligini tekshiring.`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* gateway error page */
  }
  if (!res.ok) {
    const msg = data?.error?.message || text.slice(0, 200);
    const err = new Error(
      res.status === 400 && /API key not valid|invalid/i.test(msg)
        ? `Kalit yaroqsiz (400): ${msg.slice(0, 160)}`
        : res.status === 403
          ? `Kalit rad etildi (403). Google AI Studio kalitingiz HTTP referrer bilan cheklangan bo‘lishi mumkin.`
          : res.status === 429
            ? 'Limit tugadi (429) — bir lahza kutib qayta urinib ko’ring.'
            : res.status === 404
              ? `Model topilmadi (404): ${msg.slice(0, 140)}`
              : `HTTP ${res.status}: ${String(msg).slice(0, 200)}`,
      { status: res.status }
    );
    err.detail = msg;
    err.retryableShape = /imageSize|imageConfig|aspectRatio|Invalid JSON payload/i.test(msg);
    throw err;
  }
  return data;
}

/**
 * One variation → N images, exactly like the server call. Degrades one knob at a time instead of
 * losing the aspect ratio when a gateway rejects parts of imageConfig.
 */
export async function generateInBrowser({ baseUrl, key, model, prompt, refs = [], aspect, imageSize, wire, signal }) {
  const usable = usableKey(key);
  const sent = await describeKeySent(usable);
  const targets = geminiTargets({ baseUrl, model, key: usable, wire });
  const size = /^(1K|2K|4K)$/.test(String(imageSize || '')) ? imageSize : '';
  const args = { prompt, refs, aspect, size, model };
  // one family at a time; inside a family, degrade one knob at a time (older gateways reject parts
  // of imageConfig, and losing the aspect ratio silently would be worse than a uglier retry)
  const attempt = async (t) => {
    try {
      return await post(t, bodyFor(args), usable, signal);
    } catch (err) {
      if (err.retryableShape && /imageSize|2K|4K|resolution/i.test(String(err.detail))) return await post(t, bodyFor({ ...args, size: '' }), usable, signal);
      if (err.retryableShape) return await post(t, bodyFor({ ...args, aspect: null, size: '' }), usable, signal);
      throw err;
    }
  };
  let data;
  let lastErr;
  for (const t of targets) {
    try {
      data = await attempt(t);
      data.__endpoint = t.kind;
      break;
    } catch (err) {
      lastErr = lastErr || err;
      if (!isKeyRejection(err)) {
        // a transport failure on the fallback door must not hide the rejection that motivated it
        const why = lastErr !== err ? `${lastErr?.message || lastErr} · keyin ${err?.message || err}` : String(err?.message || err);
        throw tagError(Object.assign(new Error(why), { status: err?.status, detail: err?.detail, empty: err?.empty }), sent, describeTargets(targets));
      }
    }
  }
  if (!data) throw tagError(lastErr || new Error('Gemini javob bermadi'), sent, describeTargets(targets));
  const { images, note, finishReason } = parseImages(data);
  if (!images.length) {
    const blocked = finishReason === 'IMAGE_SAFETY' || /safety|blocked/i.test(note);
    const e = new Error(blocked ? 'Model kontentni xavfsizlik sababli blokladi.' : `Model rasm qaytmadi${note ? `: ${note.slice(0, 160)}` : ''}`);
    e.empty = true;
    Object.assign(e, sent);
    throw e;
  }
  return images.map((i) => ({ ...i, model, provider: 'gemini', endpoint: data.__endpoint || 'generativelanguage', ...sent }));
}

/** free call — lists models, so a key can be proven good before anything is generated */
/**
 * The free check: list the models this key can see, and say *which family* answered. That single
 * fact tells the user whether their key is an AI Studio key or a Cloud/express key, which is the
 * thing a bare "API key not valid" never explains.
 */
export async function pingBrowserKey({ baseUrl, key, wire, signal }) {
  let usable = '';
  try {
    usable = usableKey(key);
  } catch (err) {
    return { ok: false, preFlight: true, error: String(err?.message || err), ...(await describeKeySent(String(key || ''))) };
  }
  const listTargets = [
    { kind: 'generativelanguage', label: 'Google AI Studio API', url: `${String(baseUrl).replace(/\/+$/, '')}/models?pageSize=200` },
    { kind: 'vertex-express', label: 'Vertex express', url: `${expressBase(baseUrl)}/publishers/google/models?pageSize=200`, queryKey: true },
  ];
  const wanted = String(wire || 'auto').toLowerCase();
  const order =
    wanted === 'google' || wanted === 'aistudio' ? [listTargets[0]]
    : wanted === 'vertex' || wanted === 'express' ? [listTargets[1]]
    : /aiplatform\.googleapis\.com/i.test(String(baseUrl || ''))
      ? [listTargets[1], listTargets[0]]
      : listTargets;

  const tried = [];
  let last = null;
  for (const t of order) {
    const url = t.queryKey ? withQueryKey(t.url, usable) : t.url;
    try {
      const res = await fetch(url, { headers: headersFor(usable), credentials: 'omit', signal });
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* not json */
      }
      if (!res.ok) {
        last = { ok: false, endpoint: t.kind, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
        tried.push(`${t.kind}:${res.status}`);
        if (isKeyRejection({ message: last.error, status: res.status, detail: text })) continue;
        return { ...last, tried };
      }
      const names = (data?.models || data?.data || []).map((m) => String(m.name || m.id || '').replace(/^models\//, ''));
      return { ok: true, endpoint: t.kind, status: res.status, models: names.length, names, tried: [...tried, `${t.kind}:200`] };
    } catch (err) {
      last = { ok: false, endpoint: t.kind, error: `brauzerdan javob kelmadi (${String(err?.message || err)})` };
      tried.push(`${t.kind}:net`);
    }
  }
  return { ...(last || { ok: false, error: 'hech bir endpoint javob bermadi' }), tried };
}

/** tiny pool, so 4 variations do not become 4 simultaneous vendor calls */
export async function pooledBrowser(tasks, limit = 2) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await tasks[idx]() };
      } catch (err) {
        results[idx] = { ok: false, error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
