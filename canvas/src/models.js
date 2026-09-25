// Registre des modèles KIE. Les noms et paramètres suivent la doc KIE (Market API).
// ⚠ Ils varient d'un modèle à l'autre : vérifier https://docs.kie.ai avant d'ajouter un modèle.
// Les coûts sont des estimations en crédits (1 crédit ≈ 0,005 $) : vérifier https://kie.ai/pricing.

export const CREDIT_USD = 0.005;

const RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '21:9'];

const SEEDREAM_SIZE = {
  '1:1': 'square_hd', '3:4': 'portrait_4_3', '4:3': 'landscape_4_3', '9:16': 'portrait_16_9',
  '16:9': 'landscape_16_9', '2:3': 'portrait_3_2', '3:2': 'landscape_3_2', '21:9': 'landscape_21_9',
};

const GPT_RATIOS = ['auto', '1:1', '3:2', '2:3'];

// GPT Image : texte → image, ou image → image quand des images sont reliées.
// ⚠ Le nom du paramètre de résolution n'a pas pu être vérifié dans la doc KIE.
const gptImage = ({ label, t2i, i2i, cost }) => ({
  label,
  maxRefs: 10,
  ratios: GPT_RATIOS,
  defaultRatio: 'auto',
  options: { resolution: ['1K', '2K', '4K'] },
  build: ({ prompt, ratio, refs, opts }) => {
    const input = { prompt, aspect_ratio: ratio, resolution: opts.resolution };
    return refs.length
      ? { model: i2i, input: { ...input, input_urls: refs } }
      : { model: t2i, input };
  },
  cost,
});

export const IMAGE_MODELS = {
  // GPT Image 2.5 : deux versions, Flare (rapide, courante) et Sunburst (détails fins).
  // ⚠ Identifiants KIE supposés, calqués sur GPT Image 2 ; tarif non publié dans le comparateur.
  'gpt-image-2-5': {
    label: 'GPT Image 2.5',
    maxRefs: 6,
    ratios: ['auto', '1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9', '27:16', '16:27', '9:8', '8:9'],
    defaultRatio: 'auto',
    options: { version: ['Flare', 'Sunburst'], resolution: ['1K', '2K', '4K'] },
    build: ({ prompt, ratio, refs, opts }) => {
      const v = opts.version.toLowerCase();
      // 27:16, 16:27, 9:8 et 8:9 n'existent qu'en 1K.
      const resolution = ['27:16', '16:27', '9:8', '8:9'].includes(ratio) ? '1K' : opts.resolution;
      const input = { prompt, aspect_ratio: ratio, resolution };
      return refs.length
        ? { model: `gpt-image-2-5-${v}-image-to-image`, input: { ...input, input_urls: refs } }
        : { model: `gpt-image-2-5-${v}-text-to-image`, input };
    },
    cost: () => null,
  },
  'gpt-image-2': gptImage({
    label: 'GPT Image 2',
    t2i: 'gpt-image-2-text-to-image',
    i2i: 'gpt-image-2-image-to-image',
    cost: (o) => ({ '1K': 6, '2K': 10, '4K': 16 })[o.resolution],
  }),
  'nano-banana-pro': {
    label: 'Google Nano Banana Pro',
    maxRefs: 8,
    ratios: RATIOS,
    options: { resolution: ['1K', '2K', '4K'] },
    build: ({ prompt, ratio, refs, opts }) => ({
      model: 'nano-banana-pro',
      input: { prompt, image_input: refs, aspect_ratio: ratio, resolution: opts.resolution, output_format: 'png' },
    }),
    cost: (o) => (o.resolution === '4K' ? 24 : 18),
  },
  'nano-banana': {
    label: 'Google Nano Banana',
    maxRefs: 10,
    ratios: RATIOS,
    options: {},
    build: ({ prompt, ratio, refs }) =>
      refs.length
        ? { model: 'google/nano-banana-edit', input: { prompt, image_urls: refs, output_format: 'png', image_size: ratio } }
        : { model: 'google/nano-banana', input: { prompt, output_format: 'png', image_size: ratio } },
    cost: () => 4,
  },
  'grok-imagine-image-2': {
    label: 'Grok Imagine Image 2.0',
    maxRefs: 4,
    ratios: ['1:1', '3:2', '2:3', '16:9', '9:16'],
    options: {},
    // ⚠ Identifiant de l'édition d'image supposé (« image-edit ») : à confirmer dans la doc KIE.
    build: ({ prompt, ratio, refs }) =>
      refs.length
        ? { model: 'grok-imagine-image-2-0/image-edit', input: { prompt, image_urls: refs, aspect_ratio: ratio } }
        : { model: 'grok-imagine-image-2-0/text-to-image', input: { prompt, aspect_ratio: ratio } },
    cost: () => 4,
  },
  'seedream-4': {
    other: true,
    label: 'Seedream 4.0',
    maxRefs: 10,
    ratios: RATIOS,
    options: { resolution: ['1K', '2K', '4K'] },
    build: ({ prompt, ratio, refs, opts }) => {
      const input = { prompt, image_size: SEEDREAM_SIZE[ratio], image_resolution: opts.resolution, max_images: 1 };
      return refs.length
        ? { model: 'bytedance/seedream-v4-edit', input: { ...input, image_urls: refs } }
        : { model: 'bytedance/seedream-v4-text-to-image', input };
    },
    cost: () => 3.5,
  },
};

