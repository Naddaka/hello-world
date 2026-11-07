/** Online players that a link card can show in place of a plain preview. */
export interface Embed {
  provider: 'youtube' | 'vimeo' | 'spotify' | 'soundcloud' | 'gmaps';
  src: string;
  /** Height as a fraction of width (video, maps) … */
  ratio?: number;
  /** … or a fixed height in pixels (audio players). */
  height?: number;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function embedFor(rawUrl: string): Embed | null {
  const u = parse(rawUrl);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    const id =
      host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1];
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    const start = u.searchParams.get('t')?.replace(/s$/, '');
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}${start && /^\d+$/.test(start) ? `?start=${start}` : ''}`, ratio: 9 / 16 };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.match(/(?:^|\/)(\d{5,})(?:\/|$)/)?.[1];
    return id ? { provider: 'vimeo', src: `https://player.vimeo.com/video/${id}`, ratio: 9 / 16 } : null;
  }
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    return m ? { provider: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 } : null;
  }
  if (host === 'soundcloud.com' && u.pathname.split('/').filter(Boolean).length >= 2) {
    return { provider: 'soundcloud', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(rawUrl)}&visual=false`, height: 166 };
  }
  if ((host === 'google.com' || host.startsWith('google.')) && u.pathname.startsWith('/maps')) {
    const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
    const place = u.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
    const q = place ? decodeURIComponent(place.replace(/\+/g, ' ')) : at ? `${at[1]},${at[2]}` : u.searchParams.get('q');
    if (!q) return null;
    const zoom = at ? Math.round(Number(at[3])) : 14;
    return { provider: 'gmaps', src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${zoom}&output=embed`, ratio: 3 / 4 };
  }
  return null;
}

/** Host name without "www." for display. */
export function displayHost(url: string): string {
  return parse(url)?.hostname.replace(/^www\./, '') ?? url;
}

/** Turns typed text into a URL if it looks like one. */
export function asUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return parse(t) ? t : null;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return `https://${t}`;
  return null;
}
