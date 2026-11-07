import { useRef, useState } from 'react';
import { actions } from '../model/store';
import type { FileElement, ImageElement, LinkElement } from '../model/types';
import { media, useMediaSrc } from '../storage/media';
import { asUrl, displayHost, embedFor } from '../model/embeds';
import { loadLinkPreview } from '../model/importing';
import { IconExternal, IconFile, IconLink, IconPlay } from '../ui/icons';
import { StrokesSvg } from '../draw/SketchEditor';

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

// ---------- image ----------
function CaptionInput({ element }: { element: ImageElement }) {
  const [value, setValue] = useState(element.caption);
  const finish = () => {
    actions.update(element.id, { caption: value.trim(), showCaption: value.trim().length > 0 || element.showCaption });
    actions.setEditing(null);
  };
  return (
    <input
      className="caption-input"
      aria-label="Подпись к изображению"
      autoFocus
      value={value}
      placeholder="Подпись"
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') finish();
      }}
      onBlur={finish}
    />
  );
}

export function ImageCard({ element, selected, editing }: { element: ImageElement; selected: boolean; editing: boolean }) {
  const src = useMediaSrc(element.media);
  return (
    <figure className={`media-card${selected ? ' selected' : ''}`}>
      <div className="media-frame" style={{ aspectRatio: `${element.naturalWidth} / ${element.naturalHeight}` }}>
        {src ? <img src={src} alt={element.caption || element.name} draggable={false} /> : <div className="media-missing">{element.name}</div>}
        {element.annotations && element.annotations.length > 0 && <StrokesSvg strokes={element.annotations} aspect={element.naturalWidth / element.naturalHeight} className="annotations" />}
      </div>
      {editing ? (
        <figcaption><CaptionInput element={element} /></figcaption>
      ) : (
        element.showCaption && element.caption && <figcaption>{element.caption}</figcaption>
      )}
    </figure>
  );
}

// ---------- file: video, audio or any other document ----------
export function FileCard({ element, selected }: { element: FileElement; selected: boolean }) {
  const src = useMediaSrc(element.media);
  const kind = element.mime.startsWith('video/') ? 'video' : element.mime.startsWith('audio/') ? 'audio' : 'file';
  const open = async () => (await media()).openMedia(element.media);
  const reveal = async () => (await media()).revealMedia(element.media);
  return (
    <div className={`media-card file-card${selected ? ' selected' : ''}`}>
      {kind === 'video' && src && (
        <video className="media-video" src={src} controls preload="metadata" autoPlay={element.autoplay} muted={element.autoplay} loop={element.loop} onPointerDown={stop} />
      )}
      {kind === 'audio' && src && <audio className="media-audio" src={src} controls preload="metadata" autoPlay={element.autoplay} loop={element.loop} onPointerDown={stop} />}
      <div className="file-row">
        <span className="file-icon" aria-hidden="true">
          <IconFile size={20} />
          <span className="file-ext">{element.media.ext.slice(0, 4)}</span>
        </span>
        <span className="file-meta">
          <span className="file-name">{element.name}</span>
          <span className="file-size">{formatSize(element.size)}</span>
        </span>
        <button type="button" className="ibtn" aria-label="Открыть файл" title="Открыть" onPointerDown={stop} onClick={open}>
          <IconExternal size={16} />
        </button>
        <button type="button" className="link-btn" onPointerDown={stop} onClick={reveal}>
          Показать
        </button>
      </div>
    </div>
  );
}

// ---------- link, with online players for known media sites ----------
function UrlInput({ element }: { element: LinkElement }) {
  const [value, setValue] = useState(element.url);
  const done = useRef(false);
  const finish = (save: boolean) => {
    // Enter submits and the input then loses focus: handle only the first.
    if (done.current) return;
    done.current = true;
    const url = asUrl(value);
    actions.setEditing(null);
    if (save && url && url !== element.url) void loadLinkPreview(element.id, url);
    else if (!element.url) actions.discard(element.id);
  };
  return (
    <form className="url-form" onSubmit={(e) => { e.preventDefault(); finish(true); }} onPointerDown={stop}>
      <IconLink size={16} />
      <input
        className="url-input"
        aria-label="Адрес ссылки"
        autoFocus
        value={value}
        placeholder="Вставьте ссылку и нажмите Enter"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </form>
  );
}

export function LinkCard({ element, selected, editing }: { element: LinkElement; selected: boolean; editing: boolean }) {
  const image = useMediaSrc(element.image);
  const [playing, setPlaying] = useState(false);
  const embed = element.url ? embedFor(element.url) : null;
  const openExternal = async () => (await media()).openUrl(element.url);
  const cls = `media-card link-card${selected ? ' selected' : ''}${element.status === 'loading' ? ' loading' : ''}`;

  if (editing || element.status === 'empty') {
    return <div className={cls}>{editing ? <UrlInput element={element} /> : <div className="link-empty">Ссылка не указана</div>}</div>;
  }

  return (
    <div className={cls}>
      {embed && playing ? (
        <div className="embed" style={embed.height ? { height: embed.height } : { aspectRatio: `1 / ${embed.ratio}` }} onPointerDown={stop}>
          <iframe
            src={`${embed.src}${embed.src.includes('?') ? '&' : '?'}autoplay=1`}
            title={element.title}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        element.showImage &&
        (image || embed) && (
          <div className="link-image" style={embed?.ratio ? { aspectRatio: `1 / ${embed.ratio}` } : undefined}>
            {image && <img src={image} alt="" draggable={false} />}
            {embed && (
              <button type="button" className="play" aria-label="Воспроизвести" onPointerDown={stop} onClick={() => setPlaying(true)}>
                <IconPlay size={22} />
              </button>
            )}
          </div>
        )
      )}
      <div className="link-body">
        <div className="link-title">{element.title || displayHost(element.url)}</div>
        {element.showDescription && element.description && <div className="link-desc">{element.description}</div>}
        <div className="link-site">
          <span>{element.status === 'loading' ? 'Загружаю превью…' : element.siteName || displayHost(element.url)}</span>
          <button type="button" className="ibtn" aria-label="Открыть в браузере" title="Открыть в браузере" onPointerDown={stop} onClick={openExternal}>
            <IconExternal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
