/**
 * Per-provider defaults shown in the admin panel and profile key manager.
 * Model names are editable — providers rename these often, so nothing here is hard-coded into a call.
 */
export const MODEL_HINTS = {
  gemini: {
    visionModel: 'gemini-2.5-flash',
    textModel: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
    key: 'AIza…  (Google AI Studio → API keys)',
    note: 'One key covers vision analysis, art direction and image generation. Cheapest way to light up the whole studio.',
  },
  openai: {
    visionModel: 'gpt-4o-mini',
    textModel: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
    key: 'sk-…  (platform.openai.com → API keys)',
    note: 'gpt-image-1 accepts reference images for edits; dall-e-3 works too but takes a single reference.',
  },
  custom: {
    visionModel: 'gpt-4o-mini',
    textModel: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
    key: 'any OpenAI-compatible gateway key',
    note: 'Point Base URL at your proxy (OpenAI wire format) — /chat/completions and /images/* are used.',
  },
};
