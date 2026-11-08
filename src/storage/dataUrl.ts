/**
 * Decodes a `data:` URL into a Blob without `fetch`. The desktop app's CSP
 * (`connect-src`) does not allow fetching `data:` URLs, so files that a Milanote
 * export carries inline would otherwise be lost.
 */
const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

export function decodeDataUrl(url: string): { type: string; bytes: Uint8Array<ArrayBuffer> } {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) throw new Error('not a data: URL');
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  const parts = meta.split(';');
  const base64 = parts.some((p) => p.trim().toLowerCase() === 'base64');
  const type = parts[0].trim() || 'text/plain';
  let bytes: Uint8Array<ArrayBuffer>;
  if (base64) {
    const binary = atob(decode(payload).replace(/\s+/g, ''));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decode(payload));
  }
  return { type, bytes };
}

export function dataUrlToBlob(url: string): Blob {
  const { type, bytes } = decodeDataUrl(url);
  return new Blob([bytes], { type });
}
