/**
 * Per-provider defaults shown in the admin panel and profile key manager.
 * Model names are editable — providers rename these often, so nothing here is hard-coded into a call.
 */
export const MODEL_HINTS = {
  gemini: {
    visionModel: 'gemini-2.5-flash',
    textModel: 'gemini-2.5-flash',
    imageModel: 'gemini-3.1-flash-image-preview',
    imageSize: '2K',
    key: 'AIza… yoki AQ.…  (Google AI Studio → API keys)',
    note: 'imageModel is the image lane: gemini-3.1-flash-image-preview is Nano Banana 2, gemini-3-pro-image-preview is Nano Banana Pro. One key covers vision analysis, art direction and image generation.',
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
