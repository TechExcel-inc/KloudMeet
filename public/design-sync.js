/*
 * Kloud Meet design sync — include in a hosted design page:
 *   <script src="https://meet.kloud.cn/design-sync.js" defer></script>
 *
 * When the page is shown in a meeting's Design mode, it tells the meeting which page this is,
 * how big the document is and where it is scrolled, and scrolls when the presenter does.
 * It only talks to the site it was loaded from (the meeting), and does nothing on its own.
 */
(function () {
  'use strict';
  if (window.parent === window) return;
  var script = document.currentScript;
  if (!script || !script.src) return;
  var meetingOrigin;
  try {
    meetingOrigin = new URL(script.src).origin;
  } catch (e) {
    return;
  }

  var VERSION = 1;
  var scroller = document.scrollingElement || document.documentElement;

  function post(type, data) {
    var msg = { source: 'kloud-design', v: VERSION, type: type };
    for (var k in data) msg[k] = data[k];
    window.parent.postMessage(msg, meetingOrigin);
  }

  function state() {
    return {
      href: location.href,
      title: document.title || '',
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      docWidth: Math.round(scroller.scrollWidth),
      docHeight: Math.round(scroller.scrollHeight),
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight,
    };
  }

  function hello() {
    post('hello', state());
  }

  var scrollQueued = false;
  window.addEventListener(
    'scroll',
    function () {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(function () {
        scrollQueued = false;
        post('scroll', { href: location.href, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) });
      });
    },
    { passive: true },
  );

  var lastSize = '';
  function reportSize() {
    var s = state();
    var key = s.docWidth + 'x' + s.docHeight + '/' + s.viewWidth + 'x' + s.viewHeight;
    if (key === lastSize) return;
    lastSize = key;
    post('size', s);
  }
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.documentElement);
  window.addEventListener('resize', reportSize);

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.origin !== meetingOrigin) return;
    var data = event.data;
    if (!data || data.source !== 'kloud-meet') return;
    if (data.type === 'ping') {
      hello();
    } else if (data.type === 'scrollTo' && isFinite(data.x) && isFinite(data.y)) {
      window.scrollTo({ left: data.x, top: data.y, behavior: data.smooth ? 'smooth' : 'auto' });
    } else if (data.type === 'scrollBy' && isFinite(data.dx) && isFinite(data.dy)) {
      window.scrollBy({ left: data.dx, top: data.dy, behavior: 'auto' });
    }
  });

  // Links to other sites open in a new tab instead of replacing the design in the meeting.
  document.addEventListener(
    'click',
    function (event) {
      var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!a) return;
      try {
        if (new URL(a.href, location.href).origin !== location.origin) a.target = '_blank';
      } catch (e) {
        /* ignore */
      }
    },
    true,
  );

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello);
  else hello();
  window.addEventListener('load', reportSize);
})();
