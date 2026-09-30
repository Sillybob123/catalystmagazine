/* ============================================================
   Article, read from an edition (/article/<slug>?edition=<id>).
   Edition pages link their stories with ?edition=; this dresses
   the article in that edition: its colours, an edition folio in
   the hero, an "in this edition" ribbon, and a way on to the
   previous / next story and back to the edition. Without the
   parameter the article page is untouched. Data comes from
   /edition-art/editions.json (written by the edition build).
   Styles: css/article-edition.css.
   ============================================================ */
(function () {
  'use strict';
  var id = new URLSearchParams(location.search).get('edition');
  if (!id || !/^[a-z0-9-]+$/.test(id)) return;

  var ready = fetch('/edition-art/editions.json', { cache: 'force-cache' })
    .then(function (r) { if (!r.ok) throw new Error('editions ' + r.status); return r.json(); })
    .then(function (all) { return all[id] || null; })
    .catch(function (e) { console.warn('[edition] could not load editions.json', e); return null; });

  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';

  function cover(ed, cls) {
    return '<span class="ed-cover ' + (cls || '') + (ed.night ? ' is-night' : '') + '" aria-hidden="true">' +
      '<img class="ed-cover__art" src="' + esc(ed.cover) + '" alt="" loading="lazy" decoding="async">' +
      '<span class="ed-cover__mast"><img src="/edition-art/winter/masthead.webp?v=1" alt=""><span class="ed-cover__date"><span>' + esc(ed.label) + '</span><span>No. ' + esc(ed.no) + '</span></span></span>' +
      '<span class="ed-cover__title">' + esc(ed.title) + '</span></span>';
  }

  function storyCard(s, ed, dir) {
    return '<a class="ed-next__card" href="/article/' + encodeURIComponent(s.slug) + '?edition=' + encodeURIComponent(id) + '">' +
      '<span class="ed-next__img"><img src="' + esc(s.img) + '" alt="" loading="lazy" decoding="async"></span>' +
      '<span class="ed-next__dir">' + (dir < 0 ? BACK + 'Previous story' : 'Next story' + ARROW) + '</span>' +
      '<span class="ed-next__kicker">' + esc(s.kicker) + '</span>' +
      '<span class="ed-next__title">' + esc(s.title) + '</span>' +
      '<span class="ed-next__by">By ' + esc(s.author) + '</span></a>';
  }

  function decorate(ed) {
    var root = document.getElementById('article-detail');
    var hero = root && root.querySelector('.article-hero');
    if (!hero || hero.dataset.edition || document.body.classList.contains('is-book-review')) return;
    hero.dataset.edition = id;

    // which story is this? the slug in the path, else the headline
    var slug = (location.pathname.match(/\/article\/([^/?#]+)/) || [])[1];
    var h1 = hero.querySelector('.article-hero__title');
    var i = -1;
    ed.stories.forEach(function (s, k) {
      if ((slug && decodeURIComponent(slug) === s.slug) || (h1 && norm(h1.textContent) === norm(s.title))) i = k;
    });
    var story = ed.stories[i] || null;

    var b = document.body;
    b.classList.add('in-edition');
    b.style.setProperty('--ed-acc', ed.acc);
    b.style.setProperty('--ed-paper', ed.paper);
    b.style.setProperty('--ed-deep', ed.deep);

    var back = document.querySelector('.article-page .back-link');
    if (back) {
      back.href = ed.page;
      back.lastChild.textContent = ' The ' + ed.label + ' edition';
    }

    // the edition's own art for the story, where it has some
    if (story && story.art) {
      var img = hero.querySelector('.article-hero__image');
      if (img) img.style.backgroundImage = "url('" + story.art + "')";
    }

    var surface = hero.querySelector('.article-hero__surface');
    if (surface) {
      surface.insertAdjacentHTML('afterbegin',
        '<p class="ed-folio"><span>The Catalyst</span><span>The ' + esc(ed.label) + ' Edition &middot; No. ' + esc(ed.no) + '</span></p>');
    }

    var n = ed.stories.length;
    hero.insertAdjacentHTML('afterend',
      '<a class="ed-ribbon" href="' + esc(ed.page) + '">' +
        '<span class="ed-ribbon__in">' + cover(ed, 'ed-cover--sm') +
          '<span class="ed-ribbon__text"><span class="ed-ribbon__kicker">From the ' + esc(ed.label) + ' edition</span>' +
          '<span class="ed-ribbon__title">' + esc(ed.title) + '</span></span>' +
          '<span class="ed-ribbon__meta">' + (story ? 'Story ' + (i + 1) + ' of ' + n : n + ' stories') +
          '<span class="ed-ribbon__go">Open the edition' + ARROW + '</span></span>' +
        '</span></a>');

    var prev = i > 0 ? ed.stories[i - 1] : null, next = i >= 0 && i < n - 1 ? ed.stories[i + 1] : null;
    var html =
      '<section class="ed-next" aria-labelledby="ed-next-title">' +
        '<div class="ed-next__head"><span>The ' + esc(ed.label) + ' Edition</span><span>No. ' + esc(ed.no) + '</span></div>' +
        '<h2 class="ed-next__h" id="ed-next-title">Continue reading <em>this edition.</em></h2>' +
        ((prev || next) ? '<div class="ed-next__grid">' + (prev ? storyCard(prev, ed, -1) : '<span></span>') + (next ? storyCard(next, ed, 1) : '<span></span>') + '</div>' : '') +
        '<a class="ed-next__edition" href="' + esc(ed.page) + '" style="--ed-banner:url(\'' + esc(ed.banner) + '\')">' +
          cover(ed, 'ed-cover--md') +
          '<span class="ed-next__ed-text"><span class="ed-next__ed-kicker">' + (ed.current ? 'The current edition' : 'The ' + esc(ed.label) + ' edition') + '</span>' +
          '<span class="ed-next__ed-title">' + esc(ed.title) + '</span>' +
          '<span class="ed-next__ed-meta">' + n + ' stories &middot; ' + esc(ed.span) + '</span>' +
          '<span class="ed-next__ed-btn">Open the edition' + ARROW + '</span></span></a>' +
        '<a class="ed-next__all" href="/editions">Every edition of The Catalyst' + ARROW + '</a>' +
      '</section>';
    var share = root.querySelector('.article-share');
    if (share) share.insertAdjacentHTML('afterend', html);
    else root.insertAdjacentHTML('beforeend', html);
  }

  function watch(ed) {
    if (!ed) return;
    var root = document.getElementById('article-detail');
    if (!root) return;
    decorate(ed);
    // the article renders after its body loads (and may render twice)
    new MutationObserver(function () { decorate(ed); }).observe(root, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { ready.then(watch); });
  else ready.then(watch);
})();
