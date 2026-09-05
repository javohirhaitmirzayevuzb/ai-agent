/**
 * Provider layer. Two families are supported out of the box (Google Gemini and
 * OpenAI) plus any OpenAI-compatible gateway ("custom"). Keys come from the
 * admin panel, or from a user's own profile when self-serve keys are allowed.
 */
import { decryptSecret, fingerprint } from './crypto.js';
import { extractJson, buildAnalysisPrompt, buildDirectorPrompt } from './prompts.js';
import { geminiTargets, isKeyRejection, withQueryKey, describeTargets } from './geminiEndpoints.js';

export class AiError extends Error {
  constructor(message, { status = 502, provider, detail } = {}) {
    super(message);
    this.status = status;
    this.provider = provider;
    this.detail = detail;
  }
}

const TIMEOUT_ANALYSE = 90_000;
const TIMEOUT_TEXT = 75_000;
const TIMEOUT_IMAGE = 240_000;

/* ------------------------------------------------------------- selection */

function providerEntry(store, id, user) {
  const base = store.settings?.providers?.[id];
  if (!base) return null;
  // the request's user object is the *public* shape — pull the raw record for key material
  const raw = store.users?.[user?.id] || user || {};
  const own = raw.keys?.[id]?.apiKeyEnc ? raw.keys[id] : null;
  const enc = own?.apiKeyEnc || base.apiKeyEnc;
  const apiKey = enc ? decryptSecret(store.secret, enc) : '';
  return {
    id,
    label: base.label,
    // which wire protocol to speak — must be on the engine object, every call path keys off it
    family: id === 'gemini' ? 'gemini' : 'openai',
    enabled: base.enabled !== false,
    baseUrl: (own?.baseUrl || base.baseUrl || '').replace(/\/+$/, ''),
    visionModel: own?.visionModel || base.visionModel,
    textModel: own?.textModel || base.textModel,
    imageModel: own?.imageModel || base.imageModel,
    // 1K / 2K / 4K — only the Gemini 3 image lanes (Nano Banana 2 / Pro) accept it
    imageSize: own?.imageSize || base.imageSize || '',
    // 'auto' | 'google' | 'vertex' — which endpoint family the key was issued for
    wire: own?.wire || base.wire || 'auto',
    apiKey,
    scope: own ? 'own key' : 'admin key',
    fingerprint: fingerprint(apiKey),
  };
}

export function listProviders(store, user) {
  const ids = Object.keys(store.settings?.providers || {});
  return ids
    .map((id) => {
      const p = providerEntry(store, id, user);
      if (!p) return null;
      return {
        id,
        label: p.label,
        enabled: p.enabled,
        hasKey: Boolean(p.apiKey),
        scope: p.apiKey ? p.scope : '',
        baseUrl: p.baseUrl,
        visionModel: p.visionModel,
        textModel: p.textModel,
        imageModel: p.imageModel,
        masked: p.apiKey ? `${p.apiKey.slice(0, 3)}…${p.apiKey.slice(-4)}` : '',
        family: p.id === 'gemini' ? 'gemini' : 'openai',
      };
    })
    .filter(Boolean);
}

/** Pick the engine for a capability: image | vision | text. */
export function pickEngine(store, user, capability = 'image', preferred) {
  const ids = Object.keys(store.settings.providers || {});
  const order = preferred ? [preferred, ...ids.filter((i) => i !== preferred)] : ids;
  const need = capability === 'image' ? 'imageModel' : capability === 'text' ? 'textModel' : 'visionModel';
  const fallbackDefault = store.settings.defaultProvider;
  const ranked = [...order].sort((a, b) => {
    const score = (id) => {
      const p = providerEntry(store, id, user);
      if (!p || !p.enabled || !p.apiKey || !p[need]) return 99;
      if (id === preferred) return 0;
      if (id === fallbackDefault) return 1;
      return 2;
    };
    return score(a) - score(b);
  });
  for (const id of ranked) {
    const p = providerEntry(store, id, user);
    if (p && p.enabled && p.apiKey && p[need]) return p;
  }
  return null;
}

