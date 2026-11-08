import { describe, expect, it } from 'vitest';
import { dataUrlToBlob, decodeDataUrl } from './dataUrl';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('decodeDataUrl', () => {
  it('decodes base64 payloads with their type', () => {
    const { type, bytes } = decodeDataUrl('data:text/plain;base64,0L/RgNC40LLQtdGC');
    expect(type).toBe('text/plain');
    expect(text(bytes)).toBe('привет');
  });

  it('decodes percent-encoded payloads', () => {
    const { type, bytes } = decodeDataUrl('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E');
    expect(type).toBe('image/svg+xml');
    expect(text(bytes)).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('keeps binary bytes intact and defaults the type', () => {
    const { type, bytes } = decodeDataUrl('data:;base64,AP+A');
    expect(type).toBe('text/plain');
    expect([...bytes]).toEqual([0, 255, 128]);
  });

  it('rejects anything that is not a data: URL', () => {
    expect(() => decodeDataUrl('https://example.com/a.png')).toThrow();
  });

  it('wraps the bytes in a Blob of the right type and size', () => {
    const blob = dataUrlToBlob('data:image/png;base64,AP+A');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });
});
