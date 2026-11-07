import { isTauri } from './repo';

/**
 * Saves a file the user names in the system dialog (desktop) or downloads it
 * (browser). Returns false if the user cancelled.
 */
export async function saveFile(defaultName: string, contents: string | Uint8Array, mime: string, filter: { name: string; extensions: string[] }): Promise<boolean> {
  const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await save({ defaultPath: defaultName, filters: [filter] });
    if (!path) return false;
    await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

/**
 * Prints an HTML fragment through the system print dialog, where macOS offers
 * "Save as PDF". The rest of the app is hidden while printing.
 */
export async function printHtml(html: string, title: string) {
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = html;
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const previousTitle = document.title;
  document.title = title;
  const cleanup = () => {
    root.remove();
    document.body.classList.remove('printing');
    document.title = previousTitle;
  };
  try {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('print_window');
      // The native dialog is modal on macOS; give layout a moment before cleaning up.
      setTimeout(cleanup, 1500);
    } else {
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Safe file name from a title. */
export function fileName(title: string, ext: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Без названия';
  return `${base}.${ext}`;
}
