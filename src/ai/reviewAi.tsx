import { useState } from 'react';
import { nanoid } from 'nanoid';
import { actions, useStore } from '../model/store';
import { DEFAULT_WIDTH, type FileElement, type TaskItem, type VideoMarker } from '../model/types';
import { freeSpot } from '../canvas/placement';
import { openAiJob } from './AiDialog';
import { checkTasks, tasksRequest, type TaskProposal } from './boardPrompts';

/**
 * Video review comments as a to-do list on the board: either as they are
 * (one task per comment, with its timecode), or rewritten by AI into a list
 * of edits for the editor, with comments about the same thing merged.
 */

const item = (text: string, done = false): TaskItem => ({ id: nanoid(8), text, done, due: null, indent: 0 });

/** Puts a task list next to the video's card; returns its id. */
export function placeTasks(file: FileElement, title: string, items: TaskItem[]): string {
  const parentId = file.parentId ?? useStore.getState().boardId;
  const inColumn = useStore.getState().elements[parentId]?.type === 'COLUMN';
  if (inColumn) return actions.insert({ type: 'TASK_LIST', title, showTitle: true, items }, parentId, 0, 0);
  const spot = freeSpot(parentId, file.x + file.width + 3, file.y, DEFAULT_WIDTH.TASK_LIST, items.length * 4 + 6);
  return actions.insert({ type: 'TASK_LIST', title, showTitle: true, items }, parentId, spot.x, spot.y);
}

/** One task per comment: "00:01:23:10 — text"; comments marked as done stay ticked. */
export function markersAsTasks(markers: VideoMarker[], tc: (seconds: number) => string): TaskItem[] {
  return markers.filter((m) => m.text.trim()).map((m) => item(`${tc(m.time)} — ${m.text.trim().replace(/\s+/g, ' ')}`, m.done));
}

/** The comments as the model reads them, one per line. */
export function markersForModel(markers: VideoMarker[], tc: (seconds: number) => string): string {
  return markers
    .filter((m) => m.text.trim())
    .map((m) => `${tc(m.time)}${m.done ? ' (уже сделано)' : ''} — ${m.text.trim().replace(/\s+/g, ' ')}`)
    .join('\n');
}

export function reviewTasksAsIs(file: FileElement, markers: VideoMarker[], tc: (seconds: number) => string) {
  const items = markersAsTasks(markers, tc);
  if (!items.length) return actions.showToast('В комментариях нет текста');
  placeTasks(file, `Правки: ${file.name}`, items);
  actions.showToast(`Список задач (${items.length}) добавлен на доску рядом с видео`);
}

export function reviewTasksWithAi(file: FileElement, markers: VideoMarker[], tc: (seconds: number) => string) {
  const open = markers.filter((m) => m.text.trim());
  if (!open.length) return actions.showToast('В комментариях нет текста');
  const known = new Set(open.map((m) => tc(m.time)));
  openAiJob<{ tasks: TaskProposal[] }>({
    title: 'Комментарии → список правок',
    sends: `комментарии к «${file.name}» с таймкодами (${open.length}); само видео не отправляется`,
    request: tasksRequest(file.name, markersForModel(markers, tc)),
    wide: true,
    Result: ({ answer, close }) => <TasksResult file={file} tasks={checkTasks(answer.data?.tasks, known)} close={close} />,
  });
}

function TasksResult({ file, tasks, close }: { file: FileElement; tasks: TaskProposal[]; close: () => void }) {
  const [picked, setPicked] = useState(() => new Set(tasks.map((_, i) => i)));
  if (!tasks.length) {
    return (
      <>
        <p>Модель не нашла в комментариях того, что нужно сделать.</p>
        <footer className="modal-foot"><button type="button" className="btn-accent" onClick={close}>Закрыть</button></footer>
      </>
    );
  }
  return (
    <>
      <p>Правок: {tasks.length}. Отметьте, что взять в список задач. Он появится на доске рядом с видео.</p>
      <ul className="ai-check-list" aria-label="Предложенные правки">
        {tasks.map((t, i) => (
          <li key={i}>
            <input
              type="checkbox"
              id={`ai-task-${i}`}
              checked={picked.has(i)}
              onChange={() => setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })}
            />
            <label htmlFor={`ai-task-${i}`} className="grow">
              {t.text}
              {t.timecodes.length > 0 && <span className="sub"> · {t.timecodes.join(', ')}</span>}
            </label>
          </li>
        ))}
      </ul>
      <footer className="modal-foot">
        <button type="button" className="ibtn wide" onClick={close}>Не создавать</button>
        <button
          type="button"
          className="btn-accent"
          disabled={!picked.size}
          onClick={() => {
            const live = useStore.getState().elements[file.id];
            const items = tasks.filter((_, i) => picked.has(i)).map((t) => item(t.timecodes.length ? `${t.timecodes.join(', ')} — ${t.text}` : t.text));
            placeTasks(live?.type === 'FILE' ? live : file, `Правки: ${file.name}`, items);
            actions.showToast(`Список правок (${items.length}) добавлен на доску рядом с видео`);
            close();
          }}
        >
          Создать список задач ({picked.size})
        </button>
      </footer>
    </>
  );
}
