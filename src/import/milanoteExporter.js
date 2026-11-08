// Runs inside a signed-in Milanote page (app.milanote.com) and collects the
// user's boards with everything on them, the way the Milanote web client loads
// them itself. It only reads. The result is either handed to Zadum (when the
// page is open in Zadum's import window) or saved as milanote-export.json.
//
// This file is plain JavaScript on purpose: Zadum injects its source text into
// the page, and the same text can be pasted into the browser console.
// The whole file is one function expression; call it with
// { tauri: true } to deliver to Zadum, or with {} to download a file.
async function zadumMilanoteExport(options) {
  const opts = options || {};
  const tauri = opts.tauri ? window.__TAURI_INTERNALS__ : null;
  const conf = window.__clientconf || {};
  const apiBase = (conf.apiRoot || '') + '/api/';
  const appVersion = conf.appVersion || '1.0.0';
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // A small status box in the page so the user sees that something is happening.
  const box = document.createElement('div');
  box.setAttribute('data-zadum-export', '');
  box.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:10px;' +
    'background:#1f2329;color:#fff;font:13px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.3);white-space:pre-line';
  (document.body || document.documentElement).appendChild(box);

  const send = async (kind, data) => {
    if (tauri) await tauri.invoke('milanote_deliver', { kind, data });
  };
  const say = async (text) => {
    box.textContent = 'Zadum · экспорт из Milanote\n' + text;
    await send('progress', text);
  };

  async function headers() {
    const h = { 'Accept-Version': appVersion, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
    let token = null;
    try {
      token = window.localStorage.getItem('token');
    } catch (e) {
      token = null;
    }
    if (token) h.Authorization = 'Bearer ' + token;
    // The site sits behind a bot challenge; its token proves this is the real page.
    const waf = window.AwsWafIntegration;
    if (waf && typeof waf.getToken === 'function') {
      try {
        const t = await waf.getToken();
        if (t) h['x-aws-waf-token'] = t;
      } catch (e) {
        /* the cookie usually suffices */
      }
    }
    return h;
  }

  async function api(path, params) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await pause(1000 * 2 ** attempt);
      let response;
      try {
        response = await fetch(apiBase + path + query, { headers: await headers(), credentials: 'include' });
      } catch (e) {
        lastError = new Error('нет связи с Milanote');
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('Milanote не пускает: войдите в свой аккаунт и запустите импорт ещё раз.');
      }
      if (response.status === 429 || response.status >= 500 || response.status === 202) {
        lastError = new Error('Milanote ответил ' + response.status);
        continue;
      }
      if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
      return response.json();
    }
    throw lastError || new Error('Milanote не отвечает');
  }

  const idOf = (el, key) => (el && (el.id || el._id)) || key;

  try {
    await say('Смотрю аккаунт…');
    const me = await api('users/me');
    const user = (me && (me.user || me.currentUser)) || me || {};
    const roots = {
      home: user.rootBoardId || null,
      templates: user.templateRootId || null,
      quickNotes: user.quickNotesRootId || null,
    };
    if (!roots.home) throw new Error('Не нашёл домашнюю доску. Откройте Milanote, войдите и попробуйте снова.');

    const out = { elements: {}, comments: {}, labels: {}, canvasOrder: {}, errors: [] };
    const fetched = new Set();
    const queue = [roots.home, roots.quickNotes, roots.templates].filter(Boolean);
    const seen = new Set(queue);
    const enqueue = (id) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    };

    while (queue.length) {
      const batch = queue.splice(0, 5);
      await say('Досок прочитано: ' + fetched.size + ' из ' + seen.size + '\nЭлементов: ' + Object.keys(out.elements).length);
      let data;
      try {
        data = await api('boards', { ids: batch.join(','), excludeSelf: 'false', loadAncestors: 'false', canvasOrder: 'true' });
      } catch (e) {
        if (/не пускает/.test(String(e && e.message))) throw e;
        for (const id of batch) out.errors.push({ boardId: id, message: String((e && e.message) || e) });
        continue;
      }
      batch.forEach((id) => fetched.add(id));
      data = data || {};
      for (const key of Object.keys(data.elements || {})) {
        const el = data.elements[key];
        const id = idOf(el, key);
        out.elements[id] = el;
        const type = el && el.elementType;
        const content = (el && el.content) || {};
        if (type === 'BOARD') enqueue(id);
        // Shortcuts and synced copies may point at boards or cards elsewhere.
        if (type === 'ALIAS' && content.linkTo) enqueue(content.linkTo);
      }
      Object.assign(out.comments, data.comments || {});
      Object.assign(out.labels, data.labels || {});
      Object.assign(out.canvasOrder, data.canvasOrder || {});
      for (const key of Object.keys(data.errors || {})) out.errors.push({ boardId: key, message: JSON.stringify(data.errors[key]) });
      await pause(150);
    }

    const result = {
      format: 'milanote-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion,
      roots,
      boardCount: fetched.size,
      elements: out.elements,
      comments: out.comments,
      labels: out.labels,
      canvasOrder: out.canvasOrder,
      errors: out.errors,
    };
    const json = JSON.stringify(result);
    const count = Object.keys(out.elements).length;
    if (tauri) {
      await say('Передаю в Zadum…');
      const CHUNK = 512 * 1024;
      await send('begin', String(json.length));
      for (let i = 0; i < json.length; i += CHUNK) await send('chunk', json.slice(i, i + CHUNK));
      await send('done', JSON.stringify({ boards: fetched.size, elements: count, errors: out.errors.length }));
      box.textContent = 'Zadum · экспорт из Milanote\nГотово: ' + fetched.size + ' досок, ' + count + ' элементов. Вернитесь в Zadum.';
    } else {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'milanote-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      box.textContent =
        'Zadum · экспорт из Milanote\nГотово: ' + fetched.size + ' досок, ' + count + ' элементов.\nФайл milanote-export.json сохранён в «Загрузки». Откройте его в Zadum: Импорт → Из файла.';
    }
    setTimeout(() => box.remove(), 30000);
    return { boards: fetched.size, elements: count, errors: out.errors.length };
  } catch (e) {
    const message = String((e && e.message) || e);
    box.textContent = 'Zadum · экспорт из Milanote\nОшибка: ' + message;
    await send('error', message).catch(() => {});
    setTimeout(() => box.remove(), 30000);
    throw e;
  }
}
