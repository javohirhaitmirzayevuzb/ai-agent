/**
 * POST /api/generate/prompts — the half of a generation that needs the store, not the network.
 *
 * Why this exists: deciding what to ask the model (brief hygiene, style DNA, reference bytes,
 * art direction) is server work, while fetching pixels only needs an HTTPS call. When the server
 * sits behind an egress filter but the user's browser can reach the provider, the studio asks here,
 * calls the model from the tab, and hands the result to /api/generate/attach. Same prompts either
 * way — both lanes build them from src/lib/generateCore.js, so a browser run cannot quietly differ.
 */
import { readStore } from '@/lib/store';
import { pickEngine, artDirect } from '@/lib/ai';
import { formatSpec } from '@/lib/prompts';
import { cleanBrief, dataUrlFor, buildPromptSet } from '@/lib/generateCore';
import { handler, json, readJson, badRequest, sanitizeText } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req, _ctx, user) => {
  const t0 = Date.now();
  const body = await readJson(req, 256 * 1024);
  const brief = cleanBrief(body.brief || {});
  const store = readStore();

  const requested = String(body.designId || '').trim();
  const design = requested ? store.designs[requested] : null;
  if (requested && (!design || design.userId !== user.id)) throw badRequest('Design topilmadi.', 404);
  const analysis = body.analysis || design?.analysis || {};

  const engine = pickEngine(store, user, 'image', body.provider || undefined);
  if (!engine || engine.family !== 'gemini') throw badRequest('Brauzer yo‘li Gemini providerini talab qiladi (Admin → AI keys).');
  if (!engine.baseUrl || !engine.imageModel) throw badRequest('Base URL va imageModel to‘ldirilgan bo‘lishi kerak.');

  // refs are handed to the caller on purpose: the model needs them, and they are the user's own upload
  const refs = [];
  if (design?.reference?.file) {
    const url = await dataUrlFor(design, 'ref');
    if (url) refs.push(url);
  }
  if (brief.iterateOn && design) {
    const item = (design.items || []).find((x) => x.id === brief.iterateOn);
    if (item?.file) {
      const url = await dataUrlFor(design, item.file);
      if (url) refs.push(url);
    }
  }
  if (brief.instruction) brief.insight = [brief.insight, `Mutaxassis ko’rsatmasi: ${brief.instruction}`].filter(Boolean).join('\n');

  // best effort, exactly as the server lane does it: no egress here just means no director polish
  const textEngine = store.settings.refinePrompt !== false ? pickEngine(store, user, 'text', body.provider || undefined) : null;
  let direction = '';
  if (textEngine && brief.refine && (brief.insight || brief.topic)) {
    try {
      direction = await artDirect({ engine: textEngine, analysis, brief: { ...brief, formatLabel: formatSpec(brief.format).label } });
    } catch (err) {
      brief.directionError = String(err?.message || err).slice(0, 200);
    }
  }

  const spec = formatSpec(brief.format);
  const promptSet = buildPromptSet({ analysis, brief, direction });
  return json({
    ok: true,
    designId: requested,
    // the key never appears here: the tab holds its own copy, the server is not asked to leak one
    provider: { id: engine.id, baseUrl: engine.baseUrl, imageModel: engine.imageModel, imageSize: engine.imageSize || '', family: engine.family },
    format: { id: brief.format, label: spec.label, aspect: spec.gemini },
    direction,
    analysis,
    brief,
    prompts: promptSet.map((p) => ({ ...p, refs })),
    ms: Date.now() - t0,
  });
}, { auth: true });
