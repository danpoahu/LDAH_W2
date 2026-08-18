/* ═══════════════════════════════════════════════════════════════════════════
   Member portal — mobile shell
   ---------------------------------------------------------------------------
   MOBILE ONLY. Nothing in here runs above 900px: mount() returns early and no
   markup is created, so a desktop member sees the page exactly as before.
   The breakpoint is watched, so rotating a tablet or dragging a desktop window
   narrow mounts and unmounts cleanly rather than needing a reload.

   Two jobs:
     1. A bottom tab bar on EVERY member page. A tab bar that exists on two
        pages out of eight is worse than none — tapping "Events" would land you
        somewhere with no way back.
     2. On index.html, a welcome / status / menu block above the existing cards.

   The dashboard renders asynchronously after auth, so the home block is built
   from a MutationObserver on #view rather than on DOMContentLoaded. Reading
   the rendered DOM (rather than re-querying Firestore) means this can never
   disagree with what the page itself decided about membership or signups.

   Android is the primary target — see members-mobile.css for the 360px and
   safe-area notes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MQ = '(max-width: 900px)';
  var mounted = false;

  /* ── icons ──────────────────────────────────────────────────────────── */
  var I = {
    home:  '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    learn: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>',
    event: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    gear:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    cert:  '<circle cx="12" cy="9" r="5"/><path d="M8 14l-1 7 5-3 5 3-1-7"/>',
    pulse: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    play:  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
    doc:   '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/>',
    ask:   '<path d="M21 12a8 8 0 1 1-3-6.2L21 4v6h-6"/>',
    chev:  '<path d="M9 6l6 6-6 6"/>'
  };
  function svg(d, stroke) {
    return '<svg viewBox="0 0 24 24"' + (stroke ? ' stroke="' + stroke + '"' : '') + '>' + d + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── tab bar ────────────────────────────────────────────────────────── */
  var TABS = [
    { key: 'home',    href: 'index.html',         label: 'Home',     icon: I.home },
    { key: 'learn',   href: 'certification.html', label: 'Learning', icon: I.learn },
    { key: 'events',  href: 'index.html#eventsCard', label: 'Events', icon: I.event },
    { key: 'profile', href: 'profile.html',       label: 'Profile',  icon: I.gear }
  ];

  /* Which tab owns the page being viewed. Pages with no tab of their own
     (videos, resources, screenings, renew, summaries) light nothing rather
     than lighting the wrong thing — a lit tab that is not where you are is
     more confusing than none lit. */
  function currentTab() {
    var f = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (f === '' || f === 'index.html') return location.hash === '#eventsCard' ? 'events' : 'home';
    if (f === 'certification.html') return 'learn';
    if (f === 'profile.html') return 'profile';
    return '';
  }

  function buildTabBar() {
    if (document.querySelector('.mm-tabbar')) return;
    var on = currentTab();
    var html = '<nav class="mm-tabbar" role="navigation" aria-label="Member portal">';
    TABS.forEach(function (t) {
      html += '<a class="mm-tab' + (t.key === on ? ' on' : '') + '" href="' + t.href + '"'
            + (t.key === on ? ' aria-current="page"' : '') + '>'
            + svg(t.icon) + '<span>' + t.label + '</span></a>';
    });
    html += '</nav>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  /* ── home block ─────────────────────────────────────────────────────── */
  function tile(href, icon, colour, bg, title, sub, opts) {
    opts = opts || {};
    return '<a class="mm-tile' + (opts.locked ? ' locked' : '') + '" href="' + href + '">'
      + (opts.badge ? '<span class="mm-badge">' + esc(opts.badge) + '</span>' : '')
      + '<div class="mm-ico" style="background:' + bg + '">' + svg(icon, colour) + '</div>'
      + '<div><b>' + esc(title) + '</b><span>' + sub + '</span></div></a>';
  }

  /* Everything below is READ from the rendered dashboard, never re-fetched, so
     the mobile block cannot contradict the desktop cards sitting under it. */
  function readState() {
    var s = { name: '', active: null, renews: '', signups: 0, screenings: false };

    var pill = document.querySelector('#view .pill');
    if (pill) s.active = /active/i.test(pill.textContent) && !/inactive|expired/i.test(pill.textContent);

    var status = document.querySelector('#view .status-line');
    if (status) {
      var m = status.textContent.match(/active through\s+(.+?)\.?$/i);
      if (m) s.renews = m[1].trim();
    }

    var nameRow = document.querySelector('#view .info-row .info-val');
    if (nameRow) s.name = (nameRow.textContent || '').trim().split(/\s+/)[0] || '';

    var sc = document.getElementById('screeningCard');
    s.screenings = !!(sc && sc.style.display !== 'none');

    var box = document.getElementById('signupsBox');
    if (box) s.signups = box.querySelectorAll('[data-signup-id], .signup-row, .su-row').length;

    return s;
  }

  function buildHome() {
    var view = document.getElementById('view');
    if (!view || document.querySelector('.mm-home')) return;
    /* Only on the signed-in dashboard: the same #view also holds the login and
       error states, and a menu of member-only links has no business there. */
    if (!document.getElementById('eventsCard')) return;

    var s = readState();

    var chips = '<div class="mm-status">';
    if (s.active === null) {
      chips += '';
    } else if (s.active) {
      chips += '<div class="mm-chip ok"><small>Membership</small><b>Active</b>'
             + (s.renews ? '<div class="mm-sub">Through ' + esc(s.renews) + '</div>' : '') + '</div>';
    } else {
      chips += '<div class="mm-chip warn"><small>Membership</small><b>Not active</b>'
             + '<div class="mm-sub">Tap to renew</div></div>';
    }
    chips += '<div class="mm-chip br"><small>Certification</small><b>Bronze</b>'
           + '<div class="mm-sub">Open to start</div></div>';
    chips += '</div>';

    var html = '<div class="mm-home">'
      + '<div class="mm-greet">'
      + '  <img src="https://www.ldahawaii.org/logo_blue.png" alt="">'
      + '  <div class="mm-gtext"><b>' + (s.name ? 'Aloha, ' + esc(s.name) : 'Aloha') + '</b>'
      + '  <span>Member Portal</span></div>'
      + '</div>'
      + chips
      + '<a class="mm-cta" href="certification.html">'
      + '  <div class="mm-lbl"><small>Certification Program</small><b>Open my training</b></div>'
      + svg(I.chev) + '</a>'
      + '<div class="mm-mtitle">Main menu</div>'
      + '<div class="mm-tiles">'
      + tile('certification.html', I.cert, '#B45309', '#FEF6EC', 'Certification', 'Advocacy training')
      + tile('#eventsCard', I.event, '#F97316', '#FFF7ED', 'My Events', 'Your signups',
             { badge: s.signups > 0 ? String(s.signups) : '' })
      + tile('screenings.html', I.pulse, '#16A34A', '#F0FDF4', 'Screening Results', 'Hearing &amp; vision',
             { badge: s.screenings ? 'New' : '' })
      + tile('videos.html', I.play, '#0891B2', '#ECFEFF', 'Recordings', 'Past Learning Labs')
      + tile('resources.html', I.doc, '#7C3AED', '#F5F3FF', 'Resources', 'Links &amp; training')
      + tile('profile.html', I.gear, '#64748B', '#F1F5F9', 'Profile', 'Your details and keiki')
      + '<a class="mm-tile wide" href="https://www.ldahawaii.org/contact.html">'
      + '  <div class="mm-ico" style="background:#ECFEFF">' + svg(I.ask, '#0891B2') + '</div>'
      + '  <div style="flex:1"><b>Ask LDAH a Question</b><span>We answer within a day</span></div>'
      + '  <svg class="mm-chev" viewBox="0 0 24 24">' + I.chev + '</svg></a>'
      + '</div></div>';

    view.insertAdjacentHTML('afterbegin', html);

    /* The desktop photo tiles say the same things as the menu above, so on
       mobile they are duplication, not decoration. Hidden by class rather than
       removed so unmounting restores them. */
    var photoTiles = view.querySelector('.tiles');
    if (photoTiles) photoTiles.classList.add('mm-hide-mobile');
  }

  /* ── mount / unmount ────────────────────────────────────────────────── */
  var observer = null;

  function mount() {
    if (mounted) return;
    mounted = true;
    document.body.classList.add('mm-on');
    buildTabBar();
    buildHome();
    if (document.getElementById('view') && !observer) {
      observer = new MutationObserver(function () { if (mounted) buildHome(); });
      observer.observe(document.getElementById('view'), { childList: true, subtree: true });
    }
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    document.body.classList.remove('mm-on');
    var bar = document.querySelector('.mm-tabbar'); if (bar) bar.remove();
    var home = document.querySelector('.mm-home'); if (home) home.remove();
    document.querySelectorAll('.mm-hide-mobile').forEach(function (el) { el.classList.remove('mm-hide-mobile'); });
    if (observer) { observer.disconnect(); observer = null; }
  }

  function sync() { (window.matchMedia(MQ).matches ? mount : unmount)(); }

  function start() {
    sync();
    var mql = window.matchMedia(MQ);
    /* addEventListener is not in older Android WebViews; addListener is. */
    if (mql.addEventListener) mql.addEventListener('change', sync);
    else if (mql.addListener) mql.addListener(sync);
    window.addEventListener('orientationchange', function () { setTimeout(sync, 120); });
    window.addEventListener('hashchange', function () {
      var bar = document.querySelector('.mm-tabbar');
      if (bar) { bar.remove(); buildTabBar(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
