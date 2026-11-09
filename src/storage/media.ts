import { useEffect, useState } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import type { MediaRef } from '../model/types';
import { isTauri } from './repo';

/** What the media library reports about a stored file. */
export interface MediaInfo {
  id: string;
  ext: string;
  name: string;
  size: number;
  mime: string;
  width?: number | null;
  height?: number | null;
}

export interface LinkPreview {
  url: string;
  finalUrl: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
}

interface MediaBackend {
  importFile(file: File): Promise<MediaInfo>;
  importPath(path: string): Promise<MediaInfo>;
  importUrl(url: string): Promise<MediaInfo | null>;
  /** Deletes stored files nothing refers to any more. */
  remove(refs: MediaRef[]): Promise<void>;
  /** Deletes library files whose id is not in `keep` and that are older than `minAgeSecs`; resolves to how many went. */
  prune(keep: string[], minAgeSecs: number): Promise<number>;
  /** Downloads a file of any size by URL (imports); rejects with the reason on failure. */
  download(url: string, name: string): Promise<MediaInfo>;
  src(ref: MediaRef): Promise<string>;
  preview(url: string): Promise<LinkPreview | null>;
  openUrl(url: string): Promise<void>;
  openMedia(ref: MediaRef): Promise<void>;
  revealMedia(ref: MediaRef): Promise<void>;
  /** Lets the user pick files; resolves to paths (desktop) or File objects (browser). */
  pickFiles(): Promise<(string | File)[]>;
}

const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? 'bin').toLowerCase();

async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (!blob.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/** Desktop: files live in the app data folder and are shown through the asset protocol. */
async function tauriBackend(): Promise<MediaBackend> {
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
  const opener = await import('@tauri-apps/plugin-opener');
  const dir = await invoke<string>('media_location');
  const pathOf = (ref: MediaRef) => `${dir}/${ref.id}.${ref.ext}`;
  return {
    importPath: (path) => invoke<MediaInfo>('import_media_file', { path }),
    async importFile(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return invoke<MediaInfo>('save_media_bytes', bytes, { headers: { 'x-name': encodeURIComponent(file.name || 'вставка.png'), 'x-type': file.type || '' } });
    },
    async importUrl(url) {
      try {
        return await invoke<MediaInfo>('import_media_url', { url });
      } catch {
        return null;
      }
    },
    download: (url, name) => invoke<MediaInfo>('download_media', { url, name }),
    async remove(refs) {
      if (refs.length) await invoke('delete_media', { files: refs.map((r) => `${r.id}.${r.ext}`) });
    },
    prune: (keep, minAgeSecs) => invoke<number>('prune_media', { keep, minAgeSecs }),
    src: async (ref) => convertFileSrc(pathOf(ref)),
    async preview(url) {
      try {
        return await invoke<LinkPreview>('link_preview', { url });
      } catch {
        return null;
      }
    },
    openUrl: (url) => opener.openUrl(url),
    openMedia: (ref) => opener.openPath(pathOf(ref)),
    revealMedia: (ref) => opener.revealItemInDir(pathOf(ref)),
    async pickFiles() {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ multiple: true, directory: false });
      return picked ? (Array.isArray(picked) ? picked : [picked]) : [];
    },
  };
}

/** Browser: blobs in IndexedDB, shown through object URLs. No link previews (CORS). */
async function browserBackend(): Promise<MediaBackend> {
  const db: IDBPDatabase = await openDB('zadum-media', 1, {
    upgrade(d) {
      d.createObjectStore('files');
    },
  });
  const urls = new Map<string, string>();
  const src = async (ref: MediaRef) => {
    const cached = urls.get(ref.id);
    if (cached) return cached;
    const blob = (await db.get('files', ref.id)) as Blob | undefined;
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urls.set(ref.id, url);
    return url;
  };
  const importFile = async (file: File): Promise<MediaInfo> => {
    const id = crypto.randomUUID().replace(/-/g, '');
    await db.put('files', file, id);
    const size = await imageSize(file);
    return { id, ext: extOf(file.name), name: file.name || 'файл', size: file.size, mime: file.type || 'application/octet-stream', width: size?.width, height: size?.height };
  };
  return {
    importFile,
    importPath: () => Promise.reject(new Error('пути к файлам доступны только в приложении')),
    importUrl: async () => null,
    async remove(refs) {
      for (const r of refs) {
        await db.delete('files', r.id);
        const url = urls.get(r.id);
        if (url) URL.revokeObjectURL(url);
        urls.delete(r.id);
      }
    },
    // Browser storage keeps no file dates, so there is no safe way to tell old leftovers apart.
    prune: async () => 0,
    async download(url, name) {
      // Works for data: URLs and servers that allow cross-origin reads.
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return importFile(new File([blob], name, { type: blob.type }));
    },
    src,
    preview: async () => null,
    async openUrl(url) {
      window.open(url, '_blank', 'noopener');
    },
    async openMedia(ref) {
      window.open(await src(ref), '_blank', 'noopener');
    },
    async revealMedia(ref) {
      window.open(await src(ref), '_blank', 'noopener');
    },
    pickFiles: () =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = () => resolve([...(input.files ?? [])]);
        input.click();
      }),
  };
}

let backend: Promise<MediaBackend> | null = null;
export function media(): Promise<MediaBackend> {
  backend ??= isTauri() ? tauriBackend() : browserBackend();
  return backend;
}

/** URL to display a stored file, or null while it resolves. */
export function useMediaSrc(ref: MediaRef | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const key = ref ? `${ref.id}.${ref.ext}` : '';
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    media()
      .then((m) => m.src(ref))
      .then((url) => alive && setSrc(url || null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref ? src : null;
}
