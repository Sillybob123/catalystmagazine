/* ============================================================
   Seasonal edition pages (edition-*.html). See css/edition.css.

   body data attributes:
     data-edition   the edition's name in the Story Tracker, e.g. "Winter 2026"
     data-weather   "snow" (fall/spring can add their own particle)

   Stories: the cards written in #wx-stories are shown as-is. Any
   published story whose `edition` matches data-edition (set from the
   Story Tracker when it's published, see js/dashboard/publish-sync.js)
   and that isn't already a card is added after them automatically.
   ============================================================ */
(function () {
  'use strict';

  var body = document.body;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = window.matchMedia('(pointer: fine)').matches;
  var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  var hero = document.querySelector('.wx-hero');
  var heroCopy = document.querySelector('.wx-hero-copy');
  var cover = document.querySelector('.wx-cover');
  var backdrop = document.querySelector('.wx-backdrop');
  var crystal = document.querySelector('.wx-crystal');
  var cue = document.querySelector('.wx-scroll');

  requestAnimationFrame(function () { body.classList.add('is-ready'); });

  /* ------------------------------------------------------------
     Pointer + scroll state shared by the effects
     ------------------------------------------------------------ */
  var P = { x: 0, y: 0, sx: 0, sy: 0, vx: 0, lastX: null };   // pointer, -1..1
  if (FINE && !REDUCED) {
    window.addEventListener('pointermove', function (e) {
      var nx = e.clientX / window.innerWidth * 2 - 1;
      if (P.lastX !== null) P.vx = clamp(P.vx + (nx - P.lastX) * 6, -3, 3);
      P.lastX = nx;
      P.x = nx; P.y = e.clientY / window.innerHeight * 2 - 1;
    }, { passive: true });
  }

  /* ------------------------------------------------------------
     Weather: real six-armed snow crystals at three depths. Far
     flakes are small and soft, near ones larger, sharper and slowly
     turning. They drift with the "wind" of your cursor and lift a
     little as you scroll. Pre-rendered sprites keep it cheap.
     ------------------------------------------------------------ */
  var Weather = (function () {
    var canvas = document.querySelector('.wx-weather');
    if (!canvas || body.dataset.weather !== 'snow') return { frame: function () {} };
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0, flakes = [];
    var small = window.innerWidth < 700;
    var COUNT = small ? 26 : 55;                  // light, unhurried snowfall

    // --- sprites -------------------------------------------------
    function crystal(size, seed) {
      // a dendrite: six arms, each with tapering side branches and small tip forks
      var c = document.createElement('canvas'); c.width = c.height = size;
      var g = c.getContext('2d'), R = size * 0.44, rnd = mulberry(seed);
      g.translate(size / 2, size / 2);
      g.strokeStyle = 'rgba(255,255,255,0.96)'; g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = 'rgba(190,220,245,0.85)'; g.shadowBlur = size * 0.035;
      var branches = [0.28, 0.46, 0.64, 0.8].map(function (at, j) {
        return { at: at + (rnd() - 0.5) * 0.05, len: (0.3 - j * 0.06) * (0.8 + rnd() * 0.4) };
      });
      var angle = 0.9 + rnd() * 0.25;                       // branch angle from the arm
      for (var k = 0; k < 6; k++) {
        g.save(); g.rotate(k * Math.PI / 3);
        g.lineWidth = size * 0.022;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -R); g.stroke();
        g.lineWidth = size * 0.015;
        branches.forEach(function (b) {
          var y = -R * b.at, l = R * b.len;
          g.beginPath();
          g.moveTo(0, y); g.lineTo(-Math.sin(angle) * l, y - Math.cos(angle) * l);
          g.moveTo(0, y); g.lineTo(Math.sin(angle) * l, y - Math.cos(angle) * l);
          g.stroke();
        });
        g.lineWidth = size * 0.012;                             // tip fork
        g.beginPath(); g.moveTo(0, -R * 0.9); g.lineTo(-R * 0.07, -R); g.moveTo(0, -R * 0.9); g.lineTo(R * 0.07, -R); g.stroke();
        g.restore();
      }
      g.lineWidth = size * 0.014;                               // hexagonal centre plate
      g.beginPath();
      for (var h = 0; h <= 6; h++) { var ang = h * Math.PI / 3 + Math.PI / 6, rr = R * 0.14; g[h ? 'lineTo' : 'moveTo'](Math.cos(ang) * rr, Math.sin(ang) * rr); }
      g.stroke();
      return c;
    }
    function soft(size) {
      var c = document.createElement('canvas'); c.width = c.height = size;
      var g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.45, 'rgba(240,247,255,0.55)'); gr.addColorStop(1, 'rgba(240,247,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
      return c;
    }
    function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    var CRYSTALS = [1, 2, 3, 4, 5, 6].map(function (s) { return crystal(128, s * 7919); });
    var SOFT = soft(64);

    // --- flakes ----------------------------------------------------
    // depth z: 0 far … 1 near. Most snow is soft and small; only the
    // nearest ~16% of flakes are close enough to show their crystal shape.
    function make(top) {
      var z = Math.pow(Math.random(), 1.35);
      var near = z > 0.82;
      return {
        x: Math.random() * W, y: top ? -40 : Math.random() * H, z: z,
        size: near ? (small ? 12 : 15) + (z - 0.82) / 0.18 * (small ? 12 : 18) : 2 + z * 8,
        sprite: near ? CRYSTALS[(Math.random() * CRYSTALS.length) | 0] : SOFT,
        vy: 0.16 + z * 0.95, ph: Math.random() * 6.28, sway: 0.2 + Math.random() * 0.5,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.01,
        a: near ? 0.7 + (z - 0.82) : 0.22 + z * 0.65
      };
    }
    function resize() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      if (!flakes.length) for (var i = 0; i < COUNT; i++) flakes.push(make(false));
    }
    window.addEventListener('resize', resize);
    resize();
    var t = 0;
    function frame(scrollDelta) {
      t += 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var wind = P.vx * 0.8;
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        if (!REDUCED) {
          f.y += f.vy - scrollDelta * (0.04 + f.z * 0.14);
          f.x += Math.sin(t * 0.007 + f.ph) * f.sway * (0.4 + f.z) + wind * (0.25 + f.z);
          f.rot += f.vr;
          if (f.y > H + 40) { flakes[i] = make(true); continue; }
          if (f.y < -50) f.y = H + 30;
          if (f.x > W + 30) f.x = -30; else if (f.x < -30) f.x = W + 30;
        }
        var s = f.size;
        ctx.globalAlpha = f.a;
        if (f.sprite === SOFT) {
          ctx.drawImage(SOFT, f.x - s / 2, f.y - s / 2, s, s);
        } else {
          ctx.setTransform(dpr, 0, 0, dpr, f.x * dpr, f.y * dpr);
          ctx.rotate(f.rot);
          ctx.drawImage(f.sprite, -s / 2, -s / 2, s, s);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }
      ctx.globalAlpha = 1;
    }
    return { frame: frame };
  })();

  /* ------------------------------------------------------------
     Desktop: the magazine is sized to the hero text — its top lines
     up with the kicker and its bottom with the button row — and the
     grid centres it, so it sits squarely beside the headline.
     ------------------------------------------------------------ */
  var coverWrap = document.querySelector('.wx-cover-wrap');
  function alignCover() {
    if (!coverWrap || !heroCopy || !cover) return;
    if (window.innerWidth < 900) { cover.style.removeProperty('--wx-cover-w'); return; }
    var first = heroCopy.firstElementChild, last = heroCopy.lastElementChild;
    var h = (last.offsetTop + last.offsetHeight) - first.offsetTop;   // kicker top → buttons bottom
    var w = clamp(h * 3584 / 4800, 260, Math.min(400, coverWrap.clientWidth));
    cover.style.setProperty('--wx-cover-w', Math.round(w) + 'px');
  }
  alignCover();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(alignCover);
  window.addEventListener('resize', alignCover);
  window.addEventListener('load', alignCover);

  /* ------------------------------------------------------------
     Main loop
     ------------------------------------------------------------ */
  var lastY = window.scrollY, tilt = { x: 0, y: 0 }, running = true;
  document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) requestAnimationFrame(loop); });

  function loop() {
    if (!running) return;
    var y = window.scrollY, dy = y - lastY; lastY = y;
    P.vx *= 0.94;
    P.sx = lerp(P.sx, P.x, 0.06); P.sy = lerp(P.sy, P.y, 0.06);

    var hh = hero ? hero.offsetHeight : 1, hp = clamp(y / hh, 0, 1);
    if (!REDUCED && hp < 1) {
      if (cover) {
        tilt.y = lerp(tilt.y, P.sx * 7, 0.08); tilt.x = lerp(tilt.x, -P.sy * 5 + hp * 8, 0.08);
        cover.style.setProperty('--tilt-x', tilt.x.toFixed(2) + 'deg');
        cover.style.setProperty('--tilt-y', tilt.y.toFixed(2) + 'deg');
        cover.style.setProperty('--lift', (-y * 0.12).toFixed(1) + 'px');
        cover.style.setProperty('--sheen', (tilt.y * 4).toFixed(1) + 'deg');
      }
      if (backdrop) {
        // the city sits "behind" everything: it moves slowest
        backdrop.style.setProperty('--wx-py', (y * 0.3).toFixed(1) + 'px');
        backdrop.style.setProperty('--wx-px', (-P.sx * 16).toFixed(1) + 'px');
      }
      if (heroCopy) {
        heroCopy.style.transform = 'translate3d(0,' + (y * 0.1).toFixed(1) + 'px,0)';
        heroCopy.style.opacity = String(1 - clamp((hp - 0.25) / 0.45, 0, 1));
      }
      if (cue) cue.style.opacity = String(1 - clamp(y / 120, 0, 1));
    }
    if (crystal && !REDUCED) crystal.style.setProperty('--spin', (y * 0.05).toFixed(1) + 'deg');
    Weather.frame(REDUCED ? 0 : clamp(dy, -40, 40));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ------------------------------------------------------------
     Stories settle in like snow as they arrive
     ------------------------------------------------------------ */
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  function prime(list) {
    list.forEach(function (el, i) {
      if (el.dataset.primed) return;
      el.dataset.primed = '1';
      // alternate a slight tilt and stagger by position in the row
      el.style.setProperty('--r', ((i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.4)).toFixed(2) + 'deg');
      el.style.setProperty('--d', (i === 0 ? 0 : ((i - 1) % 3) * 0.12).toFixed(2) + 's');
      io.observe(el);
    });
  }
  var grid = document.getElementById('wx-stories');
  function stories() { return grid ? Array.prototype.slice.call(grid.querySelectorAll('.wx-story')) : []; }
  prime(stories());

  function updateCounts() {
    var n = stories().length;
    document.querySelectorAll('[data-wx-count]').forEach(function (el) {
      el.textContent = n + (n === 1 ? ' story' : ' stories');
    });
    // cover lines: the first three stories
    var lines = document.querySelector('.wx-cover-lines');
    if (lines) {
      lines.innerHTML = stories().slice(0, 3).map(function (s) {
        var k = s.querySelector('.wx-story-kicker'), h = s.querySelector('h3');
        return h ? '<p><span>' + esc(k ? k.textContent : 'Inside') + '</span>' + esc(h.textContent) + '</p>' : '';
      }).join('');
      lines.hidden = !lines.innerHTML;
    }
  }
  updateCounts();

  /* ------------------------------------------------------------
     Published stories in this edition (public Firestore REST)
     ------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var LABELS = { feature: 'Feature', profile: 'Profile', interview: 'Interview', editorial: 'Editorial', 'op-ed': 'Op-Ed', news: 'News', science: 'Science', 'book-review': 'Book Review' };
  function slugify(t) {
    return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[‘’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function sized(src, w) {
    if (!src || !/^https?:\/\//i.test(src)) return src;
    return 'https://wsrv.nl/?' + new URLSearchParams({ url: src, w: w, q: 82, output: 'webp', fit: 'cover', we: '' });
  }
  function card(a) {
    return '<article class="wx-story"><a href="' + esc(a.href) + '">' +
      '<div class="wx-story-img"><img src="' + esc(sized(a.img, 900)) + '" alt="" loading="lazy" decoding="async" width="900" height="600"></div>' +
      '<p class="wx-story-kicker">' + esc(a.label) + '</p><h3>' + esc(a.title) + '</h3>' +
      (a.dek ? '<p class="wx-story-dek">' + esc(a.dek) + '</p>' : '') +
      '<p class="wx-story-by">By ' + esc(a.author) + '</p></a></article>';
  }

  var EDITION = norm(body.dataset.edition);
  if (grid && EDITION) {
    var fields = ['title', 'authorName', 'author', 'publishedAt', 'createdAt', 'category', 'slug', 'edition', 'coverImage', 'dek', 'deck'];
    fetch('https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'stories' }],
        where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
        select: { fields: fields.map(function (f) { return { fieldPath: f }; }) },
        limit: 500
      } })
    }).then(function (r) { if (!r.ok) throw new Error('Firestore ' + r.status); return r.json(); })
      .then(function (rows) {
        var have = {};
        stories().forEach(function (s) { var l = s.querySelector('a'); if (l) have[l.getAttribute('href')] = 1; });
        var add = (Array.isArray(rows) ? rows : []).map(function (r) { return r.document; }).filter(Boolean).map(function (d) {
          var f = d.fields || {}, str = function (k) { return (f[k] && f[k].stringValue) || ''; };
          if (norm(str('edition')) !== EDITION || !str('title')) return null;
          var cat = (str('category') || 'feature').toLowerCase().replace(/\s+/g, '-');
          var href = (cat === 'book-review' ? '/book-review/' : '/article/') + encodeURIComponent(str('slug') || slugify(str('title')));
          if (have[href]) return null;
          var img = str('coverImage');
          if (img && !/^https?:\/\//i.test(img)) img = location.origin + '/' + img.replace(/^\/+/, '');
          var when = (f.publishedAt && (f.publishedAt.timestampValue || f.publishedAt.stringValue)) || '';
          return { href: href, title: str('title'), author: str('authorName') || str('author') || 'The Catalyst',
            label: LABELS[cat] || 'Story', dek: str('dek') || str('deck'), img: img || '/NewsletterHeader1.png', t: Date.parse(when) || 0 };
        }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
        if (!add.length) return;
        grid.insertAdjacentHTML('beforeend', add.map(card).join(''));
        prime(stories());
        updateCounts();
      })
      .catch(function (e) { console.warn('[edition] could not load edition stories', e); });
  }

  // "Subscribe" in the closing band opens the site's newsletter modal.
  document.querySelectorAll('[data-wx-subscribe]').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = document.getElementById('desktop-subscribe-btn') || document.getElementById('mobile-newsletter-btn');
      if (open) open.click(); else location.href = '/#newsletter-section';
    });
  });
})();
