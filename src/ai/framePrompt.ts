import type { SketchElement } from '../model/types';

/** How a generated storyboard frame should look. */
export const FRAME_STYLES = [
  { id: 'sketch', label: 'Раскадровка карандашом', prompt: 'Black and white storyboard sketch, loose pencil and marker drawing, clear silhouettes, simple shading, no text, no frame borders, no captions.' },
  { id: 'film', label: 'Кинокадр', prompt: 'Cinematic film still, photorealistic, natural lighting, shallow depth of field where it suits the shot, 35mm film look, no text, no watermark.' },
  { id: 'paint', label: 'Концепт-арт', prompt: 'Painterly concept art for a film, expressive light and colour, readable composition, no text.' },
  { id: 'anime', label: 'Анимация', prompt: 'Animation film frame, clean line art, flat cel shading, expressive staging, no text.' },
] as const;

export type FrameStyle = (typeof FRAME_STYLES)[number]['id'];

const SIZE_WORDS: Record<string, string> = {
  Дальний: 'extreme wide shot',
  Общий: 'wide shot',
  Средний: 'medium shot',
  Поясной: 'medium close-up',
  Крупный: 'close-up',
  Сверхкрупный: 'extreme close-up',
  Деталь: 'insert shot of a detail',
};
const ANGLE_WORDS: Record<string, string> = {
  Сверху: 'high angle',
  Снизу: 'low angle',
  'С высоты птичьего полёта': "bird's-eye view",
  'Голландский угол': 'dutch angle',
  'Через плечо': 'over-the-shoulder',
  'Субъективный (POV)': 'point-of-view shot',
};

/** The picture size closest to the frame's shape. */
export function frameImageSize(aspect: number): '1536x1024' | '1024x1536' | '1024x1024' {
  return aspect >= 1.2 ? '1536x1024' : aspect <= 0.85 ? '1024x1536' : '1024x1024';
}

/** The words about the shot the app knows from the frame's fields (shot size, angle, lens). */
export function shotWords(frame: Pick<SketchElement, 'shot'>): string {
  const shot = frame.shot;
  if (!shot) return '';
  return [SIZE_WORDS[shot.size], ANGLE_WORDS[shot.angle], shot.lens.trim() ? `${shot.lens.trim()} lens` : ''].filter(Boolean).join(', ');
}

/** The full prompt: what is in the frame (the user's words), how it is shot, and the style. */
export function framePrompt(description: string, frame: Pick<SketchElement, 'shot' | 'aspect'>, style: FrameStyle): string {
  const look = FRAME_STYLES.find((s) => s.id === style) ?? FRAME_STYLES[0];
  const shot = shotWords(frame);
  const shape = frame.aspect >= 2.2 ? 'Wide cinematic composition (the middle of the picture will be cropped to 2.39:1, keep the action away from the top and bottom edges).' : '';
  return [description.trim().replace(/\s+/g, ' '), shot ? `Shot: ${shot}.` : '', look.prompt, shape].filter(Boolean).join('\n');
}
