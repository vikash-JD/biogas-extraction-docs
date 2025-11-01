/* global marked, AOS, hljs */
(function () {
  const DOC_PATH = 'docs/Biogas_Extraction_POC_Document.md';

  const state = {
    sections: [],
    searchIndex: [],
    isLight: false,
  };

  function $(selector, root = document) { return root.querySelector(selector); }
  function $all(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  function throttle(fn, wait) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  function updateYear() {
    const yearEl = $('#year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }

  function initTheme() {
    const saved = localStorage.getItem('biogas-docs-theme');
    if (saved === 'light') {
      document.body.classList.add('is-light');
      state.isLight = true;
    }
    const toggle = $('#dark-toggle');
    toggle?.addEventListener('click', () => {
      state.isLight = !state.isLight;
      document.body.classList.toggle('is-light', state.isLight);
      localStorage.setItem('biogas-docs-theme', state.isLight ? 'light' : 'dark');
    });
  }

  async function loadMarkdown() {
    const container = $('#doc-content');
    if (!container) return;
    try {
      const res = await fetch(DOC_PATH, { cache: 'no-store' });
      const md = await res.text();
      marked.setOptions({
        mangle: false,
        headerIds: false,
        breaks: true,
        gfm: true,
      });
      const html = marked.parse(md);
      container.innerHTML = html;
      // Code highlighting
      $all('pre code', container).forEach((block) => hljs.highlightElement(block));
      enhanceHeadings(container);
      buildTOC();
      buildSearchIndex(container);
      AOS.init({ once: true, duration: 600, easing: 'ease-out' });
    } catch (e) {
      container.innerHTML = '<p class="text-rose-400">Failed to load documentation.</p>';
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  function enhanceHeadings(root) {
    const headings = $all('h1, h2, h3', root);
    headings.forEach((h) => {
      const id = slugify(h.textContent || '');
      if (!id) return;
      h.id = id;
      const anchor = document.createElement('a');
      anchor.href = `#${id}`;
      anchor.className = 'no-underline text-inherit';
      anchor.innerHTML = h.innerHTML;
      h.innerHTML = '';
      h.appendChild(anchor);
    });
  }

  function buildTOC() {
    const tocRoot = $('#toc-content');
    if (!tocRoot) return;
    tocRoot.innerHTML = '';
    const fragment = document.createDocumentFragment();

    const headings = $all('#doc-content h1, #doc-content h2, #doc-content h3');
    const items = headings.map((h) => ({ level: parseInt(h.tagName.substring(1), 10), id: h.id, text: h.textContent || '' }));
    items.forEach((item) => {
      const a = document.createElement('a');
      a.href = `#${item.id}`;
      a.textContent = item.text;
      a.className = `toc-lvl-${item.level}`;
      fragment.appendChild(a);
    });
    tocRoot.appendChild(fragment);

    // Smooth scroll and highlight on click
    $all('a', tocRoot).forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const id = a.getAttribute('href')?.slice(1);
        const el = id ? document.getElementById(id) : null;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          flash(el);
          history.replaceState(null, '', `#${id}`);
        }
      });
    });

    // Mobile drawer clone
    initMobileTOC(tocRoot);
  }

  function flash(el) {
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 900);
  }

  function initMobileTOC(sourceNav) {
    const trigger = $('#toc-toggle');
    if (!trigger) return;
    let panel;
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm p-4';
        panel.innerHTML = `
          <div class="mx-auto max-w-md rounded-xl border border-white/10 bg-slate-900 p-4">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-sm font-semibold text-slate-300">On this page</h3>
              <button id="toc-close" class="rounded-md p-2 hover:bg-white/5">✕</button>
            </div>
            <nav class="toc-mobile space-y-1 text-sm"></nav>
          </div>
        `;
        document.body.appendChild(panel);
        const mobileNav = $('.toc-mobile', panel);
        mobileNav?.appendChild(sourceNav.cloneNode(true));
        panel.addEventListener('click', (evt) => {
          if (evt.target === panel) closePanel();
        });
        $('#toc-close', panel)?.addEventListener('click', closePanel);
        $all('a', mobileNav).forEach((a) => a.addEventListener('click', closePanel));
      } else {
        panel.classList.toggle('hidden');
      }

      function closePanel() { panel?.classList.add('hidden'); }
    });
  }

  function buildSearchIndex(root) {
    const blocks = $all('h1, h2, h3, p, li', root);
    state.searchIndex = blocks.map((el) => ({
      id: el.id || (el.closest('h1, h2, h3')?.id ?? ''),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      tag: el.tagName.toLowerCase(),
    })).filter((x) => x.text.length > 0);

    const input = $('#search-input');
    const results = $('#search-results');
    if (!input || !results) return;

    input.addEventListener('focus', () => { results.classList.remove('hidden'); });
    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
    });

    const onInput = throttle(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) { results.innerHTML = ''; return; }
      const hits = rankMatches(q, state.searchIndex).slice(0, 12);
      renderSearchResults(hits, results, q);
    }, 120);
    input.addEventListener('input', onInput);
  }

  function rankMatches(query, items) {
    const terms = query.split(/\s+/).filter(Boolean);
    return items
      .map((item) => {
        let score = 0;
        for (const t of terms) {
          if (!t) continue;
          const idx = item.text.toLowerCase().indexOf(t);
          if (idx >= 0) score += (item.tag.startsWith('h') ? 4 : 1) + Math.max(0, 10 - idx / 40);
        }
        return { item, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }

  function renderSearchResults(items, container, query) {
    container.innerHTML = '';
    const q = query.toLowerCase();
    items.forEach(({ id, text }) => {
      const snippet = makeSnippet(text, q, 140);
      const a = document.createElement('a');
      a.href = id ? `#${id}` : '#';
      a.className = 'search-item';
      a.innerHTML = `
        <div class="search-title">${escapeHtml(text.slice(0, 80))}${text.length > 80 ? '…' : ''}</div>
        <div class="search-snippet">${snippet}</div>
      `;
      a.addEventListener('click', (e) => {
        if (!id) return;
        const el = document.getElementById(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          flash(el);
          history.replaceState(null, '', `#${id}`);
        }
      });
      container.appendChild(a);
    });
  }

  function makeSnippet(text, query, size) {
    const i = text.toLowerCase().indexOf(query);
    const start = Math.max(0, i - Math.floor(size / 2));
    const end = Math.min(text.length, start + size);
    const chunk = text.slice(start, end);
    const safe = escapeHtml(chunk);
    return safe.replace(new RegExp(escapeRegExp(query), 'ig'), (m) => `<mark class="bg-cyan-400/30 text-inherit">${escapeHtml(m)}</mark>`);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function initScrollProgress() {
    const bar = $('#scroll-progress');
    if (!bar) return;
    const onScroll = throttle(() => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - doc.clientHeight;
      const pct = total > 0 ? (window.scrollY / total) * 100 : 0;
      bar.style.width = `${pct}%`;
    }, 50);
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateYear();
    initTheme();
    initScrollProgress();
    loadMarkdown();
  });
})();


