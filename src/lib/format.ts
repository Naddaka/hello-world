export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "$" + (n < 1 ? n.toFixed(4).replace(/0{1,2}$/, "") : n.toFixed(2));
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

/** "1 мин 05 с" between two ISO timestamps (end defaults to now). */
export function formatDuration(fromIso: string | null, toIso?: string | null): string {
  if (!fromIso) return "—";
  const s = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`;
}

/** Russian plural: plural(5, ["задача", "задачи", "задач"]) → "задач". */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
