/**
 * POST /api/generate — step 3: turn the analysed style DNA + the creator's brief
 * into new covers.
 *
 * Each variation is its own model call (so variant 1 hugs the reference and the
 * later ones push further). When no image key exists — or a call fails — we
 * compose a real vector cover locally from the measured palette/layout, so the
 * flow never dead-ends.
 */
import { readStore, withStore, uid, saveFile, readFile, upsertDesign, pushEvent } from '@/lib/store';
import { pickEngine, generateImages, artDirect, AiError } from '@/lib/ai';
import { buildGenerationPrompt, formatSpec } from '@/lib/prompts';
import { renderCover } from '@/lib/localRender';
import { handler, json, readJson, clamp, sanitizeText, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const BRIEF_FIELDS = ['companyName', 'headline', 'subhead', 'tagline', 'cta', 'footer', 'kicker', 'topic', 'insight', 'tone', 'audience', 'offer', 'platform'];

function cleanBrief(raw = {}) {
  const out = {};
  for (const f of BRIEF_FIELDS) if (raw[f] !== undefined) out[f] = sanitizeText(raw[f], f === 'insight' ? 2400 : 220);
  out.format = typeof raw.format === 'string' && raw.format.length < 24 ? raw.format : 'post-1x1';
  out.aspect = formatSpec(out.format).gemini;
  out.count = clamp(raw.count ?? 2, 1, 4);
  out.refine = raw.refine !== false;
  out.mode = raw.mode === 'local' || raw.mode === 'ai' ? raw.mode : 'auto';
  out.instruction = sanitizeText(raw.instruction, 600);
  out.iterateOn = typeof raw.iterateOn === 'string' ? raw.iterateOn.slice(0, 40) : '';
  return out;
}

/** keep at most N parallel vendor calls so one click can't trip a 429 */
async function pooled(tasks, limit = 2) {
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

async function dataUrlFor(design, which) {
  try {
    const { buf, mime } = await readFile(which === 'ref' ? design.reference.file : which);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export const POST = handler(async (req, _ctx, user) => {
  const body = await readJson(req);
  const brief = cleanBrief(body.brief || {});
  const store0 = readStore();

  const requested = String(body.designId || '').trim();
  const ownedId = requested && store0.designs[requested]?.userId === user.id ? requested : '';
  if (requested && !ownedId) throw badRequest('Design topilmadi.', 404);
  const store = readStore();
  const design = ownedId ? store.designs[ownedId] : null;
  if (ownedId && !design) throw badRequest('Design topilmadi — qaytadan tahlil qiling.', 404);
  // ids are baked into file paths, so fix the id before writing anything
  const designId = ownedId || uid('dsg_');

  const analysis = body.analysis || design?.analysis || {};
  const providerPref = body.provider || undefined;
  const imageEngine = pickEngine(store, user, 'image', providerPref);
  const textEngine = store.settings.refinePrompt !== false ? pickEngine(store, user, 'text', providerPref) : null;

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

  // Art-director pass: fuse the creator's insight into sharp direction (optional).
  let direction = '';
  const dirStart = Date.now();
  if (textEngine && brief.refine && (brief.insight || brief.topic)) {
    try {
      direction = await artDirect({ engine: textEngine, analysis, brief: { ...brief, formatLabel: formatSpec(brief.format).label } });
    } catch (err) {
      direction = '';
      brief.directionError = String(err?.message || err).slice(0, 200);
    }
  }

  const t0 = Date.now();
  let items = [];
  let usedMode = 'local-svg';
  let aiErrors = [];

  const wantAi = brief.mode !== 'local' && Boolean(imageEngine);
  if (wantAi) {
    const tasks = Array.from({ length: brief.count }, (_, v) => async () => {
      const prompt = buildGenerationPrompt({ analysis, brief: { ...brief, direction, count: brief.count, platform: brief.platform || 'Instagram' }, variation: v });
      const imgs = await generateImages({ engine: imageEngine, prompt, refs, aspect: formatSpec(brief.format).gemini });
      return { prompt, images: imgs };
    });
    const settled = await pooled(tasks, 2);
    for (const [v, res] of settled.entries()) {
      if (!res.ok) {
        aiErrors.push({ variation: v, error: String(res.error?.message || res.error).slice(0, 300) });
        continue;
      }
      for (const [k, img] of (res.value.images || []).entries()) {
        const itemId = uid('it_');
        const ext = img.mime.includes('jpeg') ? 'jpg' : img.mime.includes('webp') ? 'webp' : 'png';
        const rel = `out/${designId}/${itemId}.${ext}`;
        const buf = Buffer.from(img.base64, 'base64');
        await saveFile(rel, buf, img.mime);
        items.push({
          id: itemId,
          file: rel,
          url: `/api/file/${rel}`,
          mode: 'ai',
          provider: img.provider,
          model: img.model,
          prompt: res.value.prompt,
          variation: v,
          bytes: buf.length,
          mime: img.mime,
          createdAt: new Date().toISOString(),
          label: `${formatSpec(brief.format).label} · v${v + 1}${k ? `.${k + 1}` : ''}`,
        });
      }
    }
    if (items.length) usedMode = 'image-model';
  }

  // Local vector render: always fill the remaining variation slots, or all of
  // them when no image key is configured.
  if (items.length < brief.count) {
    const have = new Set(items.map((i) => i.variation));
    for (let v = 0; v < brief.count; v++) {
      if (have.has(v)) continue;
      const rendered = renderCover({ analysis, brief, variation: v, format: brief.format });
      const itemId = uid('it_');
      const rel = `out/${designId}/${itemId}.svg`;
      await saveFile(rel, Buffer.from(rendered.svg, 'utf8'), 'image/svg+xml');
      items.push({
        id: itemId,
        file: rel,
        url: `/api/file/${rel}`,
        mode: 'local',
        provider: 'local-render',
        model: 'vector composer',
        prompt: buildGenerationPrompt({ analysis, brief: { ...brief, direction }, variation: v }),
        variation: v,
        bytes: rendered.svg.length,
        mime: 'image/svg+xml',
        width: rendered.width,
        height: rendered.height,
        createdAt: new Date().toISOString(),
        label: `${formatSpec(brief.format).label} · local v${v + 1}`,
      });
    }
  }

  if (!items.length) {
    const err = aiErrors[0]?.error || brief.directionError || 'Hech narsa chiqmadi.';
    throw new AiError(`Generatsiya muvaffaqiyatsiz: ${err}`, { status: 502 });
  }

  const designPatch = {
    id: designId,
    userId: user.id,
    title: sanitizeText(body.title || brief.companyName || brief.headline || design?.title || 'Yangi versiya', 60),
    status: 'done',
    createdAt: design?.createdAt || new Date().toISOString(),
    reference: design?.reference || null,
    analysis: design?.analysis || analysis,
    brief,
    direction,
    runs: [
      ...(design?.runs || []),
      { at: new Date().toISOString(), mode: usedMode, count: items.length, ms: Date.now() - t0, provider: imageEngine?.id || 'local', directionMs: Date.now() - dirStart, errors: aiErrors },
    ].slice(-12),
    items: [...items, ...(design?.items || [])].slice(0, 24),
  };

  await withStore(async (s) => {
    await upsertDesign(s, designPatch);
    const u = s.users[user.id];
    if (u) {
      u.stats = {
        ...(u.stats || { designs: 0, generations: 0, favorites: 0 }),
        designs: (u.stats?.designs || 0) + (design ? 0 : 1),
        generations: (u.stats?.generations || 0) + items.length,
      };
    }
    pushEvent(s, {
      kind: 'design.generated',
      userId: user.id,
      actor: user.displayName,
      designId: designPatch.id,
      mode: usedMode,
      count: items.length,
      ms: Date.now() - t0,
    });
  });

  return json({
    ok: true,
    designId: designPatch.id,
    mode: usedMode,
    provider: imageEngine?.id || 'local',
    model: imageEngine?.imageModel || 'vector composer',
    direction,
    directionSource: direction ? (textEngine ? `${textEngine.id}/${textEngine.textModel}` : 'none') : '',
    ms: Date.now() - t0,
    items,
    warnings: aiErrors,
    brief,
  });
});
