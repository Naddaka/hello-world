import { create } from 'zustand';
import { keyStatus, type KeyStatus } from './transport';

/**
 * AI settings kept on this device: which Claude model answers, how thorough it
 * is, and the image model. Keys are not here — they live in the keychain.
 */

export type Effort = 'low' | 'medium' | 'high';

export interface ModelInfo {
  id: string;
  label: string;
  hint: string;
  /** US dollars per million tokens. */
  input: number;
  output: number;
  /** Refused requests can be retried server-side on the model Anthropic recommends. */
  fallback: boolean;
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Сильная и недорогая — подходит для всего', input: 4, output: 20, fallback: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Быстрее и вдвое дешевле', input: 2, output: 10, fallback: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Самая быстрая и дешёвая — для простых задач', input: 0.1, output: 0.5, fallback: false },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', hint: 'Самая сильная и самая дорогая', input: 8, output: 40, fallback: true },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';

export const modelInfo = (id: string): ModelInfo => MODELS.find((m) => m.id === id) ?? MODELS[0];

export const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: 'low', label: 'Быстро', hint: 'короче думает, дешевле' },
  { id: 'medium', label: 'Обычно', hint: 'баланс качества и цены' },
  { id: 'high', label: 'Тщательно', hint: 'дольше думает, дороже' },
];

interface Stored {
  model: string;
  effort: Effort;
  imageModel: string;
  imageQuality: string;
  /** The user has seen what is sent where. */
  consent: boolean;
  /** Money spent through the app, as counted from the answers' usage. */
  spent: number;
}

const KEY = 'zadum.ai';
const DEFAULTS: Stored = { model: DEFAULT_MODEL, effort: 'medium', imageModel: DEFAULT_IMAGE_MODEL, imageQuality: 'medium', consent: false, spent: 0 };

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>;
    return {
      ...DEFAULTS,
      ...raw,
      model: MODELS.some((m) => m.id === raw.model) ? raw.model! : DEFAULT_MODEL,
      effort: EFFORTS.some((e) => e.id === raw.effort) ? raw.effort! : 'medium',
    };
  } catch {
    return DEFAULTS;
  }
}

interface AiSettings extends Stored {
  keys: KeyStatus | null;
  settingsOpen: boolean;
}

export const useAiSettings = create<AiSettings>(() => ({ ...load(), keys: null, settingsOpen: false }));

export function setAiSettings(patch: Partial<Stored>) {
  useAiSettings.setState(patch);
  const { model, effort, imageModel, imageQuality, consent, spent } = useAiSettings.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ model, effort, imageModel, imageQuality, consent, spent }));
  } catch {
    // Blocked storage: settings last until the app closes.
  }
}

export const openAiSettings = () => useAiSettings.setState({ settingsOpen: true });

/** Reads which keys are saved; called on demand, since the keychain may ask the user. */
export async function refreshKeys(): Promise<KeyStatus> {
  let keys: KeyStatus;
  try {
    keys = await keyStatus();
  } catch (error) {
    console.warn('AI: key status unavailable', error);
    keys = { anthropic: false, openai: false };
  }
  useAiSettings.setState({ keys });
  return keys;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** What an answer cost, in US dollars, from its usage (cache writes cost 1.25×, cache reads 0.1×). */
export function costOf(model: string, usage: Usage): number {
  const m = modelInfo(model);
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * m.input + usage.output_tokens * m.output) / 1_000_000;
}

/** "≈ $0.03", "меньше цента". */
export function money(dollars: number): string {
  if (dollars < 0.005) return 'меньше цента';
  if (dollars < 1) return `≈ $${dollars.toFixed(2)}`;
  return `≈ $${dollars.toFixed(dollars < 10 ? 2 : 1)}`;
}
