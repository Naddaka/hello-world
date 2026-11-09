/** One or two letters or digits for a letter icon, or '' when the text is not that. */
export function letterIcon(text: string): string {
  const chars = [...text.trim()];
  return chars.length >= 1 && chars.length <= 2 && chars.every((c) => /[\p{L}\p{N}]/u.test(c)) ? chars.join('').toUpperCase() : '';
}
