// Numbered-callout overlay for guide screenshots.
//
// Inject AFTER anonymize.js, with the badge list set first:
//
//   window.__ANNOTATE__ = [ { sel: '#some-field', n: 1, dx: -14, dy: -14 }, ... ];
//   // then evaluate this file, then screenshot
//
// Each entry draws a numbered gold circle anchored to the top-left corner of
// the element matched by `sel` (dx/dy nudge in pixels). Badges are fixed-
// position and pointer-transparent, so they never affect the page. Re-running
// clears previous badges first.

(function () {
  'use strict';
  document.querySelectorAll('.anon-badge').forEach((el) => el.remove());
  (window.__ANNOTATE__ || []).forEach(function (a) {
    var el = document.querySelector(a.sel);
    if (!el) return;
    var r = el.getBoundingClientRect();
    var b = document.createElement('div');
    b.className = 'anon-badge';
    b.textContent = a.n;
    b.style.cssText = 'position:fixed;z-index:2147483647;width:28px;height:28px;' +
      'border-radius:50%;background:#b45309;color:#fff;' +
      'font:700 15px/28px system-ui,sans-serif;text-align:center;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.45);pointer-events:none;';
    b.style.left = (r.left + (a.dx !== undefined ? a.dx : -14)) + 'px';
    b.style.top = (r.top + (a.dy !== undefined ? a.dy : -14)) + 'px';
    document.body.appendChild(b);
  });
})();
