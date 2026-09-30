/* ============================================================
   About page — about.html
   Hero: a Capitol dome ink plate that draws itself (same WebGL
   engine as homepage-beta: one crisp plate + a draw-order map).
   Then: mission lit word by word, story chapters beside their
   drawings, live numbers, the team with bios, a parallax close.
   Team data comes from js/main.js (teamMembers, rosterGroups,
   alumniMembers), the single source of truth for the roster.
   ============================================================ */
(function () {
  'use strict';

  var body = document.body;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var V = '2';
  var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
  var map = function (v, a, b) { return clamp((v - a) / (b - a), 0, 1); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var mqPortrait = window.matchMedia('(max-width: 760px), (max-aspect-ratio: 9/10)');
  var portrait = function () { return mqPortrait.matches; };

  requestAnimationFrame(function () { body.classList.add('is-ready'); });

  /* ------------------------------------------------------------
     Ink plate (same shader as homepage-beta)
     ------------------------------------------------------------ */
  var VS = '#version 300 es\n' +
    'in vec2 a;uniform vec4 r;uniform vec2 v;out vec2 uv;' +
    'void main(){vec2 p=r.xy+a*r.zw;vec2 c=p/v*2.0-1.0;gl_Position=vec4(c.x,-c.y,0.,1.);uv=a;}';
  var FS = '#version 300 es\nprecision highp float;' +
    'in vec2 uv;uniform sampler2D P;uniform sampler2D M;uniform float t;uniform float g;uniform vec3 k;uniform vec3 q;out vec4 o;' +
    'void main(){' +
    'float ink=(1.0-texture(P,uv).r)*smoothstep(0.0,0.035,uv.x)*smoothstep(1.0,0.965,uv.x);' +
    'float m=texture(M,uv).r;' +
    'float a=smoothstep(m-0.035,m+0.004,t);' +
    'float wet=a*(1.0-smoothstep(m,m+0.07,t));' +
    'float d=ink*min(1.0,max(a*(1.0+0.45*wet),g));' +
    'o=vec4(q*(1.0-d*(1.0-k)),1.0);}';
  var AR = 536 / 960;                               // plate aspect (height / width)

  function loadImg(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.decoding = 'async'; i.onload = function () { res(i); }; i.onerror = rej; i.src = src; });
  }

  function Plate(el, dir, opts) {
    this.el = el; this.canvas = el.querySelector('canvas'); this.dir = dir;
    this.rect = opts.rect; this.inkAt = opts.inkAt; this.ghost = opts.ghost;
    this.sp = 0; this.key = ''; this.ready = false;
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
    if (this.gl) this.initGL(); else this.ctx = this.canvas.getContext('2d');
  }
  Plate.prototype.initGL = function () {
    var gl = this.gl, self = this;
    var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this.gl = null; this.ctx = this.canvas.getContext('2d'); return; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    ['r', 'v', 'P', 'M', 't', 'g', 'k', 'q'].forEach(function (n) { self.u[n] = gl.getUniformLocation(pr, n); });
    gl.uniform1i(this.u.P, 0); gl.uniform1i(this.u.M, 1);
    gl.uniform3f(this.u.k, 0.13, 0.17, 0.25);
    gl.uniform3f(this.u.q, 248 / 255, 247 / 255, 243 / 255);
  };
  Plate.prototype.texture = function (unit, img, mip) {
    var gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  };
  Plate.prototype.upload = function () {
    if (!this.gl) { this.ready = true; this.key = ''; return; }
    if (!this.mapImg || !this.plateImg) return;
    this.texture(1, this.mapImg, false); this.texture(0, this.plateImg, true);
    this.ready = true; this.key = '';
  };
  Plate.prototype.load = function () {
    var self = this, q = '?v=' + V;
    Promise.all([loadImg(this.dir + 'plate-s.webp' + q), this.gl ? loadImg(this.dir + 'map.webp' + q) : null]).then(function (r) {
      self.plateImg = r[0]; self.mapImg = r[1]; self.upload();
      return loadImg(self.dir + (portrait() ? 'plate-m' : 'plate') + '.webp' + q).then(function (img) { self.plateImg = img; self.upload(); });
    }).catch(function (e) { console.warn('[about] plate', e); });
  };
  Plate.prototype.render = function () {
    var c = this.canvas, vw = c.clientWidth, vh = c.clientHeight;
    var W = Math.round(vw * DPR), H = Math.round(vh * DPR);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.key = ''; }
    if (!this.ready) return;
    var p = this.sp, t = this.inkAt(p), R = this.rect(vw, vh, p);
    var key = [W, H, t.toFixed(4), R.x.toFixed(1), R.y.toFixed(1), R.w.toFixed(1)].join('|');
    if (key === this.key) return;
    this.key = key;
    if (this.gl) {
      var gl = this.gl;
      gl.viewport(0, 0, W, H); gl.clearColor(248 / 255, 247 / 255, 243 / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4f(this.u.r, R.x, R.y, R.w, R.h); gl.uniform2f(this.u.v, vw, vh);
      gl.uniform1f(this.u.t, t); gl.uniform1f(this.u.g, this.ghost);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      c.classList.add('on');
    } else {
      c.classList.add('on');
      var ctx = this.ctx; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#f8f7f3'; ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = Math.max(this.ghost, Math.min(1, t));
      ctx.drawImage(this.plateImg, R.x, R.y, R.w, R.h);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* ------------------------------------------------------------
     Hero: the dome inks in beside the definition
     ------------------------------------------------------------ */
  var hero = document.getElementById('ab-hero');
  var def = document.getElementById('ab-def');
  var missionIn = document.getElementById('ab-mission-in');
  var cue = document.getElementById('ab-cue');
  var more = document.getElementById('ab-more');
  more.addEventListener('click', function () {
    var next = hero.nextElementSibling;
    if (next) window.scrollTo({ top: next.getBoundingClientRect().top + window.scrollY - headerBottom(), behavior: REDUCED ? 'auto' : 'smooth' });
  });
  var DOME = { x: 0.672, tip: 0.1 };
  var mShift = 0;                                   // phones: px the hero composition has glided up
  // desktop: the line the statue's tip and the tops of "Catalyst" / the
  // mission headline share — low enough that the small kickers above them
  // clear the fixed site header
  var TIP_Y = 136;
  function headerBottom() {
    var h = document.querySelector('.header');
    return h ? h.getBoundingClientRect().bottom : 76;
  }
  function domeMidY(top, bottom) { return top + (bottom - top) * 0.46; }
  function tipY() {
    var h = document.querySelector('.header');
    var hb = h ? h.getBoundingClientRect().bottom : 76;
    var kick = Math.max(defWord.offsetTop, statementEl.offsetTop);   // kicker + gap above the big line
    return Math.round(hb + 24 + kick + window.innerHeight * 0.07);
  }                   // dome centre / statue tip in plate coordinates
  // right edge of the widest rendered line of hero text (definition or
  // mission), not the width of their boxes
  var defWord = def.querySelector('.ab-word');
  var statementEl = document.getElementById('ab-statement');
  function textRight() {
    var r = 0;
    [defWord, def.querySelector('.ab-pron')].forEach(function (el) { if (el) r = Math.max(r, el.getBoundingClientRect().left + el.scrollWidth); });
    var range = document.createRange();
    [statementEl].concat(Array.prototype.slice.call(def.querySelectorAll('.ab-senses li'))).forEach(function (el) {
      range.selectNodeContents(el);
      Array.prototype.forEach.call(range.getClientRects(), function (q) { r = Math.max(r, q.right); });
    });
    return r;
  }
  var dome = new Plate(hero, '/beta/about-dome/', {
    ghost: 0.22,
    inkAt: function (p) { return REDUCED ? 1.04 : lerp(0.2, 1.04, map(p, 0, 0.42)); },
    rect: function (vw, vh, p) {
      var s = 1 + 0.05 * ease(map(p, 0.3, 1));        // a slow push while it inks
      if (portrait()) {
        // phones: drawing on top, text underneath; the whole composition
        // glides up as you scroll (mShift) so the text comes fully into view
        var w = vw * 1.45 * s, h = w * AR;
        return { w: w, h: h, x: vw * 0.5 - DOME.x * w, y: 70 - DOME.tip * h * 0.55 - mShift };
      }
      // The statue's tip sits a little under the header (TIP_Y); the text
      // on the left lines up with it. The drawing is as large as it can be
      // while its leftmost line (the horizontal measurement line, ≈0.26 of
      // the plate's width left of the dome's axis) clears the widest line
      // of text by 44px, its right wing (≈0.29 right of the axis) stays on
      // screen, and its base (≈0.80 below the tip) stays above the bottom.
      // Fit the dome between the text and the right edge: its leftmost
      // line clears the text by 56px, its right wing (0.29 of the plate
      // right of the axis) stays 32px inside the screen, and its base
      // (0.80 of the plate height below the tip) stays 32px above the bottom.
      var tr = textRight(), L = tr + 56, Rr = vw - 32;
      var top = headerBottom() + 28, bottom = vh - 28;
      var w2 = 0.88 * Math.min((Rr - L) / (0.26 + 0.29), (bottom - top) / (0.8 * AR));
      var cx = L + 0.26 * w2 + ((Rr - L) - 0.55 * w2) / 2;    // centre any spare room
      w2 *= s;
      var h2 = w2 * AR;
      // the drawing (statue tip 0.10 → base 0.90 of the plate) is centred
      // a little above the middle of the space under the header
      var midY = domeMidY(top, bottom);
      return { w: w2, h: h2, x: cx - DOME.x * w2, y: midY - 0.5 * h2 };
    }
  });
  dome.load();

  function heroProgress() {
    var r = hero.getBoundingClientRect(), span = r.height - window.innerHeight;
    return span > 0 ? clamp(-r.top / span, 0, 1) : 0;
  }

  /* ------------------------------------------------------------
     Mission statement, lit word by word
     ------------------------------------------------------------ */
  var statement = document.getElementById('ab-statement');
  (function split(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          var s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.appendChild(s);
        });
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) split(n);
    });
  })(statement);
  var words = statement.querySelectorAll('.w');
  // lit by hero progress: the statement is pinned in the hero stage
  function lightWords(p) {
    var f = REDUCED ? 1 : map(p, 0.58, 0.9);
    var n = Math.round(f * words.length);
    for (var i = 0; i < words.length; i++) words[i].classList.toggle('on', i < n);
  }

  /* ------------------------------------------------------------
     Story: the chapter in the middle of the screen is active,
     and its drawing fades in beside it
     ------------------------------------------------------------ */
  var acts = document.querySelectorAll('.ab-act');
  var figs = document.querySelectorAll('.ab-frame figure');
  var actIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var k = e.target.dataset.act;
      acts.forEach(function (a) { a.classList.toggle('on', a.dataset.act === k); });
      figs.forEach(function (f) { f.classList.toggle('on', f.dataset.act === k); });
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  acts.forEach(function (a) { actIO.observe(a); });

  /* ------------------------------------------------------------
     Closing image parallax
     ------------------------------------------------------------ */
  var closeImg = document.getElementById('ab-close-img');
  function closeParallax() {
    if (!closeImg || REDUCED) return;
    var r = closeImg.parentElement.parentElement.getBoundingClientRect(), vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) return;
    closeImg.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * -0.12).toFixed(1) + 'px');
  }

  /* ------------------------------------------------------------
     Main loop
     ------------------------------------------------------------ */
  var siteHeader = null;
  (window.layoutReady || Promise.resolve()).then(function () { siteHeader = document.querySelector('.header'); });
  function tick() {
    if (siteHeader) siteHeader.classList.toggle('scrolled', window.scrollY > 50);
    var r = hero.getBoundingClientRect();
    if (r.bottom > -50) {
      var p = heroProgress();
      if (!portrait()) TIP_Y = tipY();
      dome.sp = REDUCED ? 1 : (Math.abs(p - dome.sp) < 0.0005 ? p : lerp(dome.sp, p, 0.14));
      dome.render();
      if (!REDUCED) {
        cue.style.opacity = String(1 - map(p, 0, 0.08));
        more.classList.toggle('on', p > 0.62);
        // the definition leaves upward, the mission rises into its place
        var out = ease(map(p, 0.4, 0.52));
        def.style.opacity = String(1 - out);
        // desktop: the definition's vertical centre matches the Capitol's
        var mid = domeMidY(headerBottom() + 28, window.innerHeight - 28);
        var TEXT_LIFT = 36;   // px: text sits slightly above the dome's centre line
        if (!portrait()) def.style.top = (mid - def.offsetHeight / 2 - TEXT_LIFT).toFixed(1) + 'px'; else def.style.top = '';
        if (portrait()) {
          // how far the text runs past the bottom of the visible screen
          // (tallest of the definition and the mission), then glide up by
          // that much early in the scroll so both are fully readable
          var vh2 = window.innerHeight;
          var need = Math.max(0, def.offsetTop + def.offsetHeight, missionIn.offsetTop + missionIn.offsetHeight) - (vh2 - 28);
          mShift = Math.max(0, need) * ease(map(p, 0.03, 0.3));
        } else mShift = 0;
        def.style.transform = 'translate3d(0,' + (-out * 60 - mShift).toFixed(1) + 'px,0)';
        def.style.visibility = out >= 1 ? 'hidden' : '';
        var inn = ease(map(p, 0.47, 0.6));
        missionIn.style.opacity = String(inn);
        if (!portrait()) {
          // top of the mission block sits level with the tip of the statue
          missionIn.style.top = (mid - missionIn.offsetHeight / 2 - TEXT_LIFT).toFixed(1) + 'px';   // same line as the definition
        } else missionIn.style.top = '';
        missionIn.style.transform = 'translate3d(0,' + ((1 - inn) * 70 - mShift).toFixed(1) + 'px,0)';
      }
      lightWords(p);
    }
    closeParallax();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ------------------------------------------------------------
     Hero autoplay (same as the homepage): one scroll down from the
     top plays the whole hero by itself — the dome inks, the
     definition gives way to the mission, the mission lights up — so
     nobody is left wondering whether to keep scrolling. Scrolling up
     mid-play hands control back; scrolling back through the hero
     later scrubs it by hand.
     ------------------------------------------------------------ */
  function heroAutoplay() {
    var root = document.documentElement;
    var playing = false, swallow = false, lastWheel = 0, start = 0, from = 0, to = 0, dur = 0, raf = 0, touchY = null;
    // starts moving at once, lands softly
    var launch = function (t) { return 1 - (1 - t) * (1 - t); };
    // the definition stays up a little longer so it can be read
    var SLOW = 1.4, slowA = 0, slowB = 0, cost = 0;
    var DOWN_KEYS = { ArrowDown: 1, PageDown: 1, ' ': 1, Spacebar: 1 };
    var UP_KEYS = { ArrowUp: 1, PageUp: 1, Home: 1 };
    function atTop() { return window.scrollY < 8; }
    function inHero(el) { return el && el.nodeType === 1 ? hero.contains(el) || el === document.body || el === root : false; }
    function play() {
      if (playing) return;
      var top = hero.getBoundingClientRect().top + window.scrollY, span = hero.offsetHeight - window.innerHeight;
      from = window.scrollY;
      to = top + span;
      if (to <= from + 4) return;
      slowA = clamp(top + 0.18 * span, from, to);
      slowB = clamp(top + 0.4 * span, slowA, to);
      cost = (to - from) + (SLOW - 1) * (slowB - slowA);
      dur = portrait() ? 3800 : 4200;
      playing = true; start = performance.now();
      root.style.scrollBehavior = 'auto';           // the site sets smooth scrolling; drive it directly
      raf = requestAnimationFrame(step);
    }
    // scroll position for a share of the total "cost"; each px of the
    // definition's stretch costs SLOW
    function yAt(c) {
      var a = slowA - from, zc = (slowB - slowA) * SLOW;
      if (c <= a) return from + c;
      if (c <= a + zc) return slowA + (c - a) / SLOW;
      return slowB + (c - a - zc);
    }
    function step(now) {
      var k = Math.min(1, (now - start) / dur);
      window.scrollTo(0, yAt(launch(k) * cost));
      if (k < 1) raf = requestAnimationFrame(step); else stop();
    }
    function stop() { cancelAnimationFrame(raf); playing = false; root.style.scrollBehavior = ''; }

    // Only the gesture that started the autoplay is held back: a trackpad
    // flick keeps sending ever-smaller wheel events for a second or so. Any
    // new scrolling (a fresh wheel turn, a scroll that speeds up again, a new
    // touch, a key or a click) stops the autoplay on the spot and the page
    // scrolls normally from wherever it is, so nobody is ever locked in.
    var swallowStart = 0, lastAbs = 0;
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey) return;                         // pinch-zoom
      var now = performance.now(), abs = Math.abs(e.deltaY), gap = now - lastWheel;
      if (swallow) {
        // the starting flick: the finger's own push (up to ~450ms), then an
        // only-decaying glide, whose last tiny ticks may arrive late. A
        // repeated full wheel notch is a new scroll.
        var notch = abs >= 50 && abs === lastAbs;
        var sameGesture = e.deltaY > 0 && !notch && (abs <= 4 || (gap < 300 && (now - swallowStart < 450 || abs <= lastAbs * 1.15 + 1)));
        lastWheel = now; lastAbs = abs;
        if (sameGesture) { e.preventDefault(); return; }
        swallow = false;
      }
      if (playing) { stop(); return; }               // the reader has taken over
      if (e.deltaY > 0 && atTop() && inHero(e.target)) {
        e.preventDefault(); lastWheel = swallowStart = now; lastAbs = abs; swallow = true; play();
      }
    }, { passive: false });

    window.addEventListener('touchstart', function (e) {
      if (playing) stop();                           // a new touch takes over
      touchY = e.touches.length === 1 && inHero(e.target) ? e.touches[0].clientY : null;
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (touchY === null) return;
      var dy = e.touches[0].clientY - touchY;         // < 0: finger moving up, page scrolling down
      if (playing) {
        // still the swipe that started it: let the autoplay carry on
        if (dy > 12) { stop(); touchY = null; return; }
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (dy < 0 && atTop() && e.cancelable) {
        e.preventDefault();
        if (dy < -6) play();
      }
    }, { passive: false });
    window.addEventListener('pointerdown', function (e) { if (playing && e.pointerType === 'mouse') stop(); });

    window.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.altKey || e.ctrlKey || e.metaKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)))) return;
      if (playing) { if (DOWN_KEYS[e.key] || UP_KEYS[e.key]) stop(); return; }   // the key scrolls as usual
      if (DOWN_KEYS[e.key] && !e.shiftKey && atTop()) { e.preventDefault(); play(); }
    });
  }
  if (!REDUCED) heroAutoplay();

  /* ------------------------------------------------------------
     Reveal-on-scroll
     ------------------------------------------------------------ */
  var revealIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  function observeReveals(root) { (root || document).querySelectorAll('[data-reveal]:not(.in)').forEach(function (el) { revealIO.observe(el); }); }
  observeReveals();

  /* ------------------------------------------------------------
     Team (from js/main.js) + bio dialog
     ------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var people = {}, seen = {};
  function personCard(m, i) {
    people[m.name] = m;
    // id = the anchor the About page's structured data uses (/about#yair-ben-dor)
    var id = String(m.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    var first = !document.getElementById(id) && !seen[id]; seen[id] = 1;
    return '<button type="button" class="ab-person"' + (first ? ' id="' + id + '"' : '') + ' data-reveal style="--d:' + ((i % 4) * 0.06).toFixed(2) + 's" data-name="' + esc(m.name) + '">' +
      '<span class="ph"><img src="' + esc(m.image) + '" alt="" loading="lazy" decoding="async" onerror="this.src=\'/NewsletterHeader1.png\'"></span>' +
      '<span><strong>' + esc(m.name) + '</strong><span>' + esc(m.role) + '</span></span></button>';
  }
  function renderTeam() {
    if (typeof teamMembers === 'undefined' || typeof rosterGroups === 'undefined') return false;
    var byName = {};
    teamMembers.forEach(function (m) { byName[m.name] = m; });
    document.getElementById('ab-roster').innerHTML = rosterGroups.map(function (g) {
      var clusters = g.clusters.map(function (c) {
        var cards = c.members.map(function (n) { return byName[n]; }).filter(Boolean).map(personCard).join('');
        return (c.subtitle ? '<p class="ab-cluster">' + esc(c.subtitle) + '</p>' : '') + '<div class="ab-people">' + cards + '</div>';
      }).join('');
      return '<div class="ab-group"><div class="ab-group-head"><h3>' + esc(g.title) + '</h3>' +
        (g.blurb ? '<p>' + esc(g.blurb) + '</p>' : '') + '</div>' + clusters + '</div>';
    }).join('');
    if (typeof alumniMembers !== 'undefined' && alumniMembers.length) {
      document.getElementById('ab-alumni').innerHTML = '<div class="ab-group-head"><h3>Alumni</h3><p>Former team members who helped build The Catalyst.</p></div>' +
        '<div class="ab-people">' + alumniMembers.map(personCard).join('') + '</div>';
    }
    observeReveals(document.getElementById('team'));
    // numbers
    setCount('team', teamMembers.length);
    return true;
  }

  var dlg = document.getElementById('ab-bio');
  document.getElementById('team').addEventListener('click', function (e) {
    var b = e.target.closest('.ab-person'); if (!b) return;
    var m = people[b.dataset.name]; if (!m) return;
    document.getElementById('ab-bio-img').src = m.image;
    document.getElementById('ab-bio-img').alt = 'Portrait of ' + m.name;
    document.getElementById('ab-bio-name').textContent = m.name;
    document.getElementById('ab-bio-role').textContent = m.role;
    document.getElementById('ab-bio-text').textContent = m.bio;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  document.getElementById('ab-bio-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  /* ------------------------------------------------------------
     Numbers (count up once visible) + universities ribbon
     ------------------------------------------------------------ */
  var SCHOOLS = ['George Washington University', 'Georgetown University', 'Howard University', 'Johns Hopkins University', 'Cornell University', 'Rutgers University', 'Drexel University'];
  var ribbon = document.getElementById('ab-ribbon');
  var list = '<ul>' + SCHOOLS.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
  ribbon.innerHTML = list + list;                   // two copies: the loop shifts by exactly one
  var counts = { schools: SCHOOLS.length };
  function setCount(k, n) { counts[k] = n; var el = document.querySelector('[data-count="' + k + '"]'); if (el && el.dataset.done) el.textContent = n; }
  var countIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      countIO.unobserve(e.target);
      var el = e.target, k = el.dataset.count, t0 = null;
      function step(ts) {
        var n = counts[k];
        if (n == null) { requestAnimationFrame(step); return; }  // still loading
        if (t0 === null) t0 = ts;
        var f = REDUCED ? 1 : ease(map(ts - t0, 0, 1400));
        el.textContent = Math.round(n * f);
        if (f < 1) requestAnimationFrame(step); else { el.dataset.done = '1'; el.textContent = counts[k]; }
      }
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('[data-count]').forEach(function (el) { countIO.observe(el); });

  // published stories, live from Firestore (titles only)
  fetch('https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'stories' }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
      select: { fields: [{ fieldPath: 'title' }] }, limit: 1000
    } })
  }).then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) { setCount('stories', (Array.isArray(rows) ? rows : []).filter(function (x) { return x.document; }).length); })
    .catch(function () { setCount('stories', 60); });

  // main.js is deferred ahead of this file, so its roster is ready now
  if (!renderTeam()) window.addEventListener('load', renderTeam);

  // Subscribe opens the site's newsletter modal
  document.getElementById('ab-subscribe').addEventListener('click', function () {
    var b = document.getElementById('desktop-subscribe-btn') || document.getElementById('mobile-newsletter-btn');
    if (b) b.click(); else location.href = '/#newsletter-section';
  });
})();
