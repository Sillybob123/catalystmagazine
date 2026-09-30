/* ============================================================
   Seasonal edition pages (edition-*.html). See css/edition.css.

   body data attributes:
     data-edition   the edition's name in the Story Tracker, e.g. "Winter 2026"
     data-weather   "snow" or "petals" (fall can add falling leaves)

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
     Optional looping backdrop video: <video class="wx-loop"
     data-src-wide="…" data-src-tall="…"> inside .wx-backdrop. The still
     stays until the video is actually playing, then it fades in. Loaded
     after the page, played only on screen, skipped on data saver.
     ------------------------------------------------------------ */
  (function () {
    var v = document.querySelector('.wx-backdrop video.wx-loop');
    var conn = navigator.connection || {};
    if (!v || REDUCED || conn.saveData || /(^|-)2g/.test(conn.effectiveType || '')) return;
    function start() {
      var tall = window.matchMedia('(max-width: 899px)').matches;
      v.src = tall ? v.dataset.srcTall : v.dataset.srcWide;
      v.addEventListener('playing', function () { v.classList.add('is-playing'); }, { once: true });
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) v.play().catch(function () {}); else v.pause();
      }).observe(v.parentElement);
    }
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
  })();

  /* ------------------------------------------------------------
     Weather. data-weather="snow": real six-armed snow crystals at
     three depths. data-weather="petals": tumbling cherry petals. Far
     flakes are small and soft, near ones larger, sharper and slowly
     turning. They drift with the "wind" of your cursor and lift a
     little as you scroll. Pre-rendered sprites keep it cheap.
     Snow is white over the (dark) hero and a cool steel tint once it
     falls past the hero onto the light page below.
     ------------------------------------------------------------ */
  var Weather = (function () {
    var canvas = document.querySelector('.wx-weather');
    var KIND = body.dataset.weather;
    if (!canvas || (KIND !== 'snow' && KIND !== 'petals')) return { frame: function () {} };
    var PETALS = KIND === 'petals';
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0, flakes = [];
    var small = window.innerWidth < 700;
    var COUNT = PETALS ? (small ? 14 : 30) : (small ? 21 : 44);   // light, unhurried

    // --- sprites -------------------------------------------------
    function crystal(size, seed, stroke, glow) {
      // a dendrite: six arms, each with tapering side branches and small tip forks
      var c = document.createElement('canvas'); c.width = c.height = size;
      var g = c.getContext('2d'), R = size * 0.44, rnd = mulberry(seed);
      g.translate(size / 2, size / 2);
      g.strokeStyle = stroke; g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = glow; g.shadowBlur = size * 0.035;
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
    function soft(size, core, halo) {
      var c = document.createElement('canvas'); c.width = c.height = size;
      var g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gr.addColorStop(0, core); gr.addColorStop(0.45, halo + '0.55)'); gr.addColorStop(1, halo + '0)');
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
      return c;
    }
    function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    // a cherry petal: rounded, with the notch at its tip, pale at the
    // edge and a deeper pink toward the base
    function petal(size, seed) {
      var c = document.createElement('canvas'); c.width = c.height = size;
      var g = c.getContext('2d'), rnd = mulberry(seed), w = size * (0.3 + rnd() * 0.06), h = size * 0.44;
      g.translate(size / 2, size / 2);
      g.beginPath();
      g.moveTo(0, h);                                          // base
      g.bezierCurveTo(-w * 1.3, h * 0.35, -w * 1.15, -h * 0.9, -w * 0.28, -h);
      g.lineTo(0, -h * (0.78 + rnd() * 0.08));                 // the notch
      g.lineTo(w * 0.28, -h);
      g.bezierCurveTo(w * 1.15, -h * 0.9, w * 1.3, h * 0.35, 0, h);
      g.closePath();
      var gr = g.createLinearGradient(0, h, 0, -h);
      gr.addColorStop(0, 'rgba(226,122,152,0.95)');
      gr.addColorStop(0.35, 'rgba(246,184,203,0.95)');
      gr.addColorStop(1, 'rgba(255,236,242,0.95)');
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(214,120,150,0.35)'; g.lineWidth = size * 0.012;
      g.beginPath(); g.moveTo(0, h * 0.9); g.quadraticCurveTo(w * 0.1, 0, 0, -h * 0.7); g.stroke();   // a faint vein
      return c;
    }
    var SEEDS = [1, 2, 3, 4, 5, 6];
    var CRYSTALS = PETALS ? [] : SEEDS.map(function (s) { return crystal(128, s * 7919, 'rgba(255,255,255,0.96)', 'rgba(190,220,245,0.85)'); });
    var CRYSTALS_INK = PETALS ? [] : SEEDS.map(function (s) { return crystal(128, s * 7919, 'rgba(112,143,170,0.95)', 'rgba(255,255,255,0.9)'); });
    var SOFT = PETALS ? null : soft(64, 'rgba(255,255,255,0.95)', 'rgba(240,247,255,');
    var SOFT_INK = PETALS ? null : soft(64, 'rgba(128,158,184,0.9)', 'rgba(150,178,202,');
    var heroEl = document.querySelector('.wx-hero');
    var PETAL_SPRITES = PETALS ? [1, 2, 3, 4].map(function (s) { return petal(96, s * 104729); }) : [];

    // --- flakes ----------------------------------------------------
    // depth z: 0 far … 1 near. Most snow is soft and small; only the
    // nearest ~16% of flakes are close enough to show their crystal shape.
    function make(top) {
      if (PETALS) {
        // petals tumble: a slow spin plus a flip (scaleX) as they turn over
        var zp = Math.random();
        return {
          x: Math.random() * W, y: top ? -40 : Math.random() * H, z: zp, petal: true,
          size: (small ? 7 : 8) + zp * (small ? 8 : 11),
          sprite: PETAL_SPRITES[(Math.random() * PETAL_SPRITES.length) | 0],
          vy: 0.35 + zp * 0.75, ph: Math.random() * 6.28, sway: 0.5 + Math.random() * 0.7,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.03,
          flip: Math.random() * 6.28, vf: 0.015 + Math.random() * 0.03,
          a: 0.55 + zp * 0.4
        };
      }
      var z = Math.pow(Math.random(), 1.35);
      var near = z > 0.82;
      return {
        x: Math.random() * W, y: top ? -40 : Math.random() * H, z: z,
        size: near ? (small ? 9 : 10) + (z - 0.82) / 0.18 * (small ? 6 : 8) : 2 + z * 7,
        ci: near ? (Math.random() * SEEDS.length) | 0 : -1,
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
    // Mobile browsers resize the fixed canvas when the address bar shows
    // or hides, sometimes without a window resize event; a stale buffer
    // then gets stretched and the flakes look squashed. Track the box.
    window.addEventListener('resize', resize);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    resize();
    var t = 0;
    function frame(scrollDelta) {
      t += 1;
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var wind = P.vx * 0.8;
      var heroBottom = heroEl ? heroEl.getBoundingClientRect().bottom : 1e9;
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        if (!REDUCED) {
          f.y += f.vy - scrollDelta * (0.04 + f.z * 0.14);
          f.x += Math.sin(t * 0.007 + f.ph) * f.sway * (0.4 + f.z) + wind * (0.25 + f.z) + (f.petal ? 0.18 + f.z * 0.25 : 0);
          f.rot += f.vr;
          if (f.petal) f.flip += f.vf;
          if (f.y > H + 40) { flakes[i] = make(true); continue; }
          if (f.y < -50) f.y = H + 30;
          if (f.x > W + 30) f.x = -30; else if (f.x < -30) f.x = W + 30;
        }
        var s = f.size;
        ctx.globalAlpha = f.a;
        if (f.petal) {
          ctx.setTransform(dpr, 0, 0, dpr, f.x * dpr, f.y * dpr);
          ctx.rotate(f.rot);
          ctx.scale(Math.max(0.15, Math.abs(Math.cos(f.flip))), 1);
          ctx.drawImage(f.sprite, -s / 2, -s / 2, s, s);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else if (f.ci < 0) {
          ctx.drawImage(f.y > heroBottom ? SOFT_INK : SOFT, f.x - s / 2, f.y - s / 2, s, s);
        } else {
          ctx.setTransform(dpr, 0, 0, dpr, f.x * dpr, f.y * dpr);
          ctx.rotate(f.rot);
          ctx.drawImage((f.y > heroBottom ? CRYSTALS_INK : CRYSTALS)[f.ci], -s / 2, -s / 2, s, s);
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
