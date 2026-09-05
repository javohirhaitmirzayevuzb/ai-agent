/**
 * POST /api/analyze — step 1 of the studio.
 *
 * Receives the reference design (data URL) plus the exact measurements the
 * browser canvas took from it, stores the file, and returns the design "DNA":
 * palette, typography, layout archetype, every piece of readable text, the
 * company name if one is printed in the design, and the questions we still need
 * answered before generating (topic of the reel, the creator's insight, …).
 */
import { readStore, withStore, uid, saveFile, upsertDesign, pushEvent, mimeForPath } from '@/lib/store';
import { pickEngine, analyseDesign, AiError } from '@/lib/ai';
import { mergeAnalysis, companyHint } from '@/lib/prompts';
import { heuristicAnalysis, flowReadiness } from '@/lib/heuristic';
import { handler, json, readJson, parseImage, badRequest, sanitizeText } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function cleanSignals(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ok = (n) => (Number.isFinite(Number(n)) ? Number(n) : undefined);
  const palette = Array.isArray(raw.palette)
    ? raw.palette
        .slice(0, 8)
        .map((p) => ({ hex: sanitizeText(p.hex, 9), share: ok(p.share), luminance: ok(p.luminance), saturation: ok(p.saturation) }))
        .filter((p) => /^#[0-9a-f]{6}$/i.test(p.hex))
    : [];
  const regions = {};
  if (raw.regions && typeof raw.regions === 'object') {
    for (const [k, v] of Object.entries(raw.regions).slice(0, 9)) {
      if (/^[a-z]{2}$/.test(k)) regions[k] = { energy: ok(v?.energy), light: ok(v?.light) };
    }
  }
  return {
    width: ok(raw.width),
    height: ok(raw.height),
    ratio: ok(raw.ratio),
    ratioLabel: sanitizeText(raw.ratioLabel, 8) || undefined,
    luminance: ok(raw.luminance),
    contrast: ok(raw.contrast),
    saturation: ok(raw.saturation),
    edgeDensity: ok(raw.edgeDensity),
    calmRegion: sanitizeText(raw.calmRegion, 12) || undefined,
    hotRegion: sanitizeText(raw.hotRegion, 12) || undefined,
    typeGuess: sanitizeText(raw.typeGuess, 40) || undefined,
    palette,
    regions,
    textPixels: ok(raw.textPixels),
    coverage: ok(raw.coverage),
  };
}

export const POST = handler(async (req, _ctx, user) => {
  const body = await readJson(req);
  const img = parseImage(body.image);
  const signals = cleanSignals(body.signals);
  if (!signals || signals.width === undefined) throw badRequest('signals kerak — rasm brauzerda o’lchanmagan.');

  const store = readStore();
  const requested = String(body.designId || '').trim();
  if (requested && store.designs[requested]?.userId !== user.id) throw badRequest('Design topilmadi.', 404);
  const designId = requested || uid('dsg_');

  const ext = (img.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const rel = `refs/${designId}/ref.${ext}`;
  await saveFile(rel, img.buf, img.mime);

  const engine = pickEngine(store, user, 'vision', body.provider || undefined);
  let analysis;
  let aiError = null;
  if (engine) {
    try {
      const r = await analyseDesign({ engine, dataUrl: img.dataUrl, signals });
      analysis = mergeAnalysis(r.analysis, signals);
      analysis.aiModel = r.model;
      analysis.aiProvider = engine.id;
    } catch (err) {
      aiError = String(err?.message || err).slice(0, 300);
      analysis = mergeAnalysis({}, signals);
      Object.assign(analysis, heuristicAnalysis(signals), { aiError });
    }
  } else {
    analysis = { ...heuristicAnalysis(signals), aiError: 'AI kalit ulangani yo’q — lokal tahlil ishlatildi.' };
  }

  const title = sanitizeText(body.title || analysis.companyName || analysis.kind || 'Yangi dizayn', 60);
  await withStore(async (s) => {
    const isNew = !s.designs[designId];
    await upsertDesign(s, {
      id: designId,
      userId: user.id,
      title,
      status: 'analysed',
      createdAt: s.designs[designId]?.createdAt || new Date().toISOString(),
      reference: { file: rel, mime: img.mime, bytes: img.bytes, signals, uploadedAt: new Date().toISOString() },
      analysis,
    });
    if (isNew) {
      const u = s.users[user.id];
      if (u) u.stats = { ...(u.stats || {}), designs: (u.stats?.designs || 0) + 1 };
    }
    pushEvent(s, { kind: 'design.analysed', userId: user.id, actor: user.displayName, designId, mode: engine ? 'ai-vision' : 'heuristic', provider: engine?.id || null });
  });

  return json({
    ok: true,
    designId,
    title,
    refUrl: `/api/file/${rel}`,
    analysis,
    company: companyHint(analysis),
    readiness: flowReadiness({ analyse: Boolean(engine) && !aiError, image: Boolean(pickEngine(store, user, 'image', body.provider || undefined)) }),
  });
});