export function capabilityReport(store, user) {
  return {
    analyse: Boolean(pickEngine(store, user, 'vision')),
    director: Boolean(pickEngine(store, user, 'text')),
    image: Boolean(pickEngine(store, user, 'image')),
    providers: listProviders(store, user),
    allowSelfServeKeys: store.settings.allowSelfServeKeys !== false,
    maxVariations: store.settings.maxVariations || 4,
    defaultProvider: store.settings.defaultProvider,
    refinePrompt: store.settings.refinePrompt !== false,
  };
}

/* ------------------------------------------------------------- transport */

async function call(url, { headers, body, timeout, provider, label }) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    // name the endpoint in the message: the alternative reading of a bare "network error"
    // is "the app drew this itself", which is exactly what the studio must never look like
    let host = url;
    try {
      const u = new URL(url);
      host = `${u.host}${u.pathname}`;
    } catch {
      /* relative test URL */
    }
    throw new AiError(
      timedOut
        ? `${label} vaqtida javob bermadi (${host}) — qayta urinib ko’ring.`
        : `Tarmoq xatosi (${label}) — so’rov ${host} ga borib ulanmadi. Serverda tashqi tarmoq yo‘qmi?`,
      { status: timedOut ? 504 : 502, provider, detail: String(err?.message || err), endpoint: host }
    );
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON gateway error */
  }
  if (!res.ok) {
    const apiMsg = data?.error?.message || data?.error?.status || text.slice(0, 300);
    const friendly =
      res.status === 400 && /API key not valid|permissions and quota|invalid_api_key|Incorrect API key/i.test(apiMsg + text)
        ? 'API kaliti yaroqsiz. Admin panel tekshiring.'
        : res.status === 401 || res.status === 403
          ? 'API kaliti rad etildi (auth).'
          : res.status === 429
            ? 'Limit tugadi (429). Bir lahza kutib, qayta urinib ko’ring.'
            : res.status === 404
              ? `Model topilmadi (${apiMsg}). Admin panelda model nomini yangilang.`
              : `${label} xatosi ${res.status}: ${String(apiMsg).slice(0, 220)}`;
    throw new AiError(friendly, { status: res.status >= 500 ? 502 : res.status, provider, detail: apiMsg });
  }
  return data || {};
}

const geminiErr = (d, provider) => {
  if (d?.error?.message) throw new AiError(`Gemini: ${String(d.error.message).slice(0, 300)}`, { provider });
  return d;
};

/* ------------------------------------------------------------ vision AI */

/**
 * One generateContent call, tried against each endpoint family that could accept this key.
 *
 * `400 API key not valid` from the Generative Language API does not prove a broken key — an
 * express-mode Cloud key says the same thing back, and vice versa. Advancing to the other family is
 * only safe because isKeyRejection() refuses to treat anything else (timeouts, 429, safety blocks)
 * as a reason to knock on a second door. Which family answered lands on the engine, so the result
 * tiles can say so instead of the user guessing.
 */
async function callGemini(engine, { model, payload, label, timeout }) {
  const targets = geminiTargets({ baseUrl: engine.baseUrl, model, key: engine.apiKey, wire: engine.wire });
  let last;
  for (const t of targets) {
    const url = t.queryKey ? withQueryKey(t.url, engine.apiKey) : t.url;
    try {
      const data = await call(url, { headers: t.headers(engine.apiKey), body: JSON.stringify(payload), timeout, provider: engine.id, label: `${label} \u00b7 ${t.label}` });
      const checked = geminiErr(data, engine.id);
      engine.endpointUsed = t.kind;
      return checked;
    } catch (err) {
      last = last || err;
      (engine.endpointsTried || (engine.endpointsTried = [])).push(`${t.kind}:${err?.status || 'net'}`);
      if (!isKeyRejection(err)) throw err;
    }
  }
  const where = describeTargets(targets);
  throw new AiError(`${String(last?.message || 'Gemini javob bermadi')} — urilgani: ${where}`, {
    status: last?.status || 502,
    provider: engine.id,
    detail: last?.detail,
    endpoint: last?.endpoint,
    endpoints: where,
  });
}