// Vidéo : images reliées = premier frame, puis dernier frame si le modèle le permet.
const table = (t) => (o) => t[o.resolution]?.[o.duration] ?? null;

// Seedance 2.x : premier/dernier frame OU multi-référence (modes exclusifs chez KIE).
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const seedance2 = ({ name, kieModel, maxDuration, maxRefs, resolutions, defaultRatio, perSecond }) => (mode) => ({
  label: `${name} · ${mode === 'frames' ? 'premier/dernier frame' : 'multi-référence'}`,
  maxImages: mode === 'frames' ? 2 : maxRefs,
  imageRoles: mode === 'frames' ? ['Premier frame', 'Dernier frame'] : range(1, maxRefs).map((n) => `Réf. ${n}`),
  options: { duration: range(4, maxDuration), resolution: resolutions, audio: ['avec son', 'sans son'] },
  defaults: { duration: '5' },
  ratios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  defaultRatio,
  ratioWithImages: true,
  build: ({ prompt, images, ratio, opts }) => {
    const input = {
      prompt, resolution: opts.resolution, aspect_ratio: ratio,
      duration: Number(opts.duration), generate_audio: opts.audio === 'avec son',
    };
    if (mode === 'frames') {
      if (images[0]) input.first_frame_url = images[0];
      if (images[1]) input.last_frame_url = images[1];
    } else if (images.length) {
      input.reference_image_urls = images;
    }
    return { model: kieModel, input };
  },
  // Crédits par seconde (sans vidéo en entrée), tarifs KIE du 18/08/2026.
  cost: (o) => Math.round(perSecond[o.resolution] * Number(o.duration) * 10) / 10,
});

const s25 = seedance2({
  name: 'Seedance 2.5', kieModel: 'bytedance/seedance-2-5', maxDuration: 30, maxRefs: 30,
  resolutions: ['720p', '480p', '1080p'], defaultRatio: 'adaptive',
  perSecond: { '480p': 28, '720p': 63, '1080p': 114 },
});
const s20 = seedance2({
  name: 'Seedance 2', kieModel: 'bytedance/seedance-2', maxDuration: 15, maxRefs: 9,
  resolutions: ['720p', '480p', '1080p'], defaultRatio: 'adaptive',
  perSecond: { '480p': 19, '720p': 41, '1080p': 102 },
});
const s2 = seedance2({
  name: 'Seedance 2 Mini', kieModel: 'bytedance/seedance-2-mini', maxDuration: 15, maxRefs: 9,
  resolutions: ['720p', '480p'], defaultRatio: '16:9',
  perSecond: { '480p': 3.8, '720p': 8.2 },
});

