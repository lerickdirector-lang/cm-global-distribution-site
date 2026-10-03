// Languages. The site is written in English; this swaps every piece of visible text for its
// translation, on every page, from the dictionaries in assets/i18n/ — translated by hand for the
// trade, not by a machine on the fly, and served from this site so no third party sees a visit.
//
// How it works: the chosen language is remembered in this browser, and its dictionary is kept
// beside it, so each page is translated before anything else runs (the home page splits its
// headline into letters for an animation, and a split headline can no longer be matched). A
// one-line script in each page's head hides the page until this has run, so English never flashes
// up first. Text that has no translation simply stays in English.
//
// When the site's English wording changes, the dictionaries need the new text: collect it with
// cmI18n.collect() on each page (below) into i18n/strings.json, translate what is new, and run
// `node i18n/check.mjs`, which lists anything missing in any language. Until then, changed text
// simply shows in English.
//
// The enquiry form still sends English: an option's English wording is kept as its value before
// its label is translated, so an enquiry arrives readable whatever language it was filled in.
(() => {
  const LANGS = [
    { code: 'en', name: 'English', flag: 'gb' },
    { code: 'de', name: 'Deutsch', flag: 'de' },
    { code: 'fr', name: 'Français', flag: 'fr' },
    { code: 'nl', name: 'Nederlands', flag: 'nl' },
    { code: 'pl', name: 'Polski', flag: 'pl' },
    { code: 'it', name: 'Italiano', flag: 'it' },
    { code: 'es', name: 'Español', flag: 'es' },
    { code: 'pt', name: 'Português', flag: 'pt' },
    { code: 'cs', name: 'Čeština', flag: 'cz' },
    { code: 'ar', name: 'العربية', flag: 'ae', rtl: true },
  ];
  const KEY = 'cm-lang', DICT = 'cm-lang-dict';
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
  };
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'TEXTAREA']);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const hasWords = (s) => /\p{L}/u.test(s);

  let map = null, patterns = [];
  const original = new WeakMap(), written = new WeakMap();

  const load = (dict) => {
    map = new Map(Object.entries(dict).filter(([k]) => !k.startsWith('_')));
    // Entries with {1}, {2}… stand for a part that changes, such as a visitor's name
    patterns = [...map].filter(([k]) => /\{\d\}/.test(k)).map(([k, v]) => {
      const rx = new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d)\\\}/g, '(.+?)')}$`);
      return [rx, v];
    });
  };
  const lookup = (text) => {
    if (map.has(text)) return map.get(text);
    for (const [rx, v] of patterns) {
      const m = text.match(rx);
      if (m) return v.replace(/\{(\d)\}/g, (_, i) => lookup(m[i]) || m[i]);
    }
    return null;
  };

  const skipped = (el) => !el || el.closest('[translate="no"], .notranslate') || SKIP.has(el.tagName);

  function textNode(node) {
    if (skipped(node.parentElement)) return;
    const now = node.nodeValue;
    // a node the page itself has since rewritten starts again from what it now says
    if (!original.has(node) || written.get(node) !== now) original.set(node, now);
    const from = original.get(node), key = norm(from);
    if (!key || !hasWords(key)) return;
    // the same English word can need different translations in different places (the headline's
    // "Authorised" is not the stamp's), so such text carries a context and is looked up with it first
    const ctx = node.parentElement.closest('[data-i18n-ctx]')?.dataset.i18nCtx;
    const to = (ctx && lookup(`${ctx}: ${key}`)) || lookup(key);
    const next = to ? from.match(/^\s*/)[0] + to + from.match(/\s*$/)[0] : from;
    written.set(node, next);
    if (next !== now) node.nodeValue = next;
  }
  const attrOriginal = new WeakMap(); // element → { attribute: [english, last written] }
  function attributes(el) {
    if (skipped(el)) return;
    // an option keeps its English wording as the value the form sends
    if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.textContent.trim());
    let seen = attrOriginal.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      if (!seen) attrOriginal.set(el, (seen = {}));
      const now = el.getAttribute(a);
      if (!seen[a] || seen[a][1] !== now) seen[a] = [now, now];
      const to = lookup(norm(seen[a][0]));
      if (to && to !== now) { seen[a][1] = to; el.setAttribute(a, to); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    attributes(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      if (n.nodeType === 3) textNode(n); else attributes(n);
    }
  }

  function translatePage() {
    const title = lookup(norm(document.title));
    if (title) document.title = title;
    walk(document.body);
    // whatever the page writes later (form messages, the menu button, the thank-you) follows suit
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') { if (written.get(r.target) !== r.target.nodeValue) textNode(r.target); }
        else if (r.type === 'attributes') attributes(r.target);
        else r.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  const current = () => LANGS.find((l) => l.code === store.get(KEY)) || LANGS[0];
  const lang = current();
  document.documentElement.lang = lang.code === 'en' ? 'en-GB' : lang.code;
  if (lang.rtl) document.documentElement.dir = 'rtl'; else document.documentElement.removeAttribute('dir');

  const reveal = () => document.documentElement.classList.remove('i18n-wait');
  const fetchDict = (code) => fetch(`/assets/i18n/${code}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });

  if (lang.code !== 'en') {
    const cached = store.get(DICT);
    let cachedCode = null, cachedText = null;
    try { ({ code: cachedCode, text: cachedText } = JSON.parse(cached || '{}')); } catch { /* start again */ }
    if (cachedCode === lang.code && cachedText) {
      try { load(JSON.parse(cachedText)); translatePage(); } catch { /* fall through to English */ }
      reveal();
      // keep the stored copy current; a changed dictionary takes effect from the next page
      fetchDict(lang.code).then((text) => { if (text !== cachedText) store.set(DICT, JSON.stringify({ code: lang.code, text })); }).catch(() => {});
    } else {
      fetchDict(lang.code).then((text) => {
        store.set(DICT, JSON.stringify({ code: lang.code, text }));
        load(JSON.parse(text)); translatePage();
      }).catch(() => {}).finally(reveal);
    }
  } else reveal();

  // ---------- The language menu in the header ----------
  const picker = document.querySelector('.lang-picker');
  if (picker) {
    const button = picker.querySelector('.lang-button'), list = picker.querySelector('.lang-list');
    // the button shows the language in use
    button.querySelector('use').setAttribute('href', `#flag-${lang.flag}`);
    button.querySelector('.lang-code').textContent = lang.code.toUpperCase();
    list.querySelectorAll('button[data-lang]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.lang === lang.code)));
    const setOpen = (open) => {
      button.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
      if (open) (list.querySelector('[aria-current="true"]') || list.querySelector('button')).focus();
    };
    button.addEventListener('click', () => setOpen(list.hidden));
    document.addEventListener('click', (e) => { if (!list.hidden && !picker.contains(e.target)) setOpen(false); });
    picker.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !list.hidden) { setOpen(false); button.focus(); }
      const items = [...list.querySelectorAll('button')], at = items.indexOf(document.activeElement);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && at !== -1) {
        e.preventDefault();
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    list.querySelectorAll('button[data-lang]').forEach((b) => b.addEventListener('click', () => {
      const code = b.dataset.lang;
      if (code === lang.code) { setOpen(false); return; }
      b.setAttribute('aria-busy', 'true');
      if (code === 'en') { store.del(KEY); store.del(DICT); location.reload(); return; }
      fetchDict(code).then((text) => {
        const kept = store.set(KEY, code) && store.set(DICT, JSON.stringify({ code, text }));
        if (kept) location.reload();
        else { load(JSON.parse(text)); translatePage(); setOpen(false); } // nowhere to remember it: this page only
      }).catch(() => b.removeAttribute('aria-busy'));
    }));
  }

  // For building the dictionaries: every piece of text this page shows, in English
  window.cmI18n = {
    collect() {
      const out = new Set([norm(document.title)]);
      const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = it.nextNode(); n; n = it.nextNode()) {
        if (n.nodeType === 3) {
          if (!skipped(n.parentElement)) {
            const k = norm(n.nodeValue), ctx = n.parentElement.closest('[data-i18n-ctx]')?.dataset.i18nCtx;
            if (k && hasWords(k)) out.add(ctx ? `${ctx}: ${k}` : k);
          }
        }
        else if (!skipped(n)) for (const a of ATTRS) if (n.hasAttribute(a)) { const k = norm(n.getAttribute(a)); if (k && hasWords(k)) out.add(k); }
      }
      return [...out];
    },
  };
})();
