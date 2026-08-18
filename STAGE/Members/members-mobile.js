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
    { key: 'events',  href: 'events.html',         label: 'Events',   icon: I.event },
    { key: 'profile', href: 'profile.html',       label: 'Profile',  icon: I.gear }
  ];

  /* Which tab owns the page being viewed. Pages with no tab of their own
     (videos, resources, screenings, renew, summaries) light nothing rather
     than lighting the wrong thing — a lit tab that is not where you are is
     more confusing than none lit. */
  function currentTab() {
    var f = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (f === '' || f === 'index.html') return 'home';
    if (f === 'events.html') return 'events';
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

  /* READ from what the page already rendered, never re-fetched.

     The source is the HERO, not the dashboard cards: home is now greeting +
     navigation only, and every card the old version scraped (membership pill,
     status line, info rows) has moved to its own page. The hero chip is still
     populated by the page with level, active state and expiry, and it stays in
     the DOM when mobile hides it — so it remains the honest source, and the
     mobile chip can never disagree with what the portal decided. */
  function readState() {
    var s = { name: '', level: '', active: null, renews: '', signups: '', screenings: '' };

    var t = document.getElementById('heroTitle');
    if (t) {
      var m = (t.textContent || '').match(/aloha,\s*(.+)$/i);
      if (m) s.name = m[1].trim().split(/\s+/)[0];
    }

    var chip = document.querySelector('#heroChip .mchip');
    if (chip) {
      s.active = !chip.classList.contains('inactive');
      var txt = (chip.textContent || '').replace(/\s+/g, ' ').trim();
      var lv = txt.match(/^(.+?)\s+member\b/i);
      if (lv) s.level = lv[1].trim() + ' member';
      var th = txt.match(/active through\s+(.+)$/i);
      if (th) s.renews = th[1].trim();
    }

    /* The tile subtitles are filled by preloadSignups() and loadScreenings(). */
    var es = document.getElementById('tileEventsSub');
    if (es && /\d/.test(es.textContent || '')) s.signups = (es.textContent || '').trim();
    var ss = document.getElementById('tileScreenSub');
    if (ss && /\d/.test(ss.textContent || '')) s.screenings = (ss.textContent || '').trim();

    return s;
  }

  /* preloadSignups() and loadScreenings() finish AFTER the dashboard paints and
     then rewrite the tile subtitles in place. That is a text change, not a child
     change, so it never fires a childList observer — the counts would sit at
     their defaults forever. Refresh them rather than rebuilding the block. */
  function refreshHome() {
    var home = document.querySelector('.mm-home');
    if (!home) return;
    var s = readState();
    [['events.html', s.signups], ['screenings.html', s.screenings]].forEach(function (pair) {
      if (!pair[1]) return;
      var t = home.querySelector('.mm-tile[href="' + pair[0] + '"] span');
      if (t && t.textContent !== pair[1]) t.textContent = pair[1];
    });
  }

  function buildHome() {
    var view = document.getElementById('view');
    if (!view) return;
    if (document.querySelector('.mm-home')) { refreshHome(); return; }
    /* Only on the signed-in dashboard: the same #view also holds the login and
       error states, and a menu of member-only links has no business there. The
       photo tiles are the marker now that the cards are gone. */
    if (!view.querySelector('.tiles')) return;

    var s = readState();

    var chips = '<div class="mm-status">';
    if (s.active === null) {
      chips += '';
    } else if (s.active) {
      chips += '<div class="mm-chip ok"><small>Membership</small><b>' + esc(s.level || 'Active') + '</b>'
             + '<div class="mm-sub">' + (s.renews ? 'Active through ' + esc(s.renews) : 'Active') + '</div></div>';
    } else {
      chips += '<div class="mm-chip warn"><small>Membership</small><b>Not active</b>'
             + '<div class="mm-sub">Tap to renew</div></div>';
    }
    chips += '<div class="mm-chip br"><small>Certification</small><b>Bronze</b>'
           + '<div class="mm-sub">Open to start</div></div>';
    chips += '</div>';

    var html = '<div class="mm-home">'
      /* Name only. The page header directly above already carries the LDAH logo
         AND the words "Member Portal", so repeating either here read as a bug. */
      + '<div class="mm-greet"><b>' + (s.name ? 'Aloha, ' + esc(s.name) : 'Aloha') + '</b></div>'
      + chips
      + '<a class="mm-cta" href="certification.html">'
      + '  <div class="mm-lbl"><small>Certification Program</small><b>Open my training</b></div>'
      + svg(I.chev) + '</a>'
      + '<div class="mm-mtitle">Main menu</div>'
      + '<div class="mm-tiles">'
      + tile('certification.html', I.cert, '#B45309', '#FEF6EC', 'Certification', 'Advocacy training')
      + tile('events.html', I.event, '#F97316', '#FFF7ED', 'My Events', s.signups ? esc(s.signups) : 'Your signups')
      + tile('screenings.html', I.pulse, '#16A34A', '#F0FDF4', 'Screening Results', s.screenings ? esc(s.screenings) : 'Hearing &amp; vision')
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


  /* ── certification page ─────────────────────────────────────────────── */

  /* Everything here is READ from the rendered course tree — the .done and
     .lesson-locked classes that cdRefreshGating() puts on each row, and the
     page's own #prog-label. Nothing re-derives gating, so the mobile card can
     never disagree with the tree, and none of the page's internal scope is
     depended on (LS lives inside a closure and is not reachable from here). */
  function certRead() {
    var live = document.querySelector('.cd-section.bronze, .cd-section.silver, .cd-section.gold');
    var rows = live ? [].slice.call(live.querySelectorAll('[data-lesson]')) : [];
    var done = rows.filter(function (r) { return r.classList.contains('done'); });
    var next = rows.filter(function (r) {
      return !r.classList.contains('done') && !r.classList.contains('lesson-locked');
    })[0] || null;

    var label = document.getElementById('prog-label');
    var pct = 0;
    if (label) { var m = (label.textContent || '').match(/(\d+)\s*%/); if (m) pct = parseInt(m[1], 10); }

    var head = live ? live.querySelector('.cd-section-title') : null;

    return {
      tierName: head ? (head.textContent || '').replace(/\s+/g, ' ').trim() : 'Bronze',
      total: rows.length,
      done: done.length,
      pct: pct,
      nextId: next ? next.getAttribute('data-lesson') : '',
      nextText: next ? (next.querySelector('.cd-lesson-text') || {}).textContent || '' : ''
    };
  }

  function buildCert() {
    var shell = document.querySelector('.cd-shell');
    if (!shell || document.querySelector('.mm-cert')) return;
    var s = certRead();
    if (!s.total) return;                       /* tree not rendered yet */

    var allDone = s.done >= s.total;

    /* Once the tier is finished the page's own primary button is the ONLY way to
       claim it — and after claiming it becomes Print. Rather than reimplement
       either, mirror its label and click the real button. Whatever the page
       decides the action is, mobile does exactly that and cannot drift from it. */
    var prim = document.querySelector('#dashPrimaryAction button, #dashPrimaryAction a');
    var primLabel = '', primSub = '';
    if (prim) {
      var subEl = prim.querySelector('.cd-action-btn-sub');
      primSub = subEl ? (subEl.textContent || '').trim() : '';
      primLabel = (prim.textContent || '').replace(primSub, '').replace(/\s+/g, ' ').trim();
    }

    var cta;
    if (allDone && prim) {
      cta = '<button class="mm-cta" type="button" data-mm-primary="1">'
          + '<div class="mm-lbl"><small>' + esc(primSub || 'Bronze complete') + '</small>'
          + '<b>' + esc(primLabel) + '</b></div>' + svg(I.chev) + '</button>';
    } else {
      cta = '<button class="mm-cta" type="button" data-mm-open="' + esc(s.nextId) + '">'
          + '<div class="mm-lbl"><small>' + (s.done ? 'Pick up where you left off' : 'Start here') + '</small>'
          + '<b>' + esc((s.nextText || 'Begin').trim()) + '</b></div>' + svg(I.chev) + '</button>';
    }

    var html = '<div class="mm-cert">'
      + '<button class="mm-back" type="button" data-mm-back="1">' + svg('<path d="M15 6l-6 6 6 6"/>') + 'Certification</button>'
      + '<div class="mm-statcard">'
      + '  <div class="mm-srow"><b>' + esc(s.tierName) + '</b><span class="mm-pct">' + s.pct + '%</span></div>'
      + '  <div class="mm-bar"><i style="width:' + s.pct + '%"></i></div>'
      + '  <p>' + s.done + ' of ' + s.total + ' steps done' + (allDone ? '' : ' &middot; the next level opens when this one is finished') + '</p>'
      + '</div>'
      + cta
      + '<div class="mm-mtitle">This level</div>'
      + '<div class="mm-tiles">'
      + '  <a class="mm-tile" href="#" data-mm-tree="1">'
      + '    <div class="mm-ico" style="background:#ECFEFF">' + svg(I.learn, '#0891B2') + '</div>'
      + '    <div><b>All Lessons</b><span>' + s.done + ' of ' + s.total + ' done</span></div></a>'
      + '  <a class="mm-tile" href="#panel-dashboard">'
      + '    <div class="mm-ico" style="background:#FEF6EC">' + svg(I.cert, '#B45309') + '</div>'
      + '    <div><b>My Certificate</b><span>' + (allDone ? 'Ready to claim' : 'Ready once this level is done') + '</span></div></a>'
      + '</div>'
      + '</div>';

    shell.parentNode.insertBefore(mmFrag(html), shell);

    var block = document.querySelector('.mm-cert');
    block.addEventListener('click', function (e) {
      var openBtn = e.target.closest('[data-mm-open]');
      if (openBtn && typeof window.cdOpenLesson === 'function') {
        e.preventDefault();
        window.cdOpenLesson(openBtn.getAttribute('data-mm-open'));
        var v = document.getElementById('lesson-viewer');
        if (v) v.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('[data-mm-primary]')) {
        e.preventDefault();
        var real = document.querySelector('#dashPrimaryAction button, #dashPrimaryAction a');
        if (real) real.click();
        return;
      }
      var tree = e.target.closest('[data-mm-tree]');
      if (tree) {
        e.preventDefault();
        var side = document.querySelector('.cd-sidebar');
        if (!side) return;
        var showing = side.classList.toggle('mm-show');
        tree.querySelector('b').textContent = showing ? 'Hide Lessons' : 'All Lessons';
        if (showing) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('[data-mm-back]')) { e.preventDefault(); location.href = 'index.html'; }
    });
  }

  function mmFrag(html) {
    var t = document.createElement('div');
    t.innerHTML = html;
    return t.firstChild;
  }

  /* ── mount / unmount ────────────────────────────────────────────────── */
  var observer = null;

  function mount() {
    if (mounted) return;
    mounted = true;
    document.body.classList.add('mm-on');
    buildTabBar();
    buildHome();
    buildCert();
    /* Both pages render asynchronously after auth, and certification.html also
       re-renders the whole tree on cdRefreshGating(), which wipes the block. */
    var host = document.getElementById('view') || document.getElementById('course');
    if (host && !observer) {
      observer = new MutationObserver(function () { if (mounted) { buildHome(); buildCert(); } });
      observer.observe(host, { childList: true, subtree: true, characterData: true });
    }
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    document.body.classList.remove('mm-on');
    var bar = document.querySelector('.mm-tabbar'); if (bar) bar.remove();
    var home = document.querySelector('.mm-home'); if (home) home.remove();
    var cert = document.querySelector('.mm-cert'); if (cert) cert.remove();
    var side = document.querySelector('.cd-sidebar'); if (side) side.classList.remove('mm-show');
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
