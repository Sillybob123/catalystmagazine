/* ============================================================
   The Articles (/articles). Every published story (book reviews
   have their own page), from the public Firestore query; editions
   from /edition-art/editions.json. Default view: the latest, then
   each edition's shelf. Any search / filter / order switches to one
   grid of results. The filters live in the URL (?category=, ?edition=,
   ?topic=, ?q=, ?sort=), so a filtered view can be linked to.
   ============================================================ */
(function () {
  'use strict';

  var FALLBACK_IMG = '/NewsletterHeader1.png';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TYPES = { feature: 'Feature', profile: 'Profile', interview: 'Interview', editorial: 'Editorial', 'op-ed': 'Op-Ed', science: 'Science', news: 'News' };
  var SHELF = 6;          // stories shown per edition before "show all"
  var PAGE = 12;          // results per page in the filtered view

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugify(t) {
    return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[‘’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function typeLabel(c) { return TYPES[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' ') : 'Story'); }
  function typeGroup(c) { return c === 'op-ed' ? 'editorial' : c; }

  // responsive, retina-sharp images (same rules as the homepage / js/main.js)
  function sized(src, w) {
    if (!src || src === FALLBACK_IMG || !/^https?:\/\//i.test(src)) return src;
    try {
      var url = new URL(src);
      if (url.hostname.indexOf('static.wixstatic.com') !== -1) {
        var parts = url.pathname.split('/').filter(Boolean), file = parts[parts.length - 1];
        if (parts.indexOf('v1') !== -1) return src.replace(/q_\d+/g, 'q_85').replace(/w_\d+/g, 'w_' + w);
        return src + '/v1/fill/w_' + w + ',h_' + Math.round(w * 0.66) + ',al_c,q_85,enc_auto/' + file;
      }
      var prot = src.replace(/%2F/gi, 'ENCSLASH'), dec;
      try { dec = decodeURIComponent(prot); } catch (e) { dec = prot; }
      dec = dec.replace(/ENCSLASH/g, '%2F');
      return 'https://wsrv.nl/?' + new URLSearchParams({ url: dec, w: w, q: 85, output: 'webp', fit: 'cover', we: '' });
    } catch (e) { return src; }
  }
  function fig(s, widths, sizes, eager) {
    var srcset = widths.map(function (w) { return esc(sized(s.img, w)) + ' ' + w + 'w'; }).join(', ');
    return '<div class="ar-fig"><img src="' + esc(sized(s.img, widths[0])) + '" srcset="' + srcset + '" sizes="' + sizes + '" alt="" ' +
      (eager ? 'fetchpriority="high" ' : 'loading="lazy" ') + 'decoding="async" onload="this.classList.add(\'ok\')" ' +
      'onerror="this.onerror=null;this.srcset=\'\';this.src=\'' + FALLBACK_IMG + '\';this.classList.add(\'ok\')"></div>';
  }

  /* ---------------- data ---------------- */
  function toStory(doc) {
    var f = doc.fields || {};
    var str = function (k) { return (f[k] && f[k].stringValue) || ''; };
    var title = str('title');
    if (!title) return null;
    var cat = (str('category') || 'feature').toLowerCase().replace(/\s+/g, '-');
    if (cat === 'book-review' || cat === 'bookreview') return null;
    var raw = (f.publishedAt && (f.publishedAt.timestampValue || f.publishedAt.stringValue)) ||
              (f.createdAt && (f.createdAt.timestampValue || f.createdAt.stringValue)) || '';
    var dt = raw ? new Date(raw) : null;
    var img = str('coverImage');
    if (img && !/^https?:\/\//i.test(img)) img = location.origin + '/' + img.replace(/^\/+/, '');
    var slug = str('slug') || slugify(title);
    return {
      title: title, slug: slug, cat: cat,
      author: str('authorName') || str('author') || 'The Catalyst',
      deck: str('dek') || str('deck') || str('excerpt'),
      tags: ((f.tags && f.tags.arrayValue && f.tags.arrayValue.values) || []).map(function (v) { return String(v.stringValue || '').toLowerCase(); }).filter(Boolean),
      img: img || FALLBACK_IMG,
      t: dt && !isNaN(dt) ? dt.getTime() : 0,
      date: dt && !isNaN(dt) ? dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''
    };
  }
  function loadStories() {
    var KEY = 'catalyst_articles_page_v2';
    try { var c = sessionStorage.getItem(KEY); if (c) return Promise.resolve(JSON.parse(c)); } catch (e) {}
    var fields = ['title', 'authorName', 'author', 'publishedAt', 'createdAt', 'coverImage', 'deck', 'dek', 'excerpt', 'category', 'tags', 'slug'];
    return fetch('https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'stories' }],
        where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
        orderBy: [{ field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' }],
        select: { fields: fields.map(function (k) { return { fieldPath: k }; }) },
        limit: 500
      } })
    }).then(function (r) { if (!r.ok) throw new Error('Firestore ' + r.status); return r.json(); })
      .then(function (rows) {
        var seen = {}, list = [];
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
          var s = r.document && toStory(r.document);
          if (!s || seen[s.slug]) return;            // the same story saved twice: keep the newest
          seen[s.slug] = 1; list.push(s);
        });
        try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
        return list;
      });
  }
  var editionsReady = fetch('/edition-art/editions.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });

  /* ---------------- state ---------------- */
  var ALL = [], EDS = {}, EDLIST = [], bySlug = {};
  var state = { type: 'all', edition: '', topic: '', q: '', sort: 'new' };
  var shown = PAGE;

  function edFor(s) {
    if (bySlug[s.slug]) return bySlug[s.slug];
    for (var i = 0; i < EDLIST.length; i++) {
      var e = EDLIST[i];
      if (s.t && s.t >= Date.parse(e.start) && s.t < Date.parse(e.end)) return e;
    }
    return null;
  }
  function href(s) { return '/article/' + encodeURIComponent(s.slug) + (s.ed ? '?edition=' + encodeURIComponent(s.ed.id) : ''); }

  function readURL() {
    var p = new URLSearchParams(location.search);
    var c = (p.get('category') || '').toLowerCase();
    state.type = ({ feature: 1, profile: 1, interview: 1, editorial: 1 })[c] ? c : 'all';
    state.edition = p.get('edition') || '';
    state.topic = (p.get('topic') || '').toLowerCase();
    state.q = p.get('q') || '';
    state.sort = p.get('sort') === 'old' ? 'old' : 'new';
  }
  function writeURL() {
    var p = new URLSearchParams();
    if (state.type !== 'all') p.set('category', state.type);
    if (state.edition) p.set('edition', state.edition);
    if (state.topic) p.set('topic', state.topic);
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.sort === 'old') p.set('sort', 'old');
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  function filtering() { return state.type !== 'all' || state.edition || state.topic || state.q.trim() || state.sort === 'old'; }

  function matches(s) {
    if (state.type !== 'all' && typeGroup(s.cat) !== state.type) return false;
    if (state.edition && (!s.ed || s.ed.id !== state.edition)) return false;
    if (state.topic && s.tags.indexOf(state.topic) === -1) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = (s.title + ' ' + s.author + ' ' + s.deck + ' ' + s.tags.join(' ') + ' ' + typeLabel(s.cat) + ' ' + (s.ed ? s.ed.label + ' ' + s.ed.title : '')).toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  /* ---------------- rendering ---------------- */
  function card(s, i) {
    var acc = s.ed ? ' style="--acc:' + esc(s.ed.acc) + ';--d:' + ((i % 3) * 0.06).toFixed(2) + 's"' : ' style="--d:' + ((i % 3) * 0.06).toFixed(2) + 's"';
    return '<article class="ar-card" data-reveal' + acc + '><a href="' + esc(href(s)) + '">' +
      fig(s, [480, 720, 1080], '(max-width: 560px) 92vw, (max-width: 960px) 46vw, 30vw') +
      '<div class="ar-txt">' +
        '<p class="ar-meta"><span class="t">' + esc(typeLabel(s.cat)) + '</span>' + (s.ed ? '<span>' + esc(s.ed.label) + '</span>' : '') + '</p>' +
        '<h3>' + esc(s.title) + '</h3>' +
        (s.deck ? '<p class="ar-dek">' + esc(s.deck) + '</p>' : '') +
        '<p class="ar-by">' + esc(s.author) + (s.date ? ' <span>&middot; ' + esc(s.date) + '</span>' : '') + '</p>' +
      '</div>' +
    '</a></article>';
  }

  function renderLatest(list) {
    var lead = list[0], side = list.slice(1, 3);
    if (!lead) { $('ar-latest').innerHTML = ''; return; }
    var acc = lead.ed ? ' style="--acc:' + esc(lead.ed.acc) + '"' : '';
    $('ar-latest').innerHTML =
      '<article class="ar-lead"' + acc + '><a href="' + esc(href(lead)) + '">' +
        fig(lead, [800, 1200, 1600], '(max-width: 960px) 92vw, 56vw', true) +
        '<div class="ar-txt">' +
          '<p class="ar-meta"><span class="t">' + esc(typeLabel(lead.cat)) + '</span>' + (lead.ed ? '<span>' + esc(lead.ed.label) + ' edition</span>' : '') + '</p>' +
          '<h3>' + esc(lead.title) + '</h3>' +
          (lead.deck ? '<p class="ar-dek">' + esc(lead.deck) + '</p>' : '') +
          '<p class="ar-by">' + esc(lead.author) + (lead.date ? ' <span>&middot; ' + esc(lead.date) + '</span>' : '') + '</p>' +
        '</div>' +
      '</a></article>' +
      '<div class="ar-side">' + side.map(function (s, i) { return card(s, i + 1); }).join('') + '</div>';
  }

  function coverHTML(e) {
    return '<span class="ea-cover' + (e.night ? ' is-night' : '') + '" aria-hidden="true">' +
      '<img class="art" src="' + esc(e.cover) + '" alt="" width="700" height="937" loading="lazy" decoding="async">' +
      '<span class="ea-mast"><img src="/edition-art/winter/masthead.webp?v=1" alt="" width="1400" height="234"><span class="ea-dateline"><span>' + esc(e.label) + '</span><span>No. ' + esc(e.no) + '</span></span></span></span>';
  }

  function renderEditions(list, skip) {
    var groups = EDLIST.slice().reverse().map(function (e) {
      return { ed: e, items: list.filter(function (s) { return s.ed && s.ed.id === e.id && !skip[s.slug]; }) };
    }).filter(function (g) { return g.items.length; });
    var loose = list.filter(function (s) { return !s.ed && !skip[s.slug]; });
    var html = groups.map(function (g) {
      var e = g.ed, t = e.title.replace(/ in the Capital$/, ''), more = g.items.length - SHELF;
      return '<section class="ar-ed" id="ed-' + esc(e.id) + '" style="--acc:' + esc(e.acc) + '" aria-labelledby="ed-' + esc(e.id) + '-t">' +
        '<header class="ar-ed-head" data-reveal>' +
          '<a class="ar-ed-cover" href="' + esc(e.page) + '" tabindex="-1" aria-hidden="true">' + coverHTML(e) + '</a>' +
          '<div><p class="ar-ed-kicker">No. ' + esc(e.no) + ' &middot; ' + esc(e.label) + (e.current ? ' &middot; The current edition' : '') + '</p>' +
            '<h2 class="ar-ed-title" id="ed-' + esc(e.id) + '-t">' + esc(t) + ' <em>in the Capital.</em></h2>' +
            '<p class="ar-ed-span">' + e.count + ' stories &middot; ' + esc(e.span) + '</p></div>' +
          '<a class="ar-ed-open" href="' + esc(e.page) + '">Open the edition <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
        '</header>' +
        '<div class="ar-grid">' + g.items.map(function (s, i) { return i < SHELF ? card(s, i) : ''; }).join('') + '</div>' +
        (more > 0 ? '<button type="button" class="ar-more" data-expand="' + esc(e.id) + '">Show ' + more + ' more from ' + esc(e.label) + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' : '') +
      '</section>';
    }).join('');
    if (loose.length) {
      html += '<section class="ar-ed" aria-labelledby="ed-more-t"><header class="ar-ed-head" data-reveal><div></div><div><h2 class="ar-ed-title" id="ed-more-t">More <em>stories.</em></h2></div><span></span></header>' +
        '<div class="ar-grid">' + loose.map(card).join('') + '</div></section>';
    }
    $('ar-editions').innerHTML = html;
  }

  function renderResults(list) {
    var grid = $('ar-results-grid'), page = list.slice(0, shown);
    grid.innerHTML = page.map(card).join('');
    $('ar-empty').hidden = list.length > 0;
    $('ar-more-results').hidden = list.length <= shown;
  }

  function render() {
    var list = ALL.filter(matches);
    if (state.sort === 'old') list = list.slice().reverse();
    var on = filtering();
    $('ar-browse').hidden = on;
    $('ar-results').hidden = !on;
    var count = $('ar-count'), status = $('ar-status');
    if (on) {
      renderResults(list);
      var bits = [];
      if (state.type !== 'all') bits.push(typeLabel(state.type).toLowerCase() + 's');
      if (state.edition && EDS[state.edition]) bits.push('the ' + EDS[state.edition].label + ' edition');
      if (state.topic) bits.push('“' + state.topic + '”');
      if (state.q.trim()) bits.push('“' + state.q.trim() + '”');
      count.textContent = list.length + (list.length === 1 ? ' story' : ' stories') + (bits.length ? ' · ' + bits.join(', ') : '');
      if (!status.querySelector('button')) status.insertAdjacentHTML('beforeend', '<button type="button" data-clear>Clear filters</button>');
    } else {
      renderLatest(list);
      var skip = {};
      list.slice(0, 3).forEach(function (s) { skip[s.slug] = 1; });
      renderEditions(list, skip);
      count.textContent = list.length + ' stories · ' + EDLIST.length + ' editions';
      var b = status.querySelector('button'); if (b) b.remove();
    }
    syncControls();
    observe();
  }

  function syncControls() {
    document.querySelectorAll('.ar-type').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.type === state.type)); });
    document.querySelectorAll('.ar-topic').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.topic === state.topic)); });
    $('ar-edition').value = state.edition;
    $('ar-sort').value = state.sort;
    if ($('ar-q').value !== state.q) $('ar-q').value = state.q;
    $('ar-q').parentNode.classList.toggle('has-q', !!state.q);
  }

  function renderTopics() {
    var counts = {};
    ALL.forEach(function (s) { s.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var top = Object.keys(counts).filter(function (t) { return counts[t] > 1; })
      .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); }).slice(0, 12);
    if (state.topic && top.indexOf(state.topic) === -1) top.push(state.topic);
    $('ar-topics').innerHTML = top.map(function (t) {
      return '<button type="button" class="ar-topic" data-topic="' + esc(t) + '" aria-pressed="false">' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</button>';
    }).join('');
    $('ar-topics').hidden = !top.length;
  }
  function renderEditionOptions() {
    $('ar-edition').innerHTML = '<option value="">All editions</option>' + EDLIST.slice().reverse().map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.label) + (e.current ? ' (current)' : '') + '</option>';
    }).join('');
  }

  /* reveal on scroll */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -6% 0px' }) : null;
  function observe() {
    document.querySelectorAll('[data-reveal]:not(.in)').forEach(function (el) { if (io && !REDUCED) io.observe(el); else el.classList.add('in'); });
  }

  /* ---------------- events ---------------- */
  function update(scroll) {
    shown = PAGE; writeURL(); render();
    if (scroll) {
      var bar = $('ar-bar'), y = bar.getBoundingClientRect().top + window.scrollY - 84;
      if (window.scrollY > y + 10) window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' });
    }
  }
  document.querySelector('.ar-types').addEventListener('click', function (e) {
    var b = e.target.closest('.ar-type'); if (!b) return;
    state.type = b.dataset.type; update(true);
  });
  $('ar-topics').addEventListener('click', function (e) {
    var b = e.target.closest('.ar-topic'); if (!b) return;
    state.topic = state.topic === b.dataset.topic ? '' : b.dataset.topic; update(true);
  });
  $('ar-edition').addEventListener('change', function () { state.edition = this.value; update(true); });
  $('ar-sort').addEventListener('change', function () { state.sort = this.value; update(true); });
  var qTimer = 0;
  $('ar-q').addEventListener('input', function () {
    var v = this.value; this.parentNode.classList.toggle('has-q', !!v);
    clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = v; update(false); }, 140);
  });
  $('ar-q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); var y = $('ar-bar').getBoundingClientRect().top + window.scrollY - 84; window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' }); }
    if (e.key === 'Escape') { this.value = ''; state.q = ''; update(false); }
  });
  $('ar-clear').addEventListener('click', function () { $('ar-q').value = ''; state.q = ''; update(false); $('ar-q').focus(); });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-clear]')) { state = { type: 'all', edition: '', topic: '', q: '', sort: 'new' }; update(true); return; }
    var ex = e.target.closest('[data-expand]');
    if (ex) {
      var id = ex.dataset.expand, grid = ex.previousElementSibling;
      var items = ALL.filter(function (s) { return s.ed && s.ed.id === id; }).slice(SHELF + 0);
      var have = {}; grid.querySelectorAll('a').forEach(function (a) { have[a.getAttribute('href')] = 1; });
      grid.insertAdjacentHTML('beforeend', items.filter(function (s) { return !have[href(s)]; }).map(card).join(''));
      ex.remove(); observe();
    }
  });
  $('ar-more-results').addEventListener('click', function () { shown += PAGE; render(); });
  // "/" jumps to search, as on most reading sites
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault(); $('ar-q').focus();
  });

  /* the hero drawing's calm loop: loaded after the page, played only on screen,
     skipped on data saver, slow connections and reduced motion */
  (function heroLoop() {
    var v = document.querySelector('.ar-loop');
    var still = document.getElementById('ar-hero-img');
    var conn = navigator.connection || {};
    if (!v || REDUCED || conn.saveData || /(^|-)2g/.test(conn.effectiveType || '')) return;
    var fig = v.parentNode;
    var src = (window.matchMedia('(max-width: 899px)').matches && v.dataset.srcSm) || v.dataset.src;
    var started = false;

    // Safari (every iOS browser included) can show an .mp4 through <img>: it
    // loops silently with no controls, no play button and no autoplay
    // permission to ask for, even in Low Power Mode.
    function asImage(fallback) {
      var img = new Image();
      img.className = 'ar-loop';
      img.alt = ''; img.setAttribute('aria-hidden', 'true'); img.decoding = 'async';
      img.onload = function () {
        fig.replaceChild(img, v);
        requestAnimationFrame(function () { requestAnimationFrame(function () { img.classList.add('is-playing'); }); });
      };
      img.onerror = fallback;
      img.src = src;
    }

    // Everyone else: a muted inline <video>, playing only while on screen.
    function asVideo() {
      v.muted = true; v.autoplay = true; v.preload = 'auto';
      v.addEventListener('playing', function () { v.classList.add('is-playing'); }, { once: true });
      v.src = src;
      var onScreen = true;
      function play() { if (onScreen && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; if (onScreen) play(); else v.pause(); }).observe(fig);
      } else play();
    }

    function start() {
      if (started) return; started = true;
      if (/Apple/.test(navigator.vendor || '')) asImage(asVideo); else asVideo();
    }
    // begin as soon as the drawing itself has loaded, not after every story image
    if (!still || still.complete) setTimeout(start, 0);
    else { still.addEventListener('load', start, { once: true }); still.addEventListener('error', start, { once: true }); }
  })();

  /* ---------------- start ---------------- */
  readURL(); syncControls(); observe();
  Promise.all([loadStories(), editionsReady]).then(function (r) {
    EDS = r[1] || {};
    EDLIST = Object.keys(EDS).map(function (id) { EDS[id].id = id; return EDS[id]; });
    EDLIST.forEach(function (e) { (e.stories || []).forEach(function (s) { bySlug[s.slug] = e; }); });
    ALL = r[0];
    ALL.forEach(function (s) { s.ed = edFor(s); });
    renderEditionOptions(); renderTopics();
    if (state.edition && !EDS[state.edition]) state.edition = '';
    render();
  }).catch(function (err) {
    console.warn('[articles] load failed', err);
    $('ar-count').textContent = 'The articles didn’t load. Please refresh the page.';
    $('ar-latest').innerHTML = '';
  });
})();
