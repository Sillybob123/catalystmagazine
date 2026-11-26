/* ============================================================
   Hero announcement mode: an edition's takeover of the homepage band.
   Entries: edition-art/hero-announcements.json. Guide: edition-art/HERO-ANNOUNCEMENT.md.

   For an upcoming edition the band wears the edition's season (its palettes, a seasonal version
   of the tree, falling snow) and a glass panel on the right shows the edition, a live countdown
   and a sneak-peek link. From launch the panel says "Out now"; when the dates pass, the band is
   itself again. From 761 to 1000px the panel becomes a glass card at the foot of the band, over
   the scene's floor (the "ticket"; the band script fades the landmark and the sun into it); on
   phones the same card sits in Latest stories, under the first story, in the edition's colours
   (#ha-card), and the band is the season alone.

   The pick (between the pick markers) is also copied into the page's head when the page is
   assembled, together with the entries, so the first paint already wears the season and the band
   script lays the scene out round the panel from the start. This file then fills the panel and
   the cards, starts the particles, runs the countdown and the phase changes, and reads the
   entries file again in case it changed after the page was assembled.

   It talks to the band script through window.catalystScene.announce(). The countdown is a
   once-a-second timer that only changes text; the blanks and the snow are compositor animations
   (opacity and transform); the panel's rim light has a short loop of its own that runs only while
   a pointer moves it and stops once it has settled.

   The glass's refraction (lgMap, lgFilter) is adapted from getDisplacementMap and
   getDisplacementFilter in liquid-glass (github.com/nikdelvin/liquid-glass, src/utils/liquidGlass.ts):

   MIT License

   Copyright (c) 2025 Nikita Stadnik

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
   ============================================================ */