const textOf = (d) => (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');

export async function analyseDesign({ engine, dataUrl, signals }) {
  const prompt = buildAnalysisPrompt(signals);
  const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] || 'image/png';
  const b64 = dataUrl.replace(/^data:[^,]+,/, '');

  if (engine.family === 'gemini') {
    const d = await callGemini(engine, {
      model: engine.visionModel,
      payload: {
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.35, maxOutputTokens: 4096 },
      },
      label: 'Gemini vision',
      timeout: TIMEOUT_ANALYSE,
    });
    const txt = textOf(d);
    const json = extractJson(txt);
    if (!json) throw new AiError('Model JSON qaytarmadi — qayta urinib ko’ring.', { provider: engine.id, detail: txt.slice(0, 200) });
    return { analysis: json, raw: txt, model: engine.visionModel };
  }

  const d = await call(`${engine.baseUrl}/chat/completions`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.apiKey}` },
    body: JSON.stringify({
      model: engine.visionModel,
      temperature: 0.35,
      response_format: { type: 'json_object' },
      max_tokens: 2600,
      messages: [
        { role: 'system', content: 'Return strict JSON only.' },
        { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }] },
      ],
    }),
    timeout: TIMEOUT_ANALYSE,
    provider: engine.id,
    label: 'Vision',
  });
  const txt = d.choices?.[0]?.message?.content || '';
  const json = extractJson(txt);
  if (!json) throw new AiError('Model JSON qaytarmadi — qayta urinib ko’ring.', { provider: engine.id, detail: txt.slice(0, 200) });
  return { analysis: json, raw: txt, model: engine.visionModel };
}

/* ------------------------------------------------------- art direction */

export async function artDirect({ engine, analysis, brief }) {
  const prompt = buildDirectorPrompt({ analysis, brief });
  try {
    if (engine.family === 'gemini') {
      const d = await callGemini(engine, {
        model: engine.textModel,
        payload: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
        },
        timeout: TIMEOUT_TEXT,
        label: 'Gemini',
      });
      const txt = textOf(d).trim();
      if (txt) return txt.slice(0, 1600);
    } else {
      const d = await call(`${engine.baseUrl}/chat/completions`, {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.apiKey}` },
        body: JSON.stringify({
          model: engine.textModel,
          temperature: 0.7,
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
        timeout: TIMEOUT_TEXT,
        provider: engine.id,
        label: 'Director',
      });
      const txt = d.choices?.[0]?.message?.content?.trim();
      if (txt) return txt.slice(0, 1600);
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
  }
  return '';
}

/* ------------------------------------------------------------- image gen */

/** Returns [{ mime, base64, model }] — base64 only, the route decides storage. */
export async function generateImages({ engine, prompt, refs = [], aspect, timeout = TIMEOUT_IMAGE }) {
  if (engine.family === 'gemini') return geminiImages({ engine, prompt, refs, aspect, timeout });
  return openaiImages({ engine, prompt, refs, aspect, timeout });
}

