/* ════════════════════════════════════════════════════════════════════
   THE VAULT — behaviour for /brain-teaser
   Picks this fortnight's riddle from js/brain-teaser-case.js, checks the
   answer against its hash, and on a correct answer opens the drawn
   vault door and walks the reader through it into the Winners' Lounge.
   Nothing here changes between riddles.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var CFG = window.CATALYST_VAULT || {};
  var CASES = window.CATALYST_CASES || [];
  var EARLY = window.CATALYST_EARLY_CASES || [];
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var store = (function () {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } }; }
  })();

  /* ── helpers (also used by editors, from the console) ─────────────── */
  function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function hash(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode('catalyst-vault:' + normalize(s))).then(function (b) {
      return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function encode(str) { var bin = ''; new TextEncoder().encode(str).forEach(function (b) { bin += String.fromCharCode(b); }); return btoa(bin); }
  function reveal(c) {
    try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(c.reveal64 || ''), function (ch) { return ch.charCodeAt(0); }))); }
    catch (e) { return { answer: '', explain: '' }; }
  }
  window.CatalystVault = { hash: hash, encode: encode };

  /* ── this fortnight's case ─────────────────────────────────────────── */
  var DAY = 86400000, PERIOD = (CFG.periodDays || 14) * DAY;
  var start = Date.parse(CFG.start || '2026-09-28T04:00:00Z');
  var idx = Math.floor((Date.now() - start) / PERIOD);
  idx = Math.max(0, Math.min(CASES.length - 1, idx));
  var CASE = CASES[idx] || { n: 0, codename: 'The Vault', riddle: 'The next riddle is on its way.', hashes: [] };
  var nextAt = start + (idx + 1) * PERIOD;
  var no = pad(CASE.n);
  var KEY_SOLVED = 'catalystVault_case' + no + '_solved';
  var KEY_TRIED = 'catalystVault_case' + no + '_attempted';
  var winnersUrl = CFG.winnersUrl || '/';

  $('vt-caseno').textContent = 'Case ' + no;
  $('vt-card-no').textContent = 'Case ' + no;
  $('vt-title').textContent = CASE.codename;
  document.title = CASE.codename + ' · The Vault | The Catalyst Magazine';
  var riddle = $('vt-riddle');
  riddle.innerHTML = CASE.riddle;
  wrapWords(riddle);

  function wrapWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], n = 0;
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (t) {
      var frag = document.createDocumentFragment();
      t.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        var s = document.createElement('span');
        s.className = 'rd'; s.textContent = part;
        s.style.setProperty('--d', (n++ * 0.03).toFixed(3) + 's');
        frag.appendChild(s);
      });
      t.parentNode.replaceChild(frag, t);
    });
  }

  /* countdown to the next riddle */
  var nextEl = $('vt-next').querySelector('b');
  function tick() {
    var left = nextAt - Date.now();
    if (idx >= CASES.length - 1 && left <= 0) { $('vt-next').textContent = ''; return; }
    if (left <= 0) { location.reload(); return; }
    var d = Math.floor(left / DAY), h = Math.floor(left % DAY / 3600000), m = Math.floor(left % 3600000 / 60000);
    nextEl.textContent = d > 0 ? d + (d === 1 ? ' day ' : ' days ') + h + (h === 1 ? ' hour' : ' hours')
                               : h + 'h ' + pad(m) + 'm';
  }
  tick(); setInterval(tick, 30000);

  /* ── past cases ───────────────────────────────────────────────────── */
  var past = CASES.slice(0, idx).reverse().map(function (c) {
    var r = reveal(c);
    return { n: c.n, codename: c.codename, riddle: c.riddle, answer: r.answer, explain: r.explain };
  }).concat(EARLY);
  $('vt-past-count').textContent = past.length;
  var list = $('vt-past-list');
  past.forEach(function (c) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="no">Case ' + pad(c.n) + '</span><h3>' + c.codename + '</h3><p>' + c.riddle + '</p>';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = 'Show the answer';
    btn.addEventListener('click', function () {
      var a = document.createElement('p');
      a.className = 'ans';
      a.innerHTML = '<b>' + c.answer + '</b>. ' + (c.explain || '');
      btn.replaceWith(a);
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
  if (!past.length) $('vt-past').hidden = true;

  /* ── answer + hold to unlock ──────────────────────────────────────── */
  var input = $('vt-input'), btn = $('vt-unlock'), label = $('vt-unlock-label'), note = $('vt-note');
  var card = $('vt-card'), result = $('vt-result');
  var solved = store.getItem(KEY_SOLVED) === 'true';
  var tried = store.getItem(KEY_TRIED) === 'true';
  var locked = solved || tried;
  var TOUCH = window.matchMedia('(hover: none)').matches;

  input.addEventListener('input', function () {
    var ready = normalize(input.value).length > 0;
    btn.disabled = locked || !ready;
    if (!locked) note.textContent = ready
      ? (TOUCH ? 'Press and hold the button to try it. You only get one go.' : 'Hold the button (or hold Enter) to try it. You only get one go.')
      : 'One attempt. Think sideways: the obvious answer is usually the trap.';
  });
  $('vt-form').addEventListener('submit', function (e) { e.preventDefault(); });

  var HOLD = REDUCED ? 450 : 1100, held = 0, holding = false, t0 = 0, raf = 0;
  function startHold() {
    if (btn.disabled || holding) return;
    holding = true; t0 = performance.now() - held * HOLD;
    label.textContent = 'Unlocking…';
    (function step(now) {
      if (!holding) return;
      held = Math.min(1, (now - t0) / HOLD);
      btn.style.setProperty('--hold', held.toFixed(3));
      if (held >= 1) { holding = false; attempt(); return; }
      raf = requestAnimationFrame(step);
    })(performance.now());
  }
  function stopHold() {
    if (!holding) return;
    holding = false; cancelAnimationFrame(raf);
    label.textContent = 'Hold to unlock';
    (function back() { held = Math.max(0, held - 0.08); btn.style.setProperty('--hold', held.toFixed(3)); if (held > 0 && !holding) requestAnimationFrame(back); })();
  }
  btn.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; btn.setPointerCapture(e.pointerId); startHold(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { btn.addEventListener(ev, stopHold); });
  btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  function keyHold(e) { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { if (e.target === input && e.key === ' ') return; e.preventDefault(); startHold(); } }
  btn.addEventListener('keydown', keyHold);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') keyHold(e); });
  document.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') stopHold(); });

  function lockUp() {
    locked = true;
    input.disabled = true; btn.disabled = true;
  }

  function attempt() {
    if (locked) return;
    var guess = input.value;
    lockUp();
    store.setItem(KEY_TRIED, 'true');     // one attempt, spent the moment you try
    label.textContent = 'Checking…';
    hash(guess).then(function (h) { return (CASE.hashes || []).indexOf(h) !== -1; }, function () { return false; })
      .then(function (ok) { setTimeout(function () { ok ? granted() : denied(); }, REDUCED ? 0 : 450); });
  }

  function answerText() {
    var r = reveal(CASE);
    return 'The answer was <strong>' + r.answer + '</strong>. ' + (r.explain || '');
  }
  function showResult(ok, html) {
    result.hidden = false;
    result.className = 'vt-result ' + (ok ? 'ok' : 'no');
    result.innerHTML = html;
  }

  function denied() {
    label.textContent = 'Locked';
    note.textContent = '';
    $('vt-stamp-no').classList.add('in'); card.classList.add('stamped');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    var stage = $('vt-stage'); stage.classList.remove('rattle'); void stage.offsetWidth; stage.classList.add('rattle');
    showResult(false, '<span class="h">Not this time</span>' + answerText() + ' A new riddle opens in ' + nextEl.textContent + '.');
  }

  function granted() {
    store.setItem(KEY_SOLVED, 'true');
    label.textContent = 'Unlocked';
    note.textContent = '';
    showResult(true, '<span class="h">Correct</span>' + answerText() + ' <a href="' + winnersUrl + '">Enter the Winners’ Lounge →</a>');
    goThrough();
  }

  /* ── the door opens and you walk through it ────────────────────────── */
  var through = $('vt-through'), openVid = $('vt-open'), endImg = $('vt-open-end');
  function src(v) { return (window.matchMedia('(max-width: 899px)').matches && v.dataset.srcSm) || v.dataset.src; }
  function goThrough() {
    if (REDUCED) { setTimeout(function () { location.href = winnersUrl; }, 1600); return; }
    var stage = $('vt-stage');
    stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { $('vt-stamp-ok').classList.add('in'); }, 250);
    setTimeout(function () {
      document.body.classList.add('is-through');
      through.classList.add('on');
      var done = false;
      function walk() {
        if (done) return; done = true;
        through.classList.add('ended');
        requestAnimationFrame(function () { requestAnimationFrame(function () { through.classList.add('go'); }); });
        setTimeout(function () { location.href = winnersUrl + (winnersUrl.indexOf('?') < 0 ? '?' : '&') + 'from=vault'; }, 2300);
      }
      if (/Apple/.test(navigator.vendor || '')) {
        // Safari plays an mp4 through <img> with no play button; it loops, so stop at its length
        var img = new Image(); img.alt = '';
        img.onload = function () { through.insertBefore(img, endImg); setTimeout(walk, 5000); };
        img.onerror = walk;
        img.src = src(openVid);
        setTimeout(function () { if (!img.complete) walk(); }, 3500);
      } else {
        openVid.src = src(openVid); openVid.muted = true;
        openVid.addEventListener('ended', walk, { once: true });
        openVid.addEventListener('error', walk, { once: true });
        var p = openVid.play(); if (p && p.catch) p.catch(walk);
        setTimeout(function () { if (openVid.currentTime < 0.2) walk(); }, 3500);
        setTimeout(walk, 8000);
      }
    }, 1100);
  }

  /* ── restore an earlier result ─────────────────────────────────────── */
  if (solved) {
    lockUp(); label.textContent = 'Unlocked'; note.textContent = '';
    $('vt-stamp-ok').classList.add('in');
    showResult(true, '<span class="h">Case closed</span>You opened this one. ' + answerText() + ' <a href="' + winnersUrl + '">Back to the Winners’ Lounge →</a>');
  } else if (tried) {
    lockUp(); label.textContent = 'Locked'; note.textContent = '';
    $('vt-stamp-no').classList.add('in'); card.classList.add('stamped');
    showResult(false, '<span class="h">Attempt used</span>' + answerText() + ' A new riddle opens in ' + nextEl.textContent + '.');
  }

  /* ── reveal on scroll; the riddle's ink bars lift ──────────────────── */
  document.querySelectorAll('.vt-head, .vt-stage, .vt-card, .vt-past').forEach(function (n, i) { n.classList.add('vt-rv'); n.style.setProperty('--rd', (i * 0.08) + 's'); });
  if (REDUCED || !('IntersectionObserver' in window)) {
    document.querySelectorAll('.vt-rv').forEach(function (n) { n.classList.add('in'); });
    card.classList.add('open');
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        e.target.classList.add('in');
        if (e.target === card) setTimeout(function () { card.classList.add('open'); }, 350);
      });
    }, { threshold: 0.2 });
    document.querySelectorAll('.vt-rv').forEach(function (n) { io.observe(n); });
  }

  /* ── the drawing comes alive (Safari plays the mp4 through <img>) ─── */
  (function idle() {
    var v = $('vt-idle'), still = $('vt-still'), conn = navigator.connection || {};
    if (!v || REDUCED || conn.saveData || /(^|-)2g/.test(conn.effectiveType || '')) return;
    var fig = v.parentNode, s = src(v), started = false;
    function asImage(fallback) {
      var img = new Image(); img.className = 'vt-idle'; img.alt = ''; img.decoding = 'async';
      img.onload = function () { fig.replaceChild(img, v); requestAnimationFrame(function () { requestAnimationFrame(function () { img.classList.add('is-playing'); }); }); };
      img.onerror = fallback; img.src = s;
    }
    function asVideo() {
      v.muted = true; v.autoplay = true; v.preload = 'auto';
      v.addEventListener('playing', function () { v.classList.add('is-playing'); }, { once: true });
      v.src = s;
      var onScreen = true;
      function play() { if (onScreen && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
      if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; if (onScreen) play(); else v.pause(); }).observe(fig);
      else play();
    }
    function go() { if (started) return; started = true; if (/Apple/.test(navigator.vendor || '')) asImage(asVideo); else asVideo(); }
    if (still.complete) setTimeout(go, 0); else { still.addEventListener('load', go, { once: true }); still.addEventListener('error', go, { once: true }); }
  })();
})();
