/* ════════════════════════════════════════════════════════════════════
   THE CATALYST VAULT — behaviour for /brain-teaser
   Everything about the puzzle itself comes from js/brain-teaser-case.js
   (window.CATALYST_CASE / CATALYST_ARCHIVE); this file never changes
   between cases.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var CASE = window.CATALYST_CASE || {};
  var ARCHIVE = window.CATALYST_ARCHIVE || [];
  var ANS = CASE.answer || { type: 'code', length: 4, hashes: [] };
  var IS_CODE = ANS.type !== 'text';
  var LEN = IS_CODE ? Math.max(1, Math.min(8, ANS.length || 4)) : 0;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TOUCH = window.matchMedia('(hover: none)').matches;
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n, l) { return String(n).padStart(l || 2, '0'); };
  var caseNo = pad(CASE.number || 0);
  var store = (function () {
    try { var k = '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } }; }
  })();
  var KEY = CASE.storageKey || ('case-' + caseNo);
  var KEY_SOLVED = 'catalystVaultSolved_' + KEY;
  var KEY_ATTEMPTED = 'catalystVaultAttempted_' + KEY;
  var KEY_DECODED = 'catalystVaultDecoded_' + KEY;

  /* ── helpers ───────────────────────────────────────────────────── */
  function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function hash(s) {
    var data = new TextEncoder().encode('catalyst-vault:' + normalize(s));
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function encode(html) {
    var bytes = new TextEncoder().encode(html), bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function decode(b64) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(b64 || ''), function (c) { return c.charCodeAt(0); })); }
    catch (e) { return ''; }
  }
  window.CatalystVault = { hash: hash, encode: encode };

  /* ── sound (off by default, synthesized, no files) ────────────────── */
  var audio = null, soundOn = store.getItem('catalystVaultSound') === 'on';
  function ctx() {
    if (!audio) { var A = window.AudioContext || window.webkitAudioContext; if (!A) return null; audio = new A(); }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, type, vol, when) {
    if (!soundOn) return;
    var a = ctx(); if (!a) return;
    var t = a.currentTime + (when || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.04, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  var sfx = {
    key: function () { tone(1350, 0.05, 'square', 0.025); },
    tick: function () { tone(2200, 0.02, 'square', 0.015); },
    decode: function () { tone(880, 0.06, 'sine', 0.03); tone(1320, 0.06, 'sine', 0.025, 0.06); },
    arm: function () { tone(520, 0.12, 'triangle', 0.04); tone(780, 0.16, 'triangle', 0.04, 0.1); },
    open: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.35, 'triangle', 0.05, i * 0.11); }); },
    deny: function () { tone(150, 0.5, 'sawtooth', 0.05); tone(110, 0.6, 'sawtooth', 0.05, 0.18); }
  };
  var soundBtn = $('bt-sound');
  soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  soundBtn.addEventListener('click', function () {
    soundOn = !soundOn;
    store.setItem('catalystVaultSound', soundOn ? 'on' : 'off');
    soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    if (soundOn) sfx.arm();
  });

  /* ── fill in the case ──────────────────────────────────────────── */
  var codename = CASE.codename || 'The Catalyst Vault';
  $('bt-title').textContent = codename;
  $('bt-title').setAttribute('data-text', codename);
  $('bt-caseno').textContent = 'Case ' + caseNo;
  $('bt-class').textContent = CASE.classification || 'Top Secret // Eyes Only';
  $('bt-brief').innerHTML = CASE.brief || '';
  $('bt-hud-case').textContent = 'Case ' + caseNo + ' · ' + codename;
  $('bt-file-id').textContent = 'REF CTLST-' + caseNo;
  $('bt-odds').textContent = IS_CODE ? '1 in ' + Math.pow(10, LEN).toLocaleString('en-US') : 'Next to none';
  document.title = codename + ' · The Catalyst Vault | The Catalyst Magazine';
  var winners = $('bt-winners');
  winners.href = CASE.winnersUrl || '/';

  /* intercepts: every word sits under a redaction bar until it scrolls in */
  var decoded = {};
  try { decoded = JSON.parse(store.getItem(KEY_DECODED) || '{}'); } catch (e) {}
  var list = $('bt-intercepts');
  (CASE.clues || []).forEach(function (c, i) {
    var li = document.createElement('li');
    li.className = 'bt-int';
    var sig = (14.2 + i * 3.37).toFixed(2);
    li.innerHTML =
      '<div class="bt-int-tag"><span>' + (c.tag || ('Intercept ' + pad(i + 1))) + '</span>' +
      '<svg class="bt-wave" viewBox="0 0 72 18" aria-hidden="true"><path d="M0 9 Q4 ' + (2 + i) + ' 8 9 T16 9 T24 9 T32 9 T40 9 T48 9 T56 9 T64 9 T72 9"/></svg>' +
      '<span class="bt-int-sig">SIG ' + sig + ' MHz</span></div>' +
      '<span class="bt-int-num" aria-hidden="true">' + pad(i + 1) + '</span>' +
      '<p class="bt-int-text">' + c.text + '</p>';
    var p = li.querySelector('.bt-int-text');
    wrapWords(p);
    var done = document.createElement('button');
    done.type = 'button'; done.className = 'bt-int-done';
    done.setAttribute('aria-pressed', decoded[i] ? 'true' : 'false');
    done.innerHTML = decoded[i] ? '✓ Decoded' : 'Mark decoded';
    done.addEventListener('click', function () {
      decoded[i] = !decoded[i];
      store.setItem(KEY_DECODED, JSON.stringify(decoded));
      done.setAttribute('aria-pressed', decoded[i] ? 'true' : 'false');
      done.innerHTML = decoded[i] ? '✓ Decoded' : 'Mark decoded';
      if (decoded[i]) sfx.decode();
    });
    li.appendChild(done);
    list.appendChild(li);
  });
  function wrapWords(root) {
    var n = 0, walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (t) {
      var frag = document.createDocumentFragment();
      t.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
        var s = document.createElement('span');
        s.className = 'rd'; s.textContent = part;
        s.style.setProperty('--d', (n++ * 0.035).toFixed(3) + 's');
        frag.appendChild(s);
      });
      t.parentNode.replaceChild(frag, t);
    });
  }

  /* archive */
  var arch = $('bt-archive');
  ARCHIVE.forEach(function (a) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'bt-archive-card rv';
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML =
      '<span class="no"><span>Case ' + pad(a.number) + '</span><b>Declassified</b></span>' +
      '<h3>' + a.codename + '</h3><span class="kind">' + (a.kind || '') + '</span>' +
      '<p>' + a.prompt + '</p>' +
      '<div class="ans"><span class="v">' + a.answer + '</span><span class="tap">Tap to reveal</span><small>' + (a.explain || '') + '</small></div>';
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) sfx.decode();
    });
    arch.appendChild(b);
  });
  if (!ARCHIVE.length) document.querySelector('.bt-archive').hidden = true;

  /* ── the dial ──────────────────────────────────────────────────── */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var dial = $('bt-dial');
  var rings = [], rot = [];
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  (function buildDial() {
    var ticks = el('g', { class: 'ticks' }, dial);
    for (var t = 0; t < 72; t++) {
      var a = t * 5 * Math.PI / 180, r1 = 188, r2 = t % 6 ? 192 : 197;
      el('line', { x1: Math.sin(a) * r1, y1: -Math.cos(a) * r1, x2: Math.sin(a) * r2, y2: -Math.cos(a) * r2 }, ticks);
    }
    var n = IS_CODE ? LEN : 3;
    var outer = 166, inner = 76, step = n > 1 ? (outer - inner) / (n - 1) : 0;
    var thick = Math.min(26, Math.max(16, step - 6));
    for (var i = 0; i < n; i++) {
      var r = outer - i * step;
      var g = el('g', { class: 'ring' }, dial);
      el('circle', { class: 'ring-track', r: r, 'stroke-width': thick }, g);
      el('circle', { class: 'ring-edge', r: r + thick / 2 }, g);
      el('circle', { class: 'ring-edge', r: r - thick / 2 }, g);
      var digits = el('g', { class: 'digits' }, g);
      for (var d = 0; d < 10; d++) {
        var ang = d * 36;
        var tx = el('text', { x: 0, y: -r, transform: 'rotate(' + ang + ')', 'font-size': Math.max(10, Math.min(14, thick * 0.55)) }, digits);
        tx.textContent = d;
      }
      rings.push({ g: g, digits: digits, texts: digits.querySelectorAll('text') });
      rot.push(0);
    }
    el('line', { class: 'marker-line', x1: 0, y1: -200, x2: 0, y2: -(inner - 20) }, dial);
    el('path', { class: 'marker', d: 'M-7 -206 L7 -206 L0 -194 Z' }, dial);
    var prog = el('circle', { class: 'progress', r: 182, 'stroke-dasharray': '0 1200' }, dial);
    dial._prog = prog;
  })();
  function turnRing(i, digit, extraTurns) {
    var ring = rings[i]; if (!ring) return;
    // always turn forward to the new digit, like a real combination dial
    var target = -digit * 36, cur = rot[i];
    var base = Math.floor(cur / 360) * 360 + (((target % 360) + 360) % 360);
    if (base > cur) base -= 360;
    var next = base - 360 * (extraTurns || 0);
    if (next === cur) next -= 360;
    rot[i] = next;
    ring.digits.style.transform = 'rotate(' + next + 'deg)';
    ring.texts.forEach(function (t, d) { t.classList.toggle('hit', d === digit); });
  }
  function clearRing(i) {
    var ring = rings[i]; if (!ring) return;
    ring.g.classList.remove('set');
    ring.texts.forEach(function (t) { t.classList.remove('hit'); });
  }
  // decorative idle drift on rings that aren't set yet
  var idle = null;
  function idleDrift(on) {
    clearInterval(idle);
    if (!on || REDUCED) return;
    idle = setInterval(function () {
      rings.forEach(function (r, i) {
        if (r.g.classList.contains('set')) return;
        rot[i] += (i % 2 ? 1 : -1) * (6 + Math.random() * 10);
        r.digits.style.transform = 'rotate(' + rot[i] + 'deg)';
      });
    }, 1400);
  }

  /* ── entry ─────────────────────────────────────────────────────── */
  var entry = $('bt-entry'), hint = $('bt-hint'), breachBtn = $('bt-breach'), breachLabel = $('bt-breach-label');
  var input, boxes = [], value = '', wasReady = false;
  var solved = store.getItem(KEY_SOLVED) === 'true';
  var attempted = store.getItem(KEY_ATTEMPTED) === 'true';
  var locked = solved || attempted;

  if (IS_CODE) {
    var boxWrap = document.createElement('div');
    boxWrap.className = 'bt-boxes';
    boxWrap.setAttribute('role', 'group');
    boxWrap.setAttribute('aria-label', LEN + '-digit access code');
    for (var b = 0; b < LEN; b++) { var bx = document.createElement('div'); bx.className = 'bt-box'; boxes.push(bx); boxWrap.appendChild(bx); }
    input = document.createElement('input');
    input.className = 'bt-code-input'; input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = LEN;
    input.autocomplete = 'off'; input.setAttribute('aria-label', 'Enter the ' + LEN + '-digit vault code');
    var keys = document.createElement('div');
    keys.className = 'bt-keys';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].forEach(function (k) {
      var kb = document.createElement('button');
      kb.type = 'button'; kb.className = 'bt-key' + (k.length > 1 ? ' fn' : '');
      kb.textContent = k === 'del' ? '⌫' : k === 'clear' ? 'Clear' : k;
      kb.setAttribute('aria-label', k === 'del' ? 'Delete last digit' : k === 'clear' ? 'Clear code' : 'Digit ' + k);
      kb.addEventListener('click', function () { press(k); });
      keys.appendChild(kb);
    });
    entry.appendChild(boxWrap); entry.appendChild(input); entry.appendChild(keys);
    boxWrap.addEventListener('click', function () { if (!locked) input.focus({ preventScroll: true }); });
    input.addEventListener('input', function () { setValue(input.value.replace(/\D/g, '').slice(0, LEN), true); });
  } else {
    var pass = document.createElement('label');
    pass.className = 'bt-pass';
    pass.innerHTML = '<span>&gt;_</span>';
    input = document.createElement('input');
    input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = 'Type the passphrase';
    input.setAttribute('aria-label', 'Your answer');
    pass.appendChild(input); entry.appendChild(pass);
    input.addEventListener('input', function () { setValue(input.value, true); });
  }

  function press(k) {
    if (locked || state === 'working') return;
    if (k === 'del') setValue(value.slice(0, -1), true);
    else if (k === 'clear') setValue('', true);
    else if (value.length < LEN) setValue(value + k, true);
  }
  function setValue(v, user) {
    var prev = value;
    value = v;
    if (input.value !== v) input.value = v;
    if (IS_CODE) {
      boxes.forEach(function (bx, i) {
        var ch = v[i] || '';
        if (bx.textContent !== ch) { bx.textContent = ch; if (ch && user) { bx.classList.remove('pop'); void bx.offsetWidth; bx.classList.add('pop'); } }
        bx.classList.toggle('filled', !!ch);
        bx.classList.toggle('active', !locked && i === v.length);
      });
      rings.forEach(function (r, i) {
        r.g.classList.toggle('active', !locked && i === v.length);
        if (v[i] != null) {
          if (prev[i] !== v[i]) { r.g.classList.add('set'); turnRing(i, +v[i], user ? 1 : 0); }
        } else clearRing(i);
      });
      if (user && v.length > prev.length) sfx.key();
    } else if (user && v.length > prev.length) sfx.key();
    var ready = IS_CODE ? v.length === LEN : normalize(v).length > 0;
    breachBtn.disabled = locked || !ready;
    if (!locked) {
      hint.textContent = ready
        ? (TOUCH ? 'Armed. Press and hold the button to breach.' : 'Armed. Hold the button (or hold Enter) to breach.')
        : IS_CODE ? 'Key in ' + LEN + ' digits  ·  ' + v.length + '/' + LEN : 'Type your answer';
    }
    if (ready && !wasReady && user) sfx.arm();
    wasReady = ready;
  }

  // type anywhere on the page (not inside other fields)
  document.addEventListener('keydown', function (e) {
    if (locked || state === 'working' || introRunning) return;
    var t = e.target;
    if (t !== input && t && t.matches && t.matches('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (IS_CODE) {
      if (/^[0-9]$/.test(e.key) && t !== input) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace' && t !== input) { e.preventDefault(); press('del'); }
    }
    if (e.key === 'Enter' && !breachBtn.disabled && !e.repeat) { e.preventDefault(); startHold(); }
  });
  document.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') stopHold(); });

  /* ── hold to breach ────────────────────────────────────────────── */
  var HOLD_MS = REDUCED ? 500 : 1200, holdT0 = 0, holdRaf = 0, holding = false, held = 0;
  function startHold() {
    if (breachBtn.disabled || holding) return;
    holding = true; holdT0 = performance.now() - held * HOLD_MS;
    breachLabel.textContent = 'Breaching…';
    var lastTick = 0;
    (function step(now) {
      if (!holding) return;
      held = Math.min(1, (now - holdT0) / HOLD_MS);
      breachBtn.style.setProperty('--hold', held.toFixed(3));
      if (now - lastTick > 90) { sfx.tick(); lastTick = now; }
      if (held >= 1) { holding = false; breach(); return; }
      holdRaf = requestAnimationFrame(step);
    })(performance.now());
  }
  function stopHold() {
    if (!holding) return;
    holding = false; cancelAnimationFrame(holdRaf);
    breachLabel.textContent = 'Hold to breach';
    (function back() {
      held = Math.max(0, held - 0.08);
      breachBtn.style.setProperty('--hold', held.toFixed(3));
      if (held > 0 && !holding) requestAnimationFrame(back);
    })();
  }
  breachBtn.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; breachBtn.setPointerCapture(e.pointerId); startHold(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { breachBtn.addEventListener(ev, stopHold); });
  breachBtn.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); startHold(); } });
  breachBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ── status ────────────────────────────────────────────────────── */
  var state = 'locked';
  var STATUS = { locked: 'Vault locked', working: 'Decrypting', open: 'Vault open', denied: 'Access denied' };
  function setState(s) {
    state = s;
    document.body.classList.remove('st-locked', 'st-working', 'st-open', 'st-denied');
    document.body.classList.add('st-' + s);
    $('bt-status-text').textContent = STATUS[s];
  }
  setState('locked');

  /* ── the breach ────────────────────────────────────────────────── */
  function breach() {
    if (locked) return;
    locked = true;
    store.setItem(KEY_ATTEMPTED, 'true');      // the one attempt is spent the moment you breach
    $('bt-attempts').textContent = '0';
    breachBtn.disabled = true;
    input.disabled = true;
    entry.querySelectorAll('button').forEach(function (k) { k.disabled = true; });
    boxes.forEach(function (bx) { bx.classList.remove('active'); });
    rings.forEach(function (r) { r.g.classList.remove('active'); });
    setState('working');
    breachLabel.textContent = 'Decrypting…';
    idleDrift(false);

    var entered = value;
    var checking = hash(entered).then(function (h) { return (ANS.hashes || []).indexOf(h) !== -1; })
      .catch(function () { return false; });
    var dur = REDUCED ? 300 : 2200, t0 = performance.now(), prog = dial._prog, C = 2 * Math.PI * 182;
    var spin = REDUCED ? null : setInterval(function () {
      rings.forEach(function (r, i) {
        rot[i] -= 140 + i * 50 + Math.random() * 60;
        r.digits.style.transform = 'rotate(' + rot[i] + 'deg)';
      });
      sfx.tick();
    }, 120);
    var HEX = '0123456789ABCDEF';
    (function tick(now) {
      var p = Math.min(1, (now - t0) / dur);
      prog.setAttribute('stroke-dasharray', (p * C).toFixed(1) + ' ' + C.toFixed(1));
      var scr = ''; for (var k = 0; k < 10; k++) scr += HEX[(Math.random() * 16) | 0];
      hint.textContent = 'DECRYPTING 0x' + scr + '  ' + Math.floor(p * 100) + '%';
      if (p < 1) requestAnimationFrame(tick);
      else checking.then(function (ok) {
        clearInterval(spin);
        prog.setAttribute('stroke-dasharray', '0 ' + C.toFixed(1));
        if (IS_CODE) entered.split('').forEach(function (d, i) { turnRing(i, +d, 0); });
        setTimeout(function () { ok ? granted() : denied(); }, REDUCED ? 0 : 600);
      });
    })(t0);
  }

  function solutionHtml() { return decode(CASE.solution64); }
  function granted() {
    store.setItem(KEY_SOLVED, 'true');
    setState('open');
    sfx.open();
    breachLabel.textContent = 'Vault open';
    hint.textContent = 'Access granted';
    playOpening(function () {
      showResult(true, '<span class="head">Access granted</span>' + solutionHtml() + ' Welcome to the Winners’ Lounge.');
      winners.hidden = false;
      burst();
    });
  }
  function denied() {
    setState('denied');
    sfx.deny();
    breachLabel.textContent = 'Access denied';
    hint.textContent = 'That was your one attempt.';
    var alarm = $('bt-alarm');
    alarm.classList.remove('on'); void alarm.offsetWidth; alarm.classList.add('on');
    var wrap = $('bt-dial-wrap');
    wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake');
    showResult(false, '<span class="head">Access denied</span>That was your one attempt. ' + solutionHtml() + ' A new case lands soon — get it first below.');
  }
  function showResult(ok, html) {
    var r = $('bt-result');
    r.className = 'bt-result show ' + (ok ? 'ok' : 'no');
    r.innerHTML = html;
  }

  /* the door opens: the film, then a flash of light */
  var openVideo = $('bt-open-video'), opening = $('bt-opening');
  function openSrc() { return (window.matchMedia('(max-width: 899px)').matches && openVideo.dataset.srcSm) || openVideo.dataset.src; }
  function playOpening(done) {
    if (REDUCED) { done(); return; }
    var finished = false;
    function finish() {
      if (finished) return; finished = true;
      opening.classList.add('flash');
      setTimeout(function () { opening.classList.remove('on'); done(); }, 700);
      setTimeout(function () { opening.classList.remove('flash'); }, 1600);
    }
    opening.classList.add('on');
    var safari = /Apple/.test(navigator.vendor || '');
    if (safari) {
      var img = new Image();
      img.alt = '';
      img.onload = function () { opening.insertBefore(img, opening.firstChild); setTimeout(finish, 4600); };
      img.onerror = finish;
      img.src = openSrc();
      setTimeout(function () { if (!img.complete) finish(); }, 3000);
    } else {
      openVideo.src = openSrc();
      openVideo.muted = true;
      openVideo.addEventListener('ended', finish, { once: true });
      openVideo.addEventListener('error', finish, { once: true });
      var p = openVideo.play();
      if (p && p.catch) p.catch(finish);
      setTimeout(function () { if (openVideo.currentTime < 0.2) finish(); }, 3000);
      setTimeout(finish, 7000);
    }
  }

  /* celebration particles */
  function burst() {
    if (REDUCED) return;
    var c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:75;pointer-events:none';
    document.body.appendChild(c);
    var x = c.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; x.scale(dpr, dpr);
    var cols = ['#3ee69a', '#2dd4bf', '#7af5e2', '#f5b544', '#ffffff'];
    var parts = [];
    var rect = $('bt-dial-wrap').getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (var i = 0; i < 160; i++) {
      var a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, r: 1.5 + Math.random() * 3, c: cols[i % cols.length], life: 1 });
    }
    var t0 = performance.now();
    (function frame(now) {
      x.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += 0.18; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.life -= 0.009;
        x.globalAlpha = Math.max(0, p.life);
        x.fillStyle = p.c; x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); x.fill();
      });
      if (now - t0 < 2600) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /* ── restore a past result ─────────────────────────────────────── */
  function restore() {
    if (!solved && !attempted) { setValue('', false); return; }
    locked = true;
    input.disabled = true;
    entry.querySelectorAll('button').forEach(function (k) { k.disabled = true; });
    breachBtn.disabled = true;
    $('bt-attempts').textContent = '0';
    setValue('', false);
    if (solved) {
      setState('open');
      breachLabel.textContent = 'Vault open';
      hint.textContent = 'You cracked this case.';
      rings.forEach(function (r) { r.g.classList.add('set'); });
      showResult(true, '<span class="head">Case closed</span>You already cracked this one. ' + solutionHtml());
      winners.hidden = false;
    } else {
      setState('denied');
      breachLabel.textContent = 'Attempt used';
      hint.textContent = 'Your one attempt is spent. The next case is on its way.';
      showResult(false, '<span class="head">Attempt used</span>' + solutionHtml());
    }
  }
  restore();
  if (!locked) idleDrift(true);

  /* ── clocks ────────────────────────────────────────────────────── */
  var started = Date.now();
  var cd = $('bt-countdown'), cdU = {};
  cd.querySelectorAll('[data-u]').forEach(function (s) { cdU[s.dataset.u] = s; });
  var drop = Date.parse(CASE.nextDropAt || '');
  function tickClocks() {
    var now = new Date();
    $('bt-utc').textContent = pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());
    var s = Math.floor((Date.now() - started) / 1000);
    $('bt-session').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    if (isFinite(drop)) {
      var left = Math.max(0, Math.floor((drop - Date.now()) / 1000));
      if (left === 0) { cd.textContent = 'Incoming…'; return; }
      cdU.d.textContent = pad(Math.floor(left / 86400));
      cdU.h.textContent = pad(Math.floor(left % 86400 / 3600));
      cdU.m.textContent = pad(Math.floor(left % 3600 / 60));
      cdU.s.textContent = pad(left % 60);
    } else cd.textContent = 'Soon';
  }
  tickClocks(); setInterval(tickClocks, 1000);

  /* ── reveals ───────────────────────────────────────────────────── */
  document.querySelectorAll('.bt-hero > *, .bt-file, .bt-lock, .bt-section-head, .bt-signup').forEach(function (n, i) {
    n.classList.add('rv'); n.style.setProperty('--rd', (Math.min(i, 6) * 0.07) + 's');
  });
  var ints = Array.prototype.slice.call(document.querySelectorAll('.bt-int'));
  function revealAll() { document.querySelectorAll('.rv').forEach(function (n) { n.classList.add('in'); }); ints.forEach(function (n) { n.classList.add('open'); }); }
  function observe() {
    if (REDUCED || !('IntersectionObserver' in window)) { revealAll(); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var t = e.target;
        io.unobserve(t);
        if (t.classList.contains('bt-int')) { setTimeout(function () { t.classList.add('open'); sfx.decode(); }, 250 + ints.indexOf(t) * 160); }
        else t.classList.add('in');
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.rv, .bt-int').forEach(function (n) { io.observe(n); });
  }

  /* title: letters scramble, then lock into place */
  function scramble(elm, done) {
    var text = elm.getAttribute('data-text') || elm.textContent;
    if (REDUCED) { elm.textContent = text; if (done) done(); return; }
    var G = '!<>-_\\/[]{}=+*^?#ABCDEFGHJKLMNPRSTUVWXYZ0123456789', frame = 0, total = 42;
    (function step() {
      var out = '';
      for (var i = 0; i < text.length; i++) {
        var lock = (i / text.length) * total * 0.8;
        out += text[i] === ' ' || frame > lock + 6 ? text[i] : G[(Math.random() * G.length) | 0];
      }
      elm.textContent = out;
      if (++frame <= total) requestAnimationFrame(step); else { elm.textContent = text; if (done) done(); }
    })();
  }

  /* ── intro: biometric check, blast doors ───────────────────────── */
  var intro = $('bt-intro'), introRunning = false;
  function afterIntro() {
    introRunning = false;
    document.body.classList.remove('is-intro');
    observe();
    var title = $('bt-title');
    scramble(title, function () { title.classList.add('glitch'); });
    setTimeout(function () { document.querySelector('.bt-stamp').classList.add('in'); }, 900);
    startLoop();
  }
  (function runIntro() {
    var seen = false;
    try { seen = sessionStorage.getItem('catalystVaultIntro') === '1'; } catch (e) {}
    if (REDUCED || seen) { intro.hidden = true; afterIntro(); return; }
    try { sessionStorage.setItem('catalystVaultIntro', '1'); } catch (e) {}
    introRunning = true;
    document.body.classList.add('is-intro');
    var log = $('bt-log'), fill = $('bt-intro-fill');
    var lines = [
      [180, '<span class="k">$</span> ./vault --case ' + caseNo + ' --secure'],
      [520, '&gt; establishing encrypted channel ........ <span class="ok">ok</span>'],
      [860, '&gt; biometric signature ................... <span class="ok">match</span>'],
      [1200, '&gt; clearance: <span class="warn">level 4 // eyes only</span>'],
      [1540, '&gt; decrypting case file ' + caseNo + ' ............ <span class="ok">done</span>'],
      [1900, '&gt; <span class="ok">ACCESS GRANTED</span>']
    ];
    var timers = [], t0 = performance.now(), TOTAL = 2300, ended = false;
    lines.forEach(function (l) { timers.push(setTimeout(function () { var d = document.createElement('div'); d.innerHTML = l[1]; log.appendChild(d); sfx.tick(); }, l[0])); });
    (function prog(now) { var p = Math.min(1, (now - t0) / TOTAL); fill.style.width = (p * 100) + '%'; if (p < 1 && !ended) requestAnimationFrame(prog); })(t0);
    timers.push(setTimeout(function () { intro.classList.add('granted'); sfx.arm(); }, 1900));
    timers.push(setTimeout(open, TOTAL + 150));
    function open() {
      if (ended) return; ended = true;
      timers.forEach(clearTimeout);
      fill.style.width = '100%';
      intro.classList.add('granted', 'open');
      setTimeout(afterIntro, 450);
      setTimeout(function () { intro.hidden = true; }, 1200);
    }
    $('bt-intro-skip').addEventListener('click', open);
    intro.addEventListener('click', open);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { open(); document.removeEventListener('keydown', esc); } });
  })();

  /* ── the vault film behind everything ──────────────────────────── */
  function startLoop() {
    var v = $('bt-loop'), still = $('bt-still');
    var conn = navigator.connection || {};
    if (!v || REDUCED || conn.saveData || /(^|-)2g/.test(conn.effectiveType || '')) return;
    var fig = v.parentNode;
    var src = (window.matchMedia('(max-width: 899px)').matches && v.dataset.srcSm) || v.dataset.src;
    function asImage(fallback) {   // Safari plays an mp4 through <img>: silent loop, no play button
      var img = new Image();
      img.className = 'bt-loop'; img.alt = ''; img.decoding = 'async';
      img.onload = function () { fig.replaceChild(img, v); requestAnimationFrame(function () { requestAnimationFrame(function () { img.classList.add('is-playing'); }); }); };
      img.onerror = fallback;
      img.src = src;
    }
    function asVideo() {
      v.muted = true; v.autoplay = true; v.preload = 'auto';
      v.addEventListener('playing', function () { v.classList.add('is-playing'); }, { once: true });
      v.src = src;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      document.addEventListener('visibilitychange', function () { if (document.hidden) v.pause(); else { var q = v.play(); if (q && q.catch) q.catch(function () {}); } });
    }
    var go = function () { if (/Apple/.test(navigator.vendor || '')) asImage(asVideo); else asVideo(); };
    if (still.complete) go(); else still.addEventListener('load', go, { once: true });
  }

  /* ── pointer: spotlight, parallax, dial tilt ───────────────────── */
  if (!TOUCH && !REDUCED) {
    var root = document.documentElement, stage = $('bt-stage'), spot = $('bt-spot'), dw = $('bt-dial-wrap');
    var px = 0, py = 0, raf = 0;
    window.addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        spot.style.setProperty('--mx', px + 'px'); spot.style.setProperty('--my', py + 'px');
        var nx = px / innerWidth - 0.5, ny = py / innerHeight - 0.5;
        stage.style.setProperty('--px', (-nx * 18).toFixed(1) + 'px');
        stage.style.setProperty('--py', (-ny * 12).toFixed(1) + 'px');
        var r = dw.getBoundingClientRect();
        var dx = (px - (r.left + r.width / 2)) / r.width, dy = (py - (r.top + r.height / 2)) / r.height;
        var near = Math.abs(dx) < 1.2 && Math.abs(dy) < 1.2;
        dw.style.setProperty('--ty', (near ? dx * 10 : 0).toFixed(2) + 'deg');
        dw.style.setProperty('--tx', (near ? -dy * 10 : 0).toFixed(2) + 'deg');
      });
    }, { passive: true });
  }

  /* ── signal network on the backdrop ────────────────────────────── */
  (function net() {
    var c = $('bt-net');
    if (!c || REDUCED) return;
    var x = c.getContext('2d'), dpr = Math.min(1.5, window.devicePixelRatio || 1), W, H, nodes = [], run = true;
    function size() {
      W = innerWidth; H = innerHeight;
      c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(70, W * H / 22000));
      nodes = [];
      for (var i = 0; i < n; i++) nodes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25 });
    }
    size(); window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', function () { run = !document.hidden; if (run) requestAnimationFrame(draw); });
    var last = 0;
    function draw(t) {
      if (!run) return;
      if (t - last > 33) {
        last = t;
        x.clearRect(0, 0, W, H);
        for (var i = 0; i < nodes.length; i++) {
          var a = nodes[i];
          a.x += a.vx; a.y += a.vy;
          if (a.x < 0 || a.x > W) a.vx *= -1;
          if (a.y < 0 || a.y > H) a.vy *= -1;
          for (var j = i + 1; j < nodes.length; j++) {
            var b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
            if (d2 < 15000) { x.strokeStyle = 'rgba(45,212,191,' + (0.16 * (1 - d2 / 15000)).toFixed(3) + ')'; x.lineWidth = 1; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
          }
          x.fillStyle = 'rgba(122,245,226,0.55)'; x.fillRect(a.x - 1, a.y - 1, 2, 2);
        }
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  })();

  /* ── next-transmission sign-up ─────────────────────────────────── */
  var form = $('bt-form'), msg = $('bt-form-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var body = { firstName: String(fd.get('firstName') || '').trim(), lastName: String(fd.get('lastName') || '').trim(), email: String(fd.get('email') || '').trim(), source: 'brain-teaser-vault' };
    if (!body.firstName || !body.lastName || !/^\S+@\S+\.\S+$/.test(body.email)) {
      msg.className = 'bt-form-msg no'; msg.textContent = 'Fill in your first name, last name and a valid email.'; return;
    }
    var btn = form.querySelector('button'); btn.disabled = true; msg.className = 'bt-form-msg'; msg.textContent = 'Opening the channel…';
    fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok !== false, j: j }; }); })
      .then(function (res) {
        if (res.ok) { msg.className = 'bt-form-msg ok'; msg.textContent = 'Channel open. Check your inbox to confirm — the next case comes to you first.'; form.reset(); sfx.decode(); }
        else { msg.className = 'bt-form-msg no'; msg.textContent = (res.j && res.j.error) || 'That didn’t go through. Try again in a moment.'; }
      })
      .catch(function () { msg.className = 'bt-form-msg no'; msg.textContent = 'No connection. Try again in a moment.'; })
      .then(function () { btn.disabled = false; });
  });
})();