export const VIDEO_MODELS = {
  'seedance-2-5-frames': s25('frames'),
  'seedance-2-5-refs': s25('refs'),
  'seedance-2-frames': s20('frames'),
  'seedance-2-refs': s20('refs'),
  'seedance-2-mini-frames': s2('frames'),
  'seedance-2-mini-refs': s2('refs'),
  'minimax-h3': {
    label: 'MiniMax H3',
    maxImages: 1,
    imageRoles: ['Premier frame'],
    // ⚠ Durées et noms de paramètres supposés (doc KIE non consultable ici) : à vérifier.
    options: { duration: ['6', '10'], resolution: ['768p', '2K'] },
    ratios: ['16:9', '9:16', '1:1'],
    build: ({ prompt, images, ratio, opts }) => {
      const base = { prompt, duration: opts.duration, resolution: opts.resolution };
      return images.length
        ? { model: 'minimax-h3/image-to-video', input: { ...base, image_url: images[0] } }
        : { model: 'minimax-h3/text-to-video', input: { ...base, aspect_ratio: ratio } };
    },
    // Crédits par seconde, + 8 crédits par image en entrée.
    cost: (o) => ({ '768p': 16, '2K': 26 })[o.resolution] * Number(o.duration),
  },
  'grok-imagine': {
    label: 'Grok Imagine',
    maxImages: 1,
    imageRoles: ['Image de départ'],
    options: { duration: ['6', '10'], resolution: ['480p', '720p', '1080p'] },
    ratios: ['16:9', '9:16', '1:1', '2:3', '3:2'],
    ratioWithImages: true,
    build: ({ prompt, images, ratio, opts }) => {
      const input = { prompt, mode: 'normal', duration: opts.duration, resolution: opts.resolution, aspect_ratio: ratio };
      return images.length
        ? { model: 'grok-imagine/image-to-video', input: { ...input, image_urls: images } }
        : { model: 'grok-imagine/text-to-video', input };
    },
    cost: (o) => Math.round(({ '480p': 2.4, '720p': 4.5, '1080p': 8 })[o.resolution] * Number(o.duration) * 10) / 10,
  },
  'seedance-lite': {
    other: true,
    label: 'Seedance 1.0 Lite',
    maxImages: 2,
    imageRoles: ['Premier frame', 'Dernier frame'],
    options: { duration: ['5', '10'], resolution: ['480p', '720p', '1080p'] },
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    build: ({ prompt, images, ratio, opts }) => {
      const base = { prompt, resolution: opts.resolution, duration: opts.duration, camera_fixed: false };
      if (!images.length) return { model: 'bytedance/v1-lite-text-to-video', input: { ...base, aspect_ratio: ratio } };
      const input = { ...base, image_url: images[0] };
      if (images[1]) input.end_image_url = images[1];
      return { model: 'bytedance/v1-lite-image-to-video', input };
    },
    cost: table({ '480p': { 5: 10, 10: 20 }, '720p': { 5: 22.5, 10: 45 }, '1080p': { 5: 50, 10: 100 } }),
  },
  'seedance-pro': {
    other: true,
    label: 'Seedance 1.0 Pro',
    maxImages: 1,
    imageRoles: ['Premier frame'],
    options: { duration: ['5', '10'], resolution: ['480p', '720p', '1080p'] },
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    build: ({ prompt, images, ratio, opts }) => {
      const base = { prompt, resolution: opts.resolution, duration: opts.duration, camera_fixed: false };
      return images.length
        ? { model: 'bytedance/v1-pro-image-to-video', input: { ...base, image_url: images[0] } }
        : { model: 'bytedance/v1-pro-text-to-video', input: { ...base, aspect_ratio: ratio } };
    },
    cost: table({ '480p': { 5: 14, 10: 28 }, '720p': { 5: 30, 10: 60 }, '1080p': { 5: 70, 10: 140 } }),
  },
  'hailuo-standard': {
    other: true,
    label: 'Minimax Hailuo 02 Standard',
    maxImages: 2,
    imageRoles: ['Premier frame', 'Dernier frame'],
    options: { duration: ['6', '10'], resolution: ['512P', '768P'] },
    ratios: null,
    build: ({ prompt, images, opts }) => {
      const base = { prompt, duration: opts.duration, prompt_optimizer: true };
      if (!images.length) return { model: 'hailuo/02-text-to-video-standard', input: base };
      const input = { ...base, image_url: images[0], resolution: opts.resolution };
      if (images[1]) input.end_image_url = images[1];
      return { model: 'hailuo/02-image-to-video-standard', input };
    },
    cost: table({ '512P': { 6: 12, 10: 20 }, '768P': { 6: 30, 10: 50 } }),
  },
  'hailuo-pro': {
    other: true,
    label: 'Minimax Hailuo 02 Pro (1080P)',
    maxImages: 2,
    imageRoles: ['Premier frame', 'Dernier frame'],
    options: { duration: ['6'], resolution: ['1080P'] },
    ratios: null,
    build: ({ prompt, images }) => {
      const base = { prompt, prompt_optimizer: true };
      if (!images.length) return { model: 'hailuo/02-text-to-video-pro', input: base };
      const input = { ...base, image_url: images[0] };
      if (images[1]) input.end_image_url = images[1];
      return { model: 'hailuo/02-image-to-video-pro', input };
    },
    cost: () => 57,
  },
};

// Upscale : l'image affichée repasse dans Nano Banana Pro en 4K.
export const UPSCALE = {
  prompt: 'Upscale this image to 4K. Keep it strictly identical: same composition, faces, clothes, colors, lighting and details. Only increase resolution, sharpness and texture quality.',
  cost: 24,
};

export const modelsFor = (kind) => (kind === 'video' ? VIDEO_MODELS : IMAGE_MODELS);

// Options par défaut = première valeur de chaque liste.
export function defaultOpts(model, current = {}) {
  const o = {};
  for (const [k, vals] of Object.entries(model.options)) {
    o[k] = vals.includes(current[k]) ? current[k] : model.defaults?.[k] ?? vals[0];
  }
  return o;
}

export function formatCost(credits) {
  if (credits == null) return 'coût : voir kie.ai/pricing';
  return `≈ ${credits} crédits (~${(credits * CREDIT_USD).toFixed(2)} $)`;
}
