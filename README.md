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
npm run selftest        # 118 assertions against the dev server already running on :3000
npm run test:isolated   # 92 assertions on a throwaway server + temp store — safe to run
                        # while the preview is up, and it never touches data/
```

`data/` holds the JSON store, uploads and generated art — git-ignored, since it contains keys.
Env: `DATA_DIR` (store location), `INSECURE_COOKIE=1` (lax cookie only, for plain-HTTP testing),
`COOKIE_SAMESITE=lax|strict|none` (pin one cookie flavour instead of writing all three).

### Sessions inside iframes

A preview pane, an embedded dashboard and a plain browser tab each accept a *different*
cookie, and picking wrong looks like "login returned 200, then every API call is 401".
So sign-in writes three cookies with the same signed token — `SameSite=Lax` (first-party,
including `http://localhost`), `SameSite=None; Secure` (cross-site frame) and the same plus
`Partitioned` (CHIPS, for frames with third-party cookies blocked). A browser rejects the
flavours its context disallows and keeps the one that fits; any of them authenticates.
Login also returns the token so the client can mirror it in `sessionStorage` and replay it
as `x-studio-session` when no cookie jar exists at all (sandboxed frame). Signing out
rotates a per-user nonce, so a mirrored token cannot outlive the session.

Known trade-off: a `?sid=` URL is visible in server access logs. It is only ever used when the
browser refused the cookie, it grants exactly what your own session grants, and it dies at logout.
To forbid it entirely, pin cookies-only mode with `COOKIE_SAMESITE=none` (or stop mirroring by
serving over a first-party origin, where the plain Lax cookie is enough).

## Layout

```
src/app/            login · studio · admin · profile · api/*
src/components/     RefDrop (measure+paste+samples) · AnalysisPanel · BriefForm · ResultsGrid · ui
src/lib/            store (JSON+files) · session · crypto · http · ai (providers) · prompts
                    localRender (vector composer) · heuristic (canvas signals) · clientImage · providers
```

## Two lanes to the model

A generation is two jobs: **deciding what to ask** (store, style DNA, reference bytes, art direction —
always the server) and **calling the model** (any HTTPS client). So the image call can happen in either
place, and both build their prompts from `src/lib/generateCore.js`, so a browser run asks for exactly
what a server run would:

* **server lane** (default) — `POST /api/generate` streams stages as NDJSON.
* **browser lane** — Admin → Gemini → *Browser lane · key for this tab only*: paste a key, it lives in
  `sessionStorage`, is never sent to this server and never written to disk. The studio then calls
  `POST /api/generate/prompts`, hits `generateContent` from the tab, and stores each result through
  `POST /api/generate/attach`. Tiles read `gemini · gemini-3.1-flash-image-preview · this tab`.
  This is the lane that works when the *server* is behind an egress filter but your laptop is not.

`attach` is not a trust hole: it checks session + design ownership, accepts only png/jpeg/webp,
rejects anything under 512 bytes or over the body cap, and caps a batch at 4 items.

## When a run does not produce images

`npm run doctor` prints one verdict, and the three failure families it distinguishes are the ones
people actually hit:

| verdict | meaning | fix |
| --- | --- | --- |
| `key_rejected` | the endpoint answered, the provider said no (401/403) | wrong/revoked key, or the API is off on that GCP project |
| `model_missing` | key works, model name is not offered by it | switch to `gemini-3.1-flash-image-preview` (Nano Banana 2) or `gemini-3-pro-image-preview` (Pro) |
| `filtered` | a control host answers but the provider host is refused in ms | egress allow-list: this sandbox blocks `*.googleapis.com`. Run it where you have internet, or point Base URL at a reachable gateway |
| `no_network` / `dns_failed` / `tls_failed` | nothing gets through / DNS / intercepted TLS | VPN, resolv.conf, or `NODE_EXTRA_CA_CERTS` for a corporate proxy CA |

`--no-net` checks configuration without touching the network (that is what CI runs), and `ok:false`
with verdict `unverified` is its honest answer when it cannot probe — it never guesses that things work.

## Notes & limits

* Variation calls are pooled 2-at-a-time so one click cannot trip a provider 429. A failing
  variation is **not** replaced with a local drawing when an image model is configured — the run
  returns `mode: 'failed'` with the endpoint it tried, and offers *Retry* or an explicit
  `allowLocal` opt-in. The vector composer is the keyless path, never a stand-in for model output.
* **The Arena sandbox is network-restricted, not offline.** `github.com` and the npm registry answer;
  `generativelanguage.googleapis.com` is reset in ~10 ms, so a real image call cannot succeed here.
  `npm run doctor` reports this as `filtered`. Run `npm run dev` on a machine with internet (the key
  you save here stays in `data/store.json`, which is git-ignored), or point **Base URL** at a gateway
  the box can reach.
* After changing `package.json` (module type, deps) restart `npm run dev`: a long-lived dev server can
  keep two copies of one module, and two copies of a React context module means `useApp must be used
  inside <AppProvider>` on the next hot reload — a fresh boot is clean.
* Two static guards run before the suite, for bugs an HTTP assertion cannot see: `check:props`
  (a component calling a prop it never destructured → ReferenceError on click, no request sent)
  and `check:client-imports` (a node builtin reachable from `'use client'` → the bundle fails to build).
* Uploaded references are downscaled to 1600 px in the browser before upload; bodies are capped at
  16 MB, and history is capped at 500 designs / 400 events per workspace.
* The vector composer uses browser fonts and system-safe families, so a PNG export looks like the
  on-screen draft (`exportPng` rasterises the SVG in a canvas — no server dependency).
* Not implemented on purpose: rate limiting per user, and password/MFA auth — say the word if this
  needs to be multi-tenant on the open internet.
