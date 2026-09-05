/**
 * POST /api/generate — step 3: turn the analysed style DNA + the creator's brief
 * into new covers.
 *
 * Each variation is its own model call (so variant 1 hugs the reference and the
 * later ones push further). When no image key exists — or a call fails — we
 * compose a real vector cover locally from the measured palette/layout, so the
 * flow never dead-ends.
 */
import { readStore, withStore, uid, saveFile, upsertDesign, pushEvent } from '@/lib/store';
import { pickEngine, generateImages, artDirect } from '@/lib/ai';
import { buildGenerationPrompt, formatSpec } from '@/lib/prompts'; // buildGenerationPrompt is still needed by the local composer path
import { renderCover } from '@/lib/localRender';
import { cleanBrief, dataUrlFor, pooled, buildPromptSet } from '@/lib/generateCore';
import { handler, json, readJson, sanitizeText, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * Runs one generation. `emit(event)` receives progress as it happens; with no emitter
 * it runs to completion and the caller returns the payload as plain JSON.
 */
async function runGenerate({ user, body, emit = () => {} }) {
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
  emit({
    type: 'stage',
    id: 'direct',
    label: textEngine && brief.refine && (brief.insight || brief.topic) ? `Art direction \u00b7 ${textEngine.id}/${textEngine.textModel}` : 'Art direction \u00b7 skipped',
    status: 'run',
  });
  if (textEngine && brief.refine && (brief.insight || brief.topic)) {
    try {
      direction = await artDirect({ engine: textEngine, analysis, brief: { ...brief, formatLabel: formatSpec(brief.format).label } });
    } catch (err) {
      direction = '';
      brief.directionError = String(err?.message || err).slice(0, 200);
    }
  }

  emit({ type: 'stage', id: 'direct', status: direction ? 'done' : 'skip', detail: brief.directionError || '' });

  const t0 = Date.now();
  let items = [];
  let usedMode = 'local-svg';
  let aiErrors = [];

  const wantAi = brief.mode !== 'local' && Boolean(imageEngine);
  if (wantAi) {
    emit({
      type: 'stage',
      id: 'generate',
      label: `Generating with ${imageEngine.imageModel} \u00b7 ${brief.count} variation${brief.count > 1 ? 's' : ''}`,
      status: 'run',
    });
    let doneCount = 0;
    const promptSet = buildPromptSet({ analysis, brief, direction });
    const tasks = promptSet.map((spec) => async () => {
      const imgs = await generateImages({ engine: imageEngine, prompt: spec.prompt, refs, aspect: spec.aspect });
      return { prompt: spec.prompt, images: imgs };
    });
    const settled = await pooled(tasks, 2);
    for (const [v, res] of settled.entries()) {
      doneCount = v + 1;
      emit({ type: 'progress', done: doneCount, total: brief.count, ms: Date.now() - t0 });
      if (!res.ok) {
        aiErrors.push({ variation: v, error: String(res.error?.message || res.error).slice(0, 300) });
        emit({ type: 'variation-failed', variation: v, error: String(res.error?.message || res.error).slice(0, 240) });
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
        emit({ type: 'item', item: items[items.length - 1] });
      }
    }
    if (items.length) usedMode = 'image-model';
  }

  if (wantAi) emit({ type: 'stage', id: 'generate', status: items.length ? 'done' : 'fail', detail: aiErrors[0]?.error || '' });

  // The local vector composer is the *keyless* path (and an explicit opt-in). When a real
  // image model is configured but its calls failed, we do not quietly substitute a drawn
  // SVG: the user asked for model output, and a local cover would hide the provider error
  // behind something that looks like success.
  const allowLocal = !wantAi || brief.mode === 'local' || brief.allowLocal === true;
  if (allowLocal && items.length < brief.count) {
    const have = new Set(items.map((i) => i.variation));
    emit({ type: 'stage', id: 'compose', label: 'Composing local vector draft', status: 'run' });
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
      emit({ type: 'item', item: items[items.length - 1] });
    }
    emit({ type: 'stage', id: 'compose', status: 'done' });
  }

  if (!items.length) {
    const err = aiErrors[0]?.error || brief.directionError || 'Hech narsa chiqmadi.';
    // a failure is reported as data, not a 502, so the studio can show the provider
    // error next to a retry instead of a dead-end toast
    return {
      ok: false,
      failed: true,
      mode: 'failed',
      designId,
      provider: imageEngine?.id || 'none',
      model: imageEngine?.imageModel || '',
      error: `Model rasm qaytarmadi: ${String(err).slice(0, 300)}`,
      ms: Date.now() - t0,
      items: [],
      warnings: aiErrors,
      brief,
    };
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

  return {
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
  };
}

export const POST = handler(async (req, _ctx, user) => {
  const body = await readJson(req);
  if (!body.stream) return json(await runGenerate({ user, body }));

  // Newline-delimited JSON: stages and finished variations land as they happen, so the
  // studio shows a real progress trail instead of one long spinner.
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* the client navigated away */
        }
      };
      try {
        const out = await runGenerate({ user, body, emit });
        emit({ type: 'done', ...out });
      } catch (err) {
        emit({ type: 'error', status: err?.status || 500, error: String(err?.message || err) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
});
