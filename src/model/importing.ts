import { isScriptFileName, newScriptFields, parseScriptFile } from '../script/ScriptEditor';
import { actions, useStore } from './store';
import { DEFAULT_WIDTH, GRID, type ElementFields, type FileElement, type ImageElement, type LinkElement } from './types';
import { media, type MediaInfo } from '../storage/media';
import { displayHost } from './embeds';

/** Width in grid units for an image, keeping small pictures at their own size. */
function imageWidth(info: MediaInfo) {
  const natural = info.width ?? 640;
  return Math.max(12, Math.min(40, Math.round(natural / 2 / GRID)));
}

function cardFor(info: MediaInfo): ElementFields<ImageElement> | ElementFields<FileElement> {
  const ref = { id: info.id, ext: info.ext };
  if (info.mime.startsWith('image/') && info.width && info.height) {
    return { type: 'IMAGE', media: ref, name: info.name, naturalWidth: info.width, naturalHeight: info.height, caption: '', showCaption: false };
  }
  return { type: 'FILE', media: ref, name: info.name, size: info.size, mime: info.mime, autoplay: false, loop: false };
}

/**
 * Imports files (desktop paths or browser File objects) into the media library
 * and places a card for each, cascading from the given grid point.
 */
export async function addFiles(items: (string | File)[], at: { x: number; y: number }, parentId = useStore.getState().boardId) {
  if (items.length === 0) return;
  const lib = await media();
  const ids: string[] = [];
  // Several files are laid out side by side rather than stacked on top of each other.
  let x = at.x;
  for (const item of items) {
    try {
      const name = typeof item === 'string' ? (item.split('/').pop() ?? '') : item.name;
      if (isScriptFileName(name)) {
        // Screenplays become script cards instead of plain files.
        const text = typeof item === 'string' ? await (await import('@tauri-apps/api/core')).invoke<string>('read_text_file', { path: item }) : await item.text();
        const parsed = parseScriptFile(name, text);
        const title = parsed.titlePage.title || name.replace(/\.[^.]+$/, '');
        ids.push(actions.insert(newScriptFields(parsed.blocks, parsed.titlePage, title), parentId, x, at.y));
        x += DEFAULT_WIDTH.SCRIPT + 3;
        continue;
      }
      const info = typeof item === 'string' ? await lib.importPath(item) : await lib.importFile(item);
      const fields = cardFor(info);
      const width = fields.type === 'IMAGE' ? imageWidth(info) : DEFAULT_WIDTH.FILE;
      ids.push(actions.insert(fields, parentId, x, at.y, width));
      x += width + 3;
    } catch (error) {
      console.error(error);
      actions.showToast(`Не удалось добавить файл: ${typeof item === 'string' ? item.split('/').pop() : item.name}`);
    }
  }
  if (ids.length) actions.select(ids);
}

/** Fetches a link's title, description and image, saving the image locally. */
export async function loadLinkPreview(id: string, url: string) {
  const lib = await media();
  actions.setLive(id, { url, status: 'loading', title: displayHost(url) });
  const preview = await lib.preview(url);
  const image = preview?.imageUrl ? await lib.importUrl(preview.imageUrl) : null;
  const current = useStore.getState().elements[id] as LinkElement | undefined;
  if (!current) return;
  actions.setLive(id, {
    url,
    title: preview?.title || displayHost(url),
    description: preview?.description ?? '',
    siteName: preview?.siteName || displayHost(preview?.finalUrl || url),
    image: image ? { id: image.id, ext: image.ext } : null,
    status: preview ? 'ready' : 'error',
  });
}

/** Creates a link card. Without a URL it opens in "paste a link" mode. */
export function addLink(url: string | null, at: { x: number; y: number }, parentId = useStore.getState().boardId): string {
  const fields: ElementFields<LinkElement> = {
    type: 'LINK',
    url: url ?? '',
    title: url ? displayHost(url) : '',
    description: '',
    siteName: url ? displayHost(url) : '',
    image: null,
    showImage: true,
    showDescription: true,
    status: url ? 'loading' : 'empty',
  };
  const id = actions.insert(fields, parentId, at.x, at.y);
  if (url) {
    actions.select([id]);
    void loadLinkPreview(id, url);
  } else actions.setEditing(id);
  return id;
}
