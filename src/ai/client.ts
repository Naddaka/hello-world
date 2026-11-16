import Anthropic from '@anthropic-ai/sdk';
import { anthropicFetch } from './transport';

/**
 * The Claude API client. The key placeholder is never sent anywhere: requests
 * go through `anthropicFetch`, which strips credentials, and the native side
 * adds the real key from the keychain. That is also why running the SDK in
 * the web view is safe here.
 */
export const claude = new Anthropic({
  apiKey: 'kept-in-the-keychain',
  fetch: anthropicFetch,
  dangerouslyAllowBrowser: true,
  maxRetries: 2,
});

export { Anthropic };
