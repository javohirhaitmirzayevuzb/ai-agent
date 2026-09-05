# Studio — AI cover & post generator

A small full-stack app for a design workflow: **sign in with just a name and surname**, drop in a
cover / post / reel cover you like, let the studio **read its design DNA**, answer what it could not
see (company name, topic of the reel, your own insight), and get **new key art in the same taste**.

An admin panel — unlocked only for `name: javohir` + `surname: ali` — holds the AI provider keys,
model names and workspace limits, so the whole team can use the studio without ever seeing a key.

---

## Flow

```
1 · drop / paste a reference        browser canvas measures it (palette, brightness,
                                    contrast, detail energy per region) — no upload yet
2 · analyse                         vision model reads the design: layout archetype, type
                                    treatment, every readable text string, and whether a
                                    company/brand name is printed in it
3 · brief                           it asks for exactly what is missing: company name
                                    (pre-filled when found), topic, tone, format,
                                    + one free-text box for the creator's insight
4 · generate                          image model redraws the *style* with your content
                                    (4 variation strategies), then remix by instruction
```

The reference is treated as a **style donor, never a source to copy**: its words, logo, people and
watermarks are explicitly listed as do-not-copy in the generation brief.

## The two AI steps + a local fallback

| Step | With a key | Without a key |
| --- | --- | --- |
| Analysis | `gemini-*-flash` / `gpt-4o*` vision, strict JSON (`src/lib/prompts.js`) | instrumented read of the file itself — real palette, luminance, contrast, region energy (`src/lib/heuristic.js`) |
| Art direction | text model turns your insight into written direction | skipped |
| Render | image model edits from the reference image | vector composer builds a real cover from the extracted DNA (`src/lib/localRender.js`) |

Nothing dead-ends: the studio is fully usable before any key exists, and every result is labelled
`image model` vs `local composer` so it is never ambiguous what produced an image.

## Providers (admin panel)

* **Google Gemini** — one key covers vision + text + image. `x-goog-api-key`, `generateContent`,
  `responseModalities: [IMAGE, TEXT]`, optional `imageConfig.aspectRatio` (retried without it on
  gateways that reject the field).
* **OpenAI** — `chat/completions` for vision (with `response_format: json_object`), `images/edits`
  (multipart, reference images attached) or `images/generations`.
* **Custom** — any OpenAI-compatible gateway; Base URL + model names are editable, because vendors
  rename models constantly.

Selection order per capability: **member's own key → workspace default provider → any enabled
provider with a key**. Vision / text / image are resolved independently, so you can analyse with
Gemini and render with OpenAI.

Keys are encrypted at rest (AES-256-GCM, key derived from a per-install secret in `data/store.json`),
never returned to a browser (masked to `abc…wxyz` + a fingerprint), and removable in one click.
Admin can also disable self-serve keys for the whole workspace.

## Auth

No password by design — identity *is* the name + surname pair, normalised to a slug (`javohir.ali`).
Sessions are HMAC-signed cookies (30 days). `role: admin` is granted when the pair is exactly
`javohir` + `ali` (accent/case-insensitive, but **not** substring-based — `ali2` is a member), and an
existing admin can promote others from Admin → Users.

Reference uploads and generated art are served through `/api/file/<…>`, whose path embeds the design
id; requests are refused unless you own that design or are admin.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000  (dev)
npm run build && npm start
npm run selftest   # 73 assertions: auth, guards, analyse, generate, ownership, keys, history
```

`data/` holds the JSON store, uploads and generated art — git-ignored, since it contains keys.
Env: `DATA_DIR` (store location), `INSECURE_COOKIE=1` (drop the `Secure` flag for plain-HTTP testing).

## Layout

```
src/app/            login · studio · admin · profile · api/*
src/components/     RefDrop (measure+paste+samples) · AnalysisPanel · BriefForm · ResultsGrid · ui
src/lib/            store (JSON+files) · session · crypto · http · ai (providers) · prompts
                    localRender (vector composer) · heuristic (canvas signals) · clientImage · providers
```

## Notes & limits

* Variation calls are pooled 2-at-a-time so one click cannot trip a provider 429; a failing
  variation falls back to the vector composer and is reported as a warning under the results.
* Uploaded references are downscaled to 1600 px in the browser before upload; bodies are capped at
  16 MB, and history is capped at 500 designs / 400 events per workspace.
* The vector composer uses browser fonts and system-safe families, so a PNG export looks like the
  on-screen draft (`exportPng` rasterises the SVG in a canvas — no server dependency).
* Not implemented on purpose: rate limiting per user, and password/MFA auth — say the word if this
  needs to be multi-tenant on the open internet.
