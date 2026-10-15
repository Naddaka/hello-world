// Model parameter schema: stored as JSON in models.params_schema, rendered as a form,
// validated on the server before a job is created.

export type ParamOption = { value: string | number; label?: string };

type Base = { key: string; label: string; help?: string; required?: boolean };

export type ParamField =
  | (Base & { type: "select"; options: ParamOption[]; default?: string | number })
  | (Base & { type: "number"; min?: number; max?: number; step?: number; integer?: boolean; default?: number })
  | (Base & { type: "boolean"; default?: boolean })
  | (Base & { type: "text"; maxLength?: number; default?: string })
  /** Uploaded image; value is a reference to a stored upload (implemented with reference images). */
  | (Base & { type: "image" });

export type ParamValues = Record<string, string | number | boolean>;

/** Upload ids as stored in params for "image" fields: <uuid>.<ext>. */
export const UPLOAD_ID_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

export type ValidationResult = { ok: true; params: ParamValues } | { ok: false; error: string };

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "";
}

/** Coerce and check user input against the schema. Unknown keys are dropped, defaults filled in. */
export function validateParams(schema: ParamField[], input: Record<string, unknown>): ValidationResult {
  const out: ParamValues = {};
  for (const f of schema) {
    const raw = input[f.key];
    if (isEmpty(raw)) {
      if ("default" in f && f.default !== undefined) out[f.key] = f.default;
      else if (f.required) return { ok: false, error: `Не заполнено поле «${f.label}».` };
      continue;
    }
    switch (f.type) {
      case "select": {
        const opt = f.options.find((o) => String(o.value) === String(raw));
        if (!opt) return { ok: false, error: `Недопустимое значение поля «${f.label}».` };
        out[f.key] = opt.value;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return { ok: false, error: `Поле «${f.label}» должно быть числом.` };
        if (f.integer && !Number.isInteger(n)) return { ok: false, error: `Поле «${f.label}» должно быть целым.` };
        if (f.min !== undefined && n < f.min) return { ok: false, error: `«${f.label}»: минимум ${f.min}.` };
        if (f.max !== undefined && n > f.max) return { ok: false, error: `«${f.label}»: максимум ${f.max}.` };
        out[f.key] = n;
        break;
      }
      case "boolean":
        out[f.key] = raw === true || raw === "true" || raw === "on" || raw === "1";
        break;
      case "text": {
        const s = String(raw);
        if (f.maxLength && s.length > f.maxLength) return { ok: false, error: `«${f.label}»: не длиннее ${f.maxLength} символов.` };
        out[f.key] = s;
        break;
      }
      case "image":
        if (!UPLOAD_ID_RE.test(String(raw))) return { ok: false, error: `«${f.label}»: некорректный файл.` };
        out[f.key] = String(raw);
        break;
    }
  }
  return { ok: true, params: out };
}
