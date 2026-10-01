/* ============================================================
   Book Reviews page chrome (the reviews themselves, search, the
   reader-pick form and modals all live in js/book-reviews.js).
   Here: the gentle reveals, the hero loop, and the extra
   "recommend a book" link in the About section.
   ============================================================ */
(function () {
  'use strict';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- reveals ---------- */
  var els = document.querySelectorAll('[data-reveal], [data-reveal-art]');
  if (REDUCED || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- "recommend a book" from the About section ---------- */
  document.querySelectorAll('[data-open-submit]').forEach(function (b) {
    b.addEventListener('click', function () { var o = document.getElementById('br-open-submit'); if (o) o.click(); });
  });

  /* ---------- hero loop ----------
     Same approach as the Articles hero: Safari (and every iOS browser)
     shows the .mp4 through <img>, which loops silently with no play button
     and needs no autoplay permission; everyone else gets a muted inline
     <video> that plays only while on screen. The still stays underneath
     and the loop fades in over it once it is actually moving. */
  (function heroLoop() {
    var v = document.querySelector('.bx-loop');
    var still = document.querySelector('.bx-still');
    var conn = navigator.connection || {};
    if (!v || REDUCED || conn.saveData || /(^|-)2g/.test(conn.effectiveType || '')) return;
    var fig = v.parentNode;
    var src = (window.matchMedia('(max-width: 899px)').matches && v.dataset.srcSm) || v.dataset.src;
    var started = false;

    function asImage(fallback) {
      var img = new Image();
      img.className = 'bx-loop';
      img.alt = ''; img.setAttribute('aria-hidden', 'true'); img.decoding = 'async';
      img.onload = function () {
        fig.replaceChild(img, v);
        requestAnimationFrame(function () { requestAnimationFrame(function () { img.classList.add('is-playing'); }); });
      };
      img.onerror = fallback;
      img.src = src;
    }
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
    if (!still || still.complete) setTimeout(start, 0);
    else { still.addEventListener('load', start, { once: true }); still.addEventListener('error', start, { once: true }); }
  })();
})();
