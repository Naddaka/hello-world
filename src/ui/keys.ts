/** Keys whose position gives the shortcut when the layout types a non-Latin character there. */
const PUNCTUATION: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

/**
 * The key a shortcut should match, in lower case. With a Latin layout it is the
 * typed character, so ⌘Z stays where the user's layout puts Z (QWERTY, AZERTY,
 * Dvorak). With a Cyrillic or other non-Latin layout `e.key` is «я», «в», «х»…,
 * so the physical key is used instead: ⌘Z works on the Russian or Ukrainian
 * layout too, as it does in native Mac apps.
 */
export function shortcutKey(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key.length === 1 && key.charCodeAt(0) > 0x7f) {
    const letter = /^Key([A-Z])$/.exec(e.code ?? '');
    if (letter) return letter[1].toLowerCase();
    const sign = PUNCTUATION[e.code ?? ''];
    if (sign) return sign;
  }
  return key;
}