async function geminiImages({ engine, prompt, refs, aspect, timeout }) {
  const parts = [{ text: prompt }];
  for (const r of refs) {
    const mime = /^data:([^;]+);/.exec(r)?.[1] || 'image/png';
    parts.push({ inlineData: { mimeType: mime, data: r.replace(/^data:[^,]+,/, '') } });
  }
  const wantsSize = /gemini-3|gemini-3\.1|nano/i.test(String(engine.imageModel || ''));
  const bodyFor = (ratio, size) => {
    const imageConfig = { ...(ratio ? { aspectRatio: ratio } : {}), ...(size && wantsSize ? { imageSize: size } : {}) };
    return {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        temperature: 0.9,
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      },
    };
  };
  const size = /^(1K|2K|4K)$/.test(String(engine.imageSize || '')) ? engine.imageSize : '';
  const doCall = (payload) => callGemini(engine, { model: engine.imageModel, payload, timeout, label: 'Gemini image' });

  let data;
  try {
    data = await doCall(bodyFor(aspect || null, size));
  } catch (err) {
    // Older / gateway-proxied Gemini builds reject parts of `imageConfig`; degrade one
    // knob at a time rather than losing the aspect ratio the format was chosen for.
    const msg = String(err?.detail || err?.message || '');
    if (/imageSize|resolution|2K|4K/i.test(msg)) data = await doCall(bodyFor(aspect || null, ''));
    else if (/imageConfig|aspectRatio|Invalid JSON payload/i.test(msg)) data = await doCall(bodyFor(null, ''));
    else throw err;
  }

  const cand = data.candidates?.[0];
  const outParts = cand?.content?.parts || [];
  const images = outParts
    .filter((p) => p.inlineData?.data)
    .map((p) => ({ mime: p.inlineData.mimeType || 'image/png', base64: p.inlineData.data }));
  if (!images.length) {
    const note = outParts.map((p) => p.text || '').join(' ').trim();
    const reason = cand?.finishReason === 'IMAGE_SAFETY' || /safety|blocked/i.test(note) ? 'Model kontentni xavfsizlik sababli blokladi.' : 'Model rasm qaytmadi';
    throw new AiError(`${reason}${note ? `: ${note.slice(0, 160)}` : ''}`, { provider: engine.id, detail: note });
  }
  return images.map((i) => ({ ...i, model: engine.imageModel, provider: engine.id, endpoint: engine.endpointUsed || 'generativelanguage' }));
}

