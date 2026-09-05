/**
 * Shared generation core.
 *
 * Split out of the /api/generate route because a generation is two separable things:
 * deciding *what to ask the model* (needs the store, the analysis, the brief, the reference
 * bytes) and *fetching pixels* (needs network + a key). The browser path in src/lib/clientGemini.js
 * does the second half when the server cannot — so both halves must be shared, not duplicated.
 */
import { readFile } from '@/lib/store';
import { buildGenerationPrompt, formatSpec } from '@/lib/prompts';
import { sanitizeText, clamp, badRequest } from '@/lib/http';

export const BRIEF_FIELDS = ['companyName', 'headline', 'subhead', 'tagline', 'cta', 'footer', 'kicker', 'topic', 'insight', 'tone', 'audience', 'offer', 'platform'];

export function cleanBrief(raw = {}) {
  const out = {};
  for (const f of BRIEF_FIELDS) if (raw[f] !== undefined) out[f] = sanitizeText(raw[f], f === 'insight' ? 2400 : 220);
  out.format = typeof raw.format === 'string' && raw.format.length < 24 ? raw.format : 'post-1x1';
  out.aspect = formatSpec(out.format).gemini;
  out.count = clamp(raw.count ?? 2, 1, 4);
  out.refine = raw.refine !== false;
  out.mode = raw.mode === 'local' || raw.mode === 'ai' ? raw.mode : 'auto';
  out.instruction = sanitizeText(raw.instruction, 600);
  // opt-in, because a model failure must not be papered over unless the user asks for it
  out.allowLocal = raw.allowLocal === true;
  out.iterateOn = typeof raw.iterateOn === 'string' ? raw.iterateOn.slice(0, 40) : '';
  return out;
}

/** base64 data URL of a stored file (the reference cover, or the item being remixed) */
export async function dataUrlFor(design, which) {
  try {
    const { buf, mime } = await readFile(which === 'ref' ? design.reference.file : which);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** keep at most N parallel vendor calls so one click can't trip a 429 */
export async function pooled(tasks, limit = 2) {
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

/**
 * One prompt per variation, in the same order the results are shown in: variation 0 hugs the
 * reference, later ones push further. Used by both the server route and the browser lane.
 */
export function buildPromptSet({ analysis, brief, direction = '' }) {
  const spec = formatSpec(brief.format);
  const merged = { ...brief, direction, platform: brief.platform || 'Instagram' };
  return Array.from({ length: brief.count }, (_, v) => ({
    variation: v,
    aspect: spec.gemini,
    formatLabel: spec.label,
    prompt: buildGenerationPrompt({ analysis, brief: { ...merged, count: brief.count }, variation: v }),
  }));
}

/** shared guard for both lanes: an image the browser hands back must be a real, sane image */
export function safeImagePayload(raw = {}) {
  const mime = String(raw.mime || 'image/png');
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw badRequest(`Rasm turi qo‘llab-quvvatlanmaydi: ${mime}`);
  const b64 = String(raw.base64 || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 512) throw badRequest('Rasm juda kichik yoki bo‘sh — model javobi saqlanmadi.');
  if (bytes > 12 * 1024 * 1024) throw badRequest('Rasm 12 MB dan katta.');
  return { mime, base64: b64, bytes };
}
