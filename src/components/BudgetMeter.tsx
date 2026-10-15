import { formatUsd } from "@/lib/format";

// Meter per the dataviz rules: fill carries severity (accent → warning → critical),
// track is a lighter step of the same hue, and state is always spelled out in text.
const ACCENT = "#3987e5";
const WARNING = "#fab219";
const CRITICAL = "#d03b3b";

export function BudgetMeter({ budget, spent, reserved }: { budget: number; spent: number; reserved: number }) {
  const used = spent + reserved;
  const ratio = budget > 0 ? used / budget : used > 0 ? Infinity : 0;
  const level = ratio >= 1 ? "critical" : ratio >= 0.8 ? "warning" : "ok";
  const fill = level === "critical" ? CRITICAL : level === "warning" ? WARNING : ACCENT;
  const pct = (n: number) => `${Math.min(100, budget > 0 ? (n / budget) * 100 : 100)}%`;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative h-2 overflow-hidden rounded-full"
        style={{ background: "rgba(57, 135, 229, 0.18)" }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={used}
        aria-label="Использование месячного лимита"
        title={`Потрачено ${formatUsd(spent)}${reserved ? `, в работе ${formatUsd(reserved)}` : ""} из ${formatUsd(budget)}`}
      >
        {/* reserved (in-flight) part: same hue, lighter, drawn under the spent part */}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(used), background: fill, opacity: 0.45 }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(spent), background: fill }} />
      </div>
      <div className="flex justify-between text-xs text-neutral-400">
        <span>
          {level === "critical" ? "⛔ Лимит исчерпан" : level === "warning" ? "⚠ Близко к лимиту" : "Лимит"}: {formatUsd(used)} из {formatUsd(budget)}
          {reserved > 0 && ` (в работе ${formatUsd(reserved)})`}
        </span>
        <span>{budget > 0 ? `${Math.round(ratio * 100)}%` : ""}</span>
      </div>
    </div>
  );
}