async function openaiImages({ engine, prompt, refs, aspect, timeout }) {
  const isDalle = /dall[eE]-?3/.test(engine.imageModel);
  const model = engine.imageModel;
  const size = openaiSize(model, aspect);
  const tasks = refs.length
    ? async (n) => {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        if (!isDalle) form.append('n', '1'); // dall-e edits accepts exactly one image and no n
        if (size) form.append('size', size);
        if (!isDalle) form.append('quality', 'high');
        refs.slice(0, isDalle ? 1 : 4).forEach((r, i) => {
          const [mime, b64] = r.replace(/^data:([^;]+);base64,/, '$1 ').trim().split(' ');
          const buf = Buffer.from(b64, 'base64');
          form.append(i === 0 && isDalle ? 'image' : 'image[]', new Blob([buf], { type: mime || 'image/png' }), `ref-${i + 1}.${(mime || 'image/png').split('/')[1]}`);
        });
        const url = `${engine.baseUrl}/images/edits`;
        return callMultipart(url, engine, form, timeout);
      }
    : async () =>
        call(
          `${engine.baseUrl}/images/generations`,
          {
            headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.apiKey}` },
            body: JSON.stringify({
              model,
              prompt,
              n: 1,
              ...(size ? { size } : {}),
              ...(isDalle ? { response_format: 'b64_json' } : { output_format: 'png' }),
              ...(model.startsWith('gpt-image') ? { quality: 'high' } : {}),
            }),
            timeout,
            provider: engine.id,
            label: 'OpenAI image',
          }
        );

  const out = [];
  const data = await tasks(1);
  for (const item of data?.data || []) {
    if (item.b64_json) out.push({ mime: 'image/png', base64: item.b64_json, model, provider: engine.id });
    else if (item.url) {
      const res = await fetch(item.url, { signal: AbortSignal.timeout(timeout) });
      if (res.ok) out.push({ mime: res.headers.get('content-type') || 'image/png', base64: Buffer.from(await res.arrayBuffer()).toString('base64'), model, provider: engine.id });
    }
  }
  if (!out.length) throw new AiError('OpenAI rasm qaytmadi.', { provider: engine.id, detail: JSON.stringify(data).slice(0, 200) });
  return out;
}

function openaiSize(model, aspect) {
  if (/gpt-image/.test(model)) {
    if (/^9:16|^2:3|^4:5/.test(aspect || '')) return '1024x1536';
    if (/^16:9|^21:9|^3:2/.test(aspect || '')) return '1536x1024';
    return '1024x1024';
  }
  if (/dall[eE]/.test(model)) {
    if (/^9:16|^2:3|^4:5/.test(aspect || '')) return '1024x1792';
    if (/^16:9|^21:9|^3:2/.test(aspect || '')) return '1792x1024';
    return '1024x1024';
  }
  return '';
}

async function callMultipart(url, engine, form, timeout) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${engine.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new AiError('OpenAI bilan aloqa uzildi.', { provider: engine.id, detail: String(err?.message || err) });
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg = data?.error?.message || text.slice(0, 300);
    throw new AiError(/safety|content_policy/i.test(msg) ? 'Model kontentni rad etdi (policy).' : `OpenAI xatosi ${res.status}: ${String(msg).slice(0, 240)}`, {
      status: res.status,
      provider: engine.id,
      detail: msg,
    });
  }
  return data || {};
}

/* --------------------------------------------------------------- testing */

export async function testConnection({ id, apiKey, baseUrl, models = {} }) {
  const out = { ok: true, id, checks: [] };
  const gemini = id === 'gemini';
  const base = (baseUrl || '').replace(/\/+$/, '');
  const ping = async (kind, model) => {
    if (!model) {
      out.checks.push({ kind, model: '—', ok: false, note: 'model sozlanmagan' });
      return;
    }
    const t0 = Date.now();
    try {
      const probeEngine = { id, apiKey, baseUrl: base, family: 'gemini', wire: models.wire };
      if (gemini) {
        const d = await callGemini(probeEngine,
          {
            model,
            payload: {
              contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
              generationConfig:
                kind === 'image'
                  ? { responseModalities: ['IMAGE', 'TEXT'] }
                  : { temperature: 0, maxOutputTokens: 16 },
            },
            timeout: 60_000,
            label: `${kind} test`,
          }
        );
        const parts = d.candidates?.[0]?.content?.parts || [];
        const hasImage = kind === 'image' ? parts.some((p) => p.inlineData?.data) : true;
        out.checks.push({ kind, model, ok: hasImage, ms: Date.now() - t0, via: models.wire === 'auto' ? 'auto' : undefined, note: `${hasImage ? 'javob keldi' : 'rasm qaytmadi'}${probeEngine.endpointUsed ? ` · ${probeEngine.endpointUsed}` : ''}` });
      } else if (kind === 'models' || kind === 'vision') {
        const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
        const text = await res.text();
        out.checks.push({
          kind: 'key',
          model: gemini ? '—' : 'GET /models',
          ok: res.ok,
          ms: Date.now() - t0,
          note: res.ok ? 'kalit yaroqli' : `HTTP ${res.status} ${text.slice(0, 120)}`,
        });
      } else {
        const d = await call(`${base}/chat/completions`, {
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 16 }),
          timeout: 60_000,
          provider: id,
          label: `${kind} test`,
        });
        out.checks.push({ kind, model, ok: Boolean(d.choices?.[0]?.message?.content), ms: Date.now() - t0, note: (d.choices?.[0]?.message?.content || '').slice(0, 40) });
      }
    } catch (err) {
      out.checks.push({ kind, model, ok: false, ms: Date.now() - t0, note: String(err?.message || err).slice(0, 220) });
    }
  };

  if (!apiKey) return { ok: false, id, checks: [{ kind: 'key', model: '—', ok: false, note: 'kalit bo’sh' }] };
  await ping('key', null);
  await ping('vision', models.visionModel);
  await ping('text', models.textModel);
  await ping('image', models.imageModel);
  out.ok = out.checks.some((c) => c.ok);
  return out;
}