(function () {
  'use strict';

  /* pick:start */
  // The entry for now: the first whose theme dates contain the moment (the dates carry their
  // Eastern Time offset). ?announce=<id> forces one, ?announce=off turns the mode off, and
  // ?announce-date=2026-12-20 pretends it is noon of that day in Eastern Time.
  // Returns { entry, theme, panel: 'before' | 'after' | '', skew: pretend minus real time in ms }.
  function pickAnnouncement(list, search, real) {
    var none = { entry: null, theme: false, panel: '', skew: 0 };
    if (!list || !list.length || /[?&]announce=off\b/.test(search)) return none;
    var now = real, d = /[?&]announce-date=([0-9T:.+-]+)/.exec(search);
    if (d) { var t = Date.parse(d[1].indexOf('T') > 0 ? d[1] : d[1] + 'T12:00:00-05:00'); if (!isNaN(t)) now = t; }
    var force = /[?&]announce=([\w-]+)/.exec(search), e = null;
    for (var i = 0; i < list.length && !e; i++) {
      var x = list[i];
      if (force ? x.id === force[1] : now >= Date.parse(x.themeFrom) && now < Date.parse(x.themeTo)) e = x;
    }
    if (!e) return none;
    var panel = '';
    if (now < Date.parse(e.panelTo) && (force || now >= Date.parse(e.panelFrom))) panel = now < Date.parse(e.launch) ? 'before' : 'after';
    return { entry: e, theme: true, panel: panel, skew: now - real };
  }
  // Puts the pick on the page: the season and phase on <html>, the season's palettes as the band's
  // palette table (the band's registered colours, so they fade as the band's own do), and which
  // tree to show. Returns the tree picture.
  function announceHead(r, doc) {
    var root = doc.documentElement, e = r.entry, st = doc.getElementById('ha-pal');
    ['data-season', 'data-hero-panel', 'data-skip-announce'].forEach(function (a) { root.removeAttribute(a); });
    if (st) st.parentNode.removeChild(st);
    if (!r.theme) return '/beta/masthead/scene/tree.webp';
    var css = '', sel = '[data-season="' + e.season + '"] .band';
    (e.palettes || []).forEach(function (p, i) { css += sel + '[data-p="' + i + '"]{--g:' + p.g + ';--c:' + p.c + ';--t:' + (e.text || '#f6efe4') + '}'; });
    css += sel + '{--ha-accent:' + (e.accent || '#f4b9a4') + '}';
    st = doc.createElement('style'); st.id = 'ha-pal'; st.textContent = css; doc.head.appendChild(st);
    root.setAttribute('data-season', e.season);
    if (r.panel) { root.setAttribute('data-hero-panel', r.panel); root.setAttribute('data-skip-announce', e.id); }
    return e.tree || '/beta/masthead/scene/tree.webp';
  }
  // a tree picture and its 720px copy, as a srcset
  function treeSet(src) { return src.replace(/\.webp(\?|$)/, '-720.webp$1') + ' 720w, ' + src + ' 1440w'; }
  /* pick:end */

  var doc = document, root = doc.documentElement, band = doc.getElementById('band');
  if (!band) return;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var search = location.search;
  var cur = window.catalystAnnounce || pickAnnouncement([], search, Date.now());
  var list = cur.list || [];
  var skew = cur.skew || 0;
  function now() { return Date.now() + skew; }
  var panelEl = doc.getElementById('ha-panel'), ticketEl = doc.getElementById('ha-ticket'), cardEl = doc.getElementById('ha-card');
  var cardsEl = [ticketEl, cardEl].filter(Boolean);   // the card in the band (761-1000px) and the one in the stories (phones)
  var fx = null, fxKind = '', countT = 0, phaseT = 0, cells = null;

  // ---------- particles ----------
  // Each kind is a list of layers; a layer is a square tile of small shapes that falls one tile
  // per dur seconds, the whole layer turned by slant degrees. Snow is the only kind so far; petals
  // and leaves can be added here with their own shapes (draw returns the tile's SVG shapes).
  var PARTICLES = {
    snow: { slant: -8, layers: [
      { tile: 260, dur: 30, draw: dots([[23, 41], [97, 12], [171, 88], [54, 139], [212, 176], [131, 214], [247, 61]], .7, 'rgba(246,243,236,.72)') },
      { tile: 340, dur: 21, draw: dots([[61, 92], [233, 205], [148, 301]], 1.1, 'rgba(246,243,236,.8)') }
    ] }
  };
  function dots(pts, r, fill) {
    return function () { return pts.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + r + '" fill="' + fill + '"/>'; }).join(''); };
  }
  function setParticles(kind) {
    kind = PARTICLES[kind] ? kind : '';
    if (kind === fxKind) return;
    if (fx) { fx.parentNode.removeChild(fx); fx = null; }
    fxKind = kind;
    if (!kind) return;
    var P = PARTICLES[kind];
    fx = doc.createElement('div');
    fx.className = 'ha-fx'; fx.setAttribute('aria-hidden', 'true'); fx.setAttribute('data-kind', kind);
    P.layers.forEach(function (L) {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + L.tile + '" height="' + L.tile + '">' + L.draw() + '</svg>';
      var i = doc.createElement('i');
      i.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
      i.style.setProperty('--tile', L.tile + 'px');
      i.style.setProperty('--slant', P.slant + 'deg');
      i.style.animationDuration = L.dur + 's';
      fx.appendChild(i);
    });
    band.appendChild(fx);
    measure();
  }
  // the particles thin out to about 12% behind the copy, so they never sit on the type: an ellipse
  // centred on the copy, read once per resize
  function measure() {
    if (!fx) return;
    var b = band.getBoundingClientRect(), c = band.querySelector('.band-copy').getBoundingClientRect();
    fx.style.setProperty('--hx', (c.left - b.left + c.width / 2).toFixed(0) + 'px');
    fx.style.setProperty('--hy', (c.top - b.top + c.height / 2).toFixed(0) + 'px');
    fx.style.setProperty('--hrx', (c.width * .85).toFixed(0) + 'px');
    fx.style.setProperty('--hry', (c.height * .85).toFixed(0) + 'px');
    fx.classList.add('on');
  }
  function bandResized() { measure(); placePanel(); }
  if ('ResizeObserver' in window) new ResizeObserver(bandResized).observe(band); else window.addEventListener('resize', bandResized);

  // ---------- liquid glass (the panel and the ticket) ----------
  // Nearly clear glass whose light lives in its 1-2px edge. Chromium and Firefox bend the band
  // behind it through an SVG displacement filter (with a little colour fringing) used in
  // backdrop-filter, built for the element's own size and corner radius; Safari can't draw url()
  // there and keeps the CSS blur. Over it, in every browser, four rings (css/hero-announcement.css):
  // a neutral rim, a white light that glides round the rim toward the pointer, a thin prism fringe
  // beside it and a faint inner band of colour. ?glass=url or ?glass=frost forces one or the other.
  function lgMap(w, h, r, d) {   // the displacement map: red pushes x, green y, gray none
    return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg height="' + h + '" width="' + w + '" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<style>.mix{mix-blend-mode:screen}</style><defs>' +
      '<linearGradient id="Y" x1="0" x2="0" y1="' + Math.ceil(r / h * 15) + '%" y2="' + Math.floor(100 - r / h * 15) + '%"><stop offset="0%" stop-color="#0F0"/><stop offset="100%" stop-color="#000"/></linearGradient>' +
      '<linearGradient id="X" x1="' + Math.ceil(r / w * 15) + '%" x2="' + Math.floor(100 - r / w * 15) + '%" y1="0" y2="0"><stop offset="0%" stop-color="#F00"/><stop offset="100%" stop-color="#000"/></linearGradient></defs>' +
      '<rect x="0" y="0" height="' + h + '" width="' + w + '" fill="#808080"/><g filter="blur(2px)">' +
      '<rect x="0" y="0" height="' + h + '" width="' + w + '" fill="#000080"/>' +
      '<rect x="0" y="0" height="' + h + '" width="' + w + '" fill="url(#Y)" class="mix"/>' +
      '<rect x="0" y="0" height="' + h + '" width="' + w + '" fill="url(#X)" class="mix"/>' +
      '<rect x="' + d + '" y="' + d + '" height="' + (h - 2 * d) + '" width="' + (w - 2 * d) + '" fill="#808080" rx="' + r + '" ry="' + r + '" filter="blur(' + d + 'px)"/></g></svg>');
  }
  function lgFilter(w, h, r, d, strength, ca) {   // three displacements, one per colour channel, screened back together
    var dm = function (sc) { return '<feDisplacementMap in="SourceGraphic" in2="displacementMap" scale="' + sc + '" xChannelSelector="R" yChannelSelector="G"/>'; };
    var cm = function (v, n) { return '<feColorMatrix type="matrix" values="' + v + '" result="' + n + '"/>'; };
    return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg height="' + h + '" width="' + w + '" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<filter id="displace" color-interpolation-filters="sRGB">' +
      '<feImage x="0" y="0" height="' + h + '" width="' + w + '" href="' + lgMap(w, h, r, d) + '" result="displacementMap"/>' +
      dm(strength + ca * 2) + cm('1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'displacedR') +
      dm(strength + ca) + cm('0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'displacedG') +
      dm(strength) + cm('0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'displacedB') +
      '<feBlend in="displacedR" in2="displacedG" mode="screen"/><feBlend in2="displacedB" mode="screen"/>' +
      '</filter></defs></svg>') + '#displace';
  }
  // support, the library's way (a url() backdrop-filter that reads back), but not WebKit: Safari
  // parses url() there and then draws nothing at all
  var LENS = (function () {
    var f = /[?&]glass=(url|frost)\b/.exec(search);
    if (f) return f[1] === 'url';
    var t = doc.createElement('div'), v;
    t.style.cssText = 'backdrop-filter: url(#test)';
    v = t.style.backdropFilter;
    return (v === 'url(#test)' || v === 'url("#test")') && !/Apple/.test(navigator.vendor || '');
  })();
  var RINGS = '<span class="ha-glass" aria-hidden="true"><i class="ha-r1"></i><i class="ha-r2"></i><i class="ha-r3"></i><span class="ha-r4"><i></i></span></span>';
  function lens(el) {
    if (!el || !LENS || el === cardEl) return;   // the stories' card is solid: nothing behind it to bend
    var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h) return;
    var r = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0), sig = w + 'x' + h + 'r' + r;
    if (el._lens === sig) return;
    el._lens = sig;
    el.style.backdropFilter = 'blur(1px) url("' + lgFilter(w, h, r, 14, 95, 6) + '") blur(3px) brightness(1.12) saturate(1.6)';
    el.classList.add('ha-lens');
  }
  if ('ResizeObserver' in window) {
    var lensRO = new ResizeObserver(function () { lens(panelEl); lens(ticketEl); });
    [panelEl, ticketEl].forEach(function (el) { if (el) lensRO.observe(el); });
  }

  // The rim light: A, its angle (0 at the top, clockwise), and i, its strength. At rest it sits at
  // the top left. A pointer over the panel draws it round the rim toward itself, the short way and
  // at most 2.2 degrees a frame (one corner to the opposite one in about 1.5s, gliding round the
  // edge), brighter near the edges and corners, and the panel leans up to 1.2px toward it. The loop
  // writes three custom properties and a transform, reads nothing, and stops once all is still.
  // Touch screens and reduced motion keep it at rest; so does the ticket.
  var REST = { a: -42, i: .22 }, HOVER = window.matchMedia('(hover: hover) and (pointer: fine)');
  function rest(el) {
    if (!el) return;
    el.style.setProperty('--ha-a', REST.a); el.style.setProperty('--ha-i', REST.i);
  }
  var lit = { a: REST.a, i: REST.i, x: 0, y: 0, ta: REST.a, ti: REST.i, tx: 0, ty: 0, raf: 0, box: null, on: false };
  function litPaint() {
    var s = panelEl.style;
    s.setProperty('--ha-a', lit.a.toFixed(2)); s.setProperty('--ha-i', lit.i.toFixed(3));
    s.transform = Math.abs(lit.x) + Math.abs(lit.y) > .005 ? 'translate(' + lit.x.toFixed(2) + 'px,' + lit.y.toFixed(2) + 'px)' : '';
  }
  function litFrame() {
    var d = ((lit.ta - lit.a) % 360 + 540) % 360 - 180;
    lit.a += Math.max(-2.2, Math.min(2.2, d * .045));
    lit.a = ((lit.a + 540) % 360) - 180;
    lit.i += (lit.ti - lit.i) * .035;
    lit.x += (lit.tx - lit.x) * .04; lit.y += (lit.ty - lit.y) * .04;
    if (Math.abs(d) < .05 && Math.abs(lit.ti - lit.i) < .002 && Math.abs(lit.tx - lit.x) < .01 && Math.abs(lit.ty - lit.y) < .01) {
      lit.a = lit.ta; lit.i = lit.ti; lit.x = lit.tx; lit.y = lit.ty; lit.raf = 0; litPaint(); return;
    }
    litPaint();
    lit.raf = requestAnimationFrame(litFrame);
  }
  function litGo() { if (!lit.raf) lit.raf = requestAnimationFrame(litFrame); }
  function litAim(px, py) {   // a point over the panel (page coordinates) to aim the light at
    var q = lit.box || (lit.box = panelEl.getBoundingClientRect());
    var w = q.width, h = q.height, x = px - q.left - lit.x, y = py - q.top - lit.y, dx = x - w / 2, dy = y - h / 2;
    if (dx * dx + dy * dy > 36) lit.ta = Math.atan2(dx, -dy) * 180 / Math.PI;   // not within 6px of the centre
    lit.ti = .42 + .58 * Math.max(0, 1 - Math.max(0, Math.min(x, w - x, y, h - y)) / (.28 * Math.min(w, h)));
    lit.tx = Math.max(-1, Math.min(1, dx / (w / 2))) * 1.2; lit.ty = Math.max(-1, Math.min(1, dy / (h / 2))) * 1.2;
    litGo();
  }
  function litRest() { lit.ta = REST.a; lit.ti = REST.i; lit.tx = lit.ty = 0; lit.box = null; litGo(); }
  if (panelEl && !REDUCED) {
    panelEl.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch' && HOVER.matches) litAim(e.clientX, e.clientY); });
    panelEl.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') litRest(); });
    window.addEventListener('scroll', function () { lit.box = null; }, { passive: true });
    window.addEventListener('resize', function () { lit.box = null; }, { passive: true });
  }

  // The panel sits midway between the floating nav pill and the band's bottom edge, the same gap
  // above and below. If the full panel and two 18px gaps don't fit there, it turns compact (as it
  // always is from 1001 to 1180px). Read on resize, never per frame.
  function placePanel() {
    if (!panelEl || !panelEl.innerHTML || !panelEl.offsetWidth) return;
    var bin = panelEl.offsetParent || band, ir = bin.getBoundingClientRect(), hd = doc.querySelector('#site-header .header');
    var nav = hd && window.scrollY < 4 ? hd.getBoundingClientRect().bottom : (panelEl._nav != null ? panelEl._nav + ir.top : ir.top);
    if (hd) panelEl._nav = nav - ir.top;   // no header yet: the band's own top stands in, not kept
    var room = ir.bottom - nav, was = panelEl.classList.contains('ha-tight');
    if (was) panelEl.classList.remove('ha-tight');
    var full = panelEl.offsetHeight;
    if (room < full + 36) panelEl.classList.add('ha-tight');
    var h = panelEl.offsetHeight;
    panelEl.style.top = (nav - ir.top + (room - h) / 2).toFixed(1) + 'px';
    lit.box = null;
  }
  // the header is fetched by js/layout.js, which runs after this script: place the panel again once
  // it is in (and whenever the site bar comes or goes, which layout.js signals with a resize)
  function afterLayout() { if (window.layoutReady && window.layoutReady.then) window.layoutReady.then(function () { requestAnimationFrame(placePanel); }); }
  if (doc.readyState === 'complete') afterLayout(); else doc.addEventListener('DOMContentLoaded', afterLayout);
  window.addEventListener('resize', function () { requestAnimationFrame(placePanel); }, { passive: true });

  // ---------- words ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function etDate(t, o) { try { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'America/New_York' }, o)).format(new Date(t)); } catch (e) { return ''; } }
  var ARROW = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  function blanks(e) {
    return '<span class="ha-blanks">' + (e.blanks || []).map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') + '</span>';
  }
  function left(e) { return Math.max(0, Date.parse(e.launch) - now()); }

  // ---------- the panel (1001px and up) ----------
  // the glass's rings, then the content above them: the cover and three lines, "The future of health
  // is ___", the countdown (after launch, the sections), the button
  function panelHTML(r) {
    var e = r.entry, out = r.panel === 'after', w = out ? e.after : e.before, launch = Date.parse(e.launch);
    var h = RINGS + '<div class="ha-col"><div class="ha-top">' +
      '<a class="ha-cover" href="' + esc(e.link) + '" aria-label="' + esc(e.title) + ': the cover"><span class="ha-cv">' +
      '<img src="' + esc(e.cover) + '" alt="" width="58" height="78" decoding="async"><i class="ha-spine"></i><i class="ha-gloss"></i></span></a>' +
      '<div class="ha-lines"><p class="ha-kicker">' + esc(w.kicker) + '</p><p class="ha-title">' + esc(e.title) + '</p>' +
      (w.note ? '<p class="ha-note">' + esc(w.note) + '</p>' : '') + '</div></div>' +
      '<p class="ha-lead">' + esc(e.lead) + ' ' + blanks(e) + '</p>';
    if (!out) {
      h += countHTML() + '<p class="ha-sr">Out ' + esc(etDate(launch, { month: 'long', day: 'numeric', year: 'numeric' })) + '</p>';
    } else {
      h += '<ul class="ha-secs">' + (e.blanks || []).map(function (b) { return '<li><a href="' + esc(e.link) + '#stories">' + esc(cap(b)) + '</a></li>'; }).join('') + '</ul>';
    }
    h += '<a class="ha-btn" href="' + esc(e.link) + '"><span>' + esc(w.cta) + '</span>' + ARROW + '</a></div>';
    return h;
  }
  // the countdown: days, hours, minutes and seconds (no seconds under reduced motion), filled by count()
  function countHTML() {
    var unit = [['d', 'Days'], ['h', 'Hrs'], ['m', 'Min']].concat(REDUCED ? [] : [['s', 'Sec']]);
    return '<div class="ha-count" aria-hidden="true">' + unit.map(function (u, i) {
      return (i ? '<i class="ha-colon">:</i>' : '') + '<span class="ha-cell"><b data-u="' + u[0] + '">00</b><small>' + u[1] + '</small></span>';
    }).join('') + '</div>';
  }
  // the countdown's colons are Poppins Light, which the page doesn't load: just that one glyph, once
  function colonFont() {
    if (doc.getElementById('ha-colon-font')) return;
    var l = doc.createElement('link');
    l.id = 'ha-colon-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@300&text=%3A&display=swap';
    doc.head.appendChild(l);
  }
  // ---------- the ticket: the card at the foot of the band (1000px and down) ----------
  // the cover and three lines (kicker and date, title, "The future of health is ___"); the countdown
  // and the button under them (after launch, the button alone)
  function ticketHTML(r) {
    var e = r.entry, out = r.panel === 'after', w = out ? e.after : e.before, launch = Date.parse(e.launch);
    return RINGS + '<div class="ha-tin">' +
      '<a class="ha-tcover" href="' + esc(e.link) + '" tabindex="-1" aria-hidden="true"><span class="ha-cv">' +
      '<img src="' + esc(e.cover) + '" alt="" width="46" height="62" decoding="async"><i class="ha-spine"></i><i class="ha-gloss"></i></span></a>' +
      '<div class="ha-ttext"><p class="ha-tk">' + esc(w.kicker) + (out ? '' : ' &middot; ' + esc(etDate(launch, { month: 'short', day: 'numeric' }))) + '</p>' +
      '<p class="ha-tt">' + esc(e.title) + '</p>' +
      '<p class="ha-tl2">' + esc(e.lead) + ' ' + blanks(e) + '</p></div>' +
      '<div class="ha-trow' + (out ? ' out' : '') + '">' + (out ? '' : countHTML()) +
      '<a class="ha-tbtn" href="' + esc(e.link) + '"><span>' + esc(out ? w.cta : 'Sneak peek') + '</span>' + ARROW + '</a></div>' +
      (out ? '' : '<p class="ha-sr">Out ' + esc(etDate(launch, { month: 'long', day: 'numeric', year: 'numeric' })) + '</p>') + '</div>';
  }
  function render(r) {
    clearTimeout(countT); cells = null;
    if (!r.panel) {
      [panelEl].concat(cardsEl).forEach(function (el) { if (el) { el.classList.remove('on'); el.innerHTML = ''; } });
      return;
    }
    var e = r.entry, launch = Date.parse(e.launch);
    if (panelEl) {
      panelEl.setAttribute('aria-label', 'The ' + e.title + ' edition, ' + (r.panel === 'after' ? 'out now' : 'out ' + etDate(launch, { month: 'long', day: 'numeric' })));
      panelEl.innerHTML = panelHTML(r);
    }
    cardsEl.forEach(function (el) {
      el.setAttribute('aria-label', 'The ' + e.title + ' edition, ' + (r.panel === 'after' ? 'out now' : 'out ' + etDate(launch, { month: 'long', day: 'numeric' })));
      el.innerHTML = ticketHTML(r);
    });
    if (cardEl) {   // outside the band: the season's first colour and its accent, set on the card itself
      var p0 = (e.palettes || [])[0];
      cardEl.style.setProperty('--ha-ink', p0 ? p0.g : '');
      cardEl.style.setProperty('--ha-accent', e.accent || '#f4b9a4');
    }
    // the countdown's cells, in the panel and the cards alike
    cells = {};
    [panelEl].concat(cardsEl).forEach(function (el) {
      if (el) [].forEach.call(el.querySelectorAll('.ha-count b'), function (b) { var u = b.getAttribute('data-u'); (cells[u] = cells[u] || []).push(b); });
    });
    rotate(panelEl); cardsEl.forEach(rotate);
    if (r.panel === 'before') { count(); colonFont(); }
    fitTicket(); placePanel(); lens(panelEl); lens(ticketEl); cardsEl.forEach(rest);
    if (panelEl) { lit.a = lit.ta = REST.a; lit.i = lit.ti = REST.i; lit.x = lit.y = lit.tx = lit.ty = 0; litPaint(); }
    requestAnimationFrame(function () {
      [panelEl].concat(cardsEl).forEach(function (el) { if (el) el.classList.add('on'); });
    });
  }
  // the blank after "The future of health is": one every 3s, fading in and out as it rises
  // (still, the first one, under reduced motion)
  function rotate(el) {
    var s = el && el.querySelectorAll('.ha-blanks > span');
    if (!s || !s.length) return;
    if (REDUCED || s.length < 2 || !s[0].animate) { s[0].style.opacity = 1; return; }
    var n = s.length, f = 1 / n, a = .35 / (3 * n), out = f - .25 / (3 * n);   // .35s in, .25s out, within each 3s
    [].forEach.call(s, function (x, i) {
      x.animate([
        { opacity: 0, transform: 'translateY(.35em)', offset: 0, easing: 'cubic-bezier(.22, 1, .36, 1)' },
        { opacity: 1, transform: 'translateY(0)', offset: a },
        { opacity: 1, transform: 'translateY(0)', offset: out, easing: 'ease-in' },
        { opacity: 0, transform: 'translateY(-.35em)', offset: f },
        { opacity: 0, transform: 'translateY(-.35em)', offset: 1 }
      ], { duration: 3000 * n, delay: 3000 * i, iterations: Infinity, fill: 'backwards' });   // easing per step: on the options it would bend the whole 12s
    });
  }
  // on a narrow screen a card's lead line goes if it would not fit on one line
  function fitTicket() {
    cardsEl.forEach(function (el) {
      var l2 = el.querySelector('.ha-tl2');
      if (!l2) return;
      l2.hidden = false;
      if (l2.scrollWidth > l2.clientWidth + 1) l2.hidden = true;
    });
  }
  window.addEventListener('resize', fitTicket, { passive: true });

  // ---------- the countdown: digits change once a second (once a minute under reduced motion) ----------
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function count() {
    var e = cur.entry, ms = left(e);
    if (ms <= 0) { phase(); return; }
    var s = Math.floor(ms / 1000), v = { d: String(Math.floor(s / 86400)), h: two(Math.floor(s / 3600) % 24), m: two(Math.floor(s / 60) % 60), s: two(s % 60) };
    if (cells) Object.keys(cells).forEach(function (k) { cells[k].forEach(function (b) { if (b.textContent !== v[k]) b.textContent = v[k]; }); });
    var step = REDUCED ? 60000 - ms % 60000 : ms % 1000 || 1000;
    countT = setTimeout(count, step + 20);
  }

  // ---------- phases: the next date that changes anything (launch, panelTo, themeTo) re-picks ----------
  function phase() {
    var r = pickAnnouncement(list, search.replace(/[?&]announce-date=[^&]*/, ''), now());
    r.skew = skew;
    if (key(r) !== key(cur)) apply(r, false);
    var e = cur.entry; clearTimeout(phaseT);
    if (!e) return;
    var t = [e.launch, e.panelTo, e.themeTo].map(Date.parse).filter(function (x) { return x > now(); });
    if (t.length) phaseT = setTimeout(phase, Math.min(Math.min.apply(null, t) - now() + 500, 2147483000));
  }
  function key(r) { return (r.entry ? r.entry.id + JSON.stringify(r.entry) : '') + '|' + r.theme + '|' + r.panel; }

  // ---------- put it on the page ----------
  function apply(r, first) {
    var was = cur; cur = r;
    if (!first) {
      // the head did this for the first paint; later changes jump straight to the new colours
      if (was.theme !== r.theme || (was.entry && was.entry.id) !== (r.entry && r.entry.id)) {
        band.classList.add('ha-snap');
        requestAnimationFrame(function () { requestAnimationFrame(function () { band.classList.remove('ha-snap'); }); });
      }
      var tree = announceHead(r, doc), img = band.querySelector('.sc-tree img');
      if (img && img.getAttribute('srcset') !== treeSet(tree)) img.setAttribute('srcset', treeSet(tree));
    }
    setParticles(r.theme && r.entry.particles);
    var sc = window.catalystScene;
    if (sc && sc.announce) sc.announce({ panel: !!r.panel, theme: !!r.theme, palEvery: r.theme ? +r.entry.paletteEvery || 0 : 0, npal: r.theme ? (r.entry.palettes || []).length || 5 : 5 });
    render(r);
  }

  apply(cur, true);
  phase();
  // the entries file again: if it changed after the page was assembled, follow it
  if (window.fetch) {
    fetch('/edition-art/hero-announcements.json', { cache: 'no-cache' }).then(function (res) { return res.ok ? res.json() : null; }).then(function (l) {
      if (!l || !l.length) return;
      list = l;
      var r = pickAnnouncement(l, search, Date.now());
      if (key(r) !== key(cur)) { skew = r.skew; apply(r, false); phase(); }
    }).catch(function () {});
  }

  window.catalystAnnounceMode = { pick: pickAnnouncement, particles: PARTICLES, apply: function (r) { apply(r, false); } };
})();
