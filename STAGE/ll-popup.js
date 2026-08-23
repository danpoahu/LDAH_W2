/* LDAH event first-launch popup — schedule-driven.
 *
 * Auto-shows once per browser, per event, on the homepage. Each event has a
 * 5-day window: the popup only appears in the 5 days leading up to (and on)
 * the event date, and shows ONLY that single upcoming date.
 *
 * Schedule:
 *   - Learning Labs · Navigating Transitions  — June 10  (window June 5–10)
 *   - Parent Talk Café                         — June 17  (window June 12–17)
 *   - Learning Labs · Understanding ADHD       — June 24  (window June 19–24)
 *   - Learning Labs · A-B-Cs of Advocacy       — July 8   (window July 3–8; hard stop 5 PM HST July 8)
 *   - Learning Labs · IDEA / Chapter 60        — Aug 12  (window Aug 7–12; hard stop 5 PM HST Aug 12)
 *
 * Behavior:
 *   - 5-day window: show only when 0 <= daysUntil <= 5. Picks the soonest
 *     eligible event. Outside every window, nothing shows.
 *   - Optional `endsAt` (ISO instant): hides a campaign at a precise time —
 *     e.g. the event's start — instead of waiting for its day to end.
 *   - Dismiss-once PER EVENT: localStorage 'll_popup_seen_<key>' is set on ANY
 *     close (X, backdrop, Escape, "Maybe later", Sign Up Now). Each event still
 *     pops once even if an earlier one was dismissed.
 *   - Self-hiding: once the last event's day passes, nothing ever shows again.
 *
 * To re-test from the console: LLEventPopup.reset(); location.reload();
 * (Preview a specific one: LLEventPopup.preview('ptc-2026-06-17'); )
 */
(function () {
    'use strict';

    var WINDOW_DAYS = 5;
    var SHOW_DELAY_MS = 1500;
    var KEY_PREFIX = 'll_popup_seen_';
    var MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var LL_IMG = 'https://firebasestorage.googleapis.com/v0/b/ldah-932d5.firebasestorage.app/o/event-images%2F1779995116728_June%20LL.jpg?alt=media&token=d0d2052f-feec-4e5f-a933-45c8a2ab66c0';
    var PTC_IMG = 'https://firebasestorage.googleapis.com/v0/b/ldah-932d5.firebasestorage.app/o/event-images%2F1780510227059_June%202026..jpg?alt=media&token=eedabbf6-206f-4493-b8af-376627649d43';
    var LL_JULY_IMG = 'https://firebasestorage.googleapis.com/v0/b/ldah-932d5.firebasestorage.app/o/event-images%2F1783039515710_July%20%20LL%202.jpg?alt=media&token=30236f21-a314-46bc-afa9-b5ed69f5149b';
    var LL_AUG_IMG = 'https://firebasestorage.googleapis.com/v0/b/ldah-932d5.firebasestorage.app/o/event-images%2F1784843405905_August.jpg?alt=media&token=07323c84-3b7d-4bd9-aee5-752e8dd2e43c';
    var MEMBER_IMG = '/assets/images/become-a-member.png';

    // ── Schedule (edit here to add / change events) ───────────────────────────
    // label may contain "{month}" — replaced with the event's month name, so
    // "Learning Labs for {month}" auto-rolls June → July → … with the date.
    var CAMPAIGNS = [
        {
            key: 'll-2026-06-10',
            date: '2026-06-10',
            label: 'Learning Labs for {month}',
            sub: 'Free virtual Learning Lab for Hawaiʻi families.',
            topic: 'Navigating Transitions',
            when: 'June 10 &middot; 5:00 PM on Zoom',
            eventId: 'WyaBRKf0xhFsahAWgcbn',
            image: LL_IMG
        },
        {
            key: 'ptc-2026-06-17',
            date: '2026-06-17',
            label: 'Parent Talk Café',
            sub: 'A relaxed space for parents to connect and talk story.',
            topic: 'Parent Talk Café',
            when: 'June 17 &middot; 5:00 PM on Facebook',
            eventId: 'D9PCAWigmVKkXfMzHVJI',
            image: PTC_IMG
        },
        {
            key: 'll-2026-06-24',
            date: '2026-06-24',
            label: 'Learning Labs for {month}',
            sub: 'Free virtual Learning Lab for Hawaiʻi families.',
            topic: 'Understanding ADHD',
            when: 'June 24 &middot; 5:00 PM on Zoom',
            eventId: 'WyaBRKf0xhFsahAWgcbn',
            image: LL_IMG
        },
        {
            // August session 1 of 2. The default 5-day window (Aug 7-12) already
            // covers today, so no windowDays override is needed. endsAt stops it
            // the moment the session starts rather than letting it run out the
            // day: HST is UTC-10, so 5 PM HST Aug 12 == 2026-08-13T03:00:00Z.
            // Session 2 (Aug 26, Understanding Evaluations) is deliberately not
            // scheduled yet - the membership promo covers Aug 13-20.
            key: 'll-2026-08-12',
            date: '2026-08-12',
            endsAt: '2026-08-13T03:00:00Z',
            label: 'Learning Labs for {month}',
            sub: 'Free virtual Learning Lab for Hawaiʻi families.',
            topic: 'IDEA / Chapter 60',
            when: 'August 12 &middot; 5:00 PM on Zoom',
            eventId: 'IqTwpWFPtpONhThQZmzs',
            image: LL_AUG_IMG
        },
        {
            // Evergreen membership promo — replaces the event popup. Shows the
            // full flyer; the flyer AND the button link to the How to Help page.
            key: 'become-member-2026-07',
            date: '2026-07-21',
            always: true,      // not date-windowed — shows whenever no event is active
            promo: true,
            image: MEMBER_IMG,
            alt: 'Become an LDAH Member',
            ctaText: 'Become a Member',
            ctaHref: 'volunteer.html'   // W2: "How to Help" IS volunteer.html
        }
    ];
    // ──────────────────────────────────────────────────────────────────────────

    var root = null;
    var activeCampaign = null;

    function flagKey(c) { return KEY_PREFIX + c.key; }
    function flagSet(c) {
        try { return localStorage.getItem(flagKey(c)) === 'true'; } catch (e) { return false; }
    }
    function setFlag(c) {
        try { localStorage.setItem(flagKey(c), 'true'); } catch (e) {}
    }

    // Local midnight for a 'YYYY-MM-DD' string (avoids UTC off-by-one).
    function midnight(ymd) {
        var p = ymd.split('-');
        return new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0);
    }

    function daysUntil(ymd) {
        var now = new Date();
        var todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        return Math.round((midnight(ymd).getTime() - todayMid.getTime()) / 86400000);
    }

    // Soonest campaign that's within its 5-day window and not yet dismissed.
    function pickCampaign() {
        var best = null, bestDays = Infinity;
        var nowMs = Date.now();
        for (var i = 0; i < CAMPAIGNS.length; i++) {
            var c = CAMPAIGNS[i];
            var d = daysUntil(c.date);
            if (!c.always && (d < 0 || d > (typeof c.windowDays === 'number' ? c.windowDays : WINDOW_DAYS))) continue; // outside the show window; `always` promos skip the window entirely
            if (c.endsAt && nowMs >= Date.parse(c.endsAt)) continue; // past the hard cutoff (e.g. event start time)
            if (flagSet(c)) continue;               // already seen this one
            var rank = c.always ? 999 : d;          // a real upcoming event outranks an evergreen promo
            if (rank < bestDays) { best = c; bestDays = rank; }
        }
        return best;
    }

    function monthName(ymd) {
        return MONTHS[(+ymd.split('-')[1]) - 1];
    }
    function labelFor(c) {
        return c.label.replace('{month}', monthName(c.date));
    }
    function headline(c) {
        var d = daysUntil(c.date);
        var label = labelFor(c);
        if (d <= 0) return label + ' is today!';
        if (d === 1) return label + ' is tomorrow!';
        return d + ' days until ' + label;
    }

    function signupUrl(c) {
        // src=popup drives signup-source attribution (→ 'event-popup') on the events page.
        return 'events.html?eventId=' + c.eventId + '&autoOpen=1&src=popup';
    }

    function buildMarkup(c) {
        var backdrop = document.createElement('div');
        backdrop.className = 'll-pop-backdrop';
        backdrop.id = 'llPopBackdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        // Promo layout: the flyer IS the popup. Whole flyer + button link out.
        if (c.promo) {
            backdrop.innerHTML =
                '<div class="ll-pop ll-pop-promo" role="dialog" aria-modal="true" aria-label="' + (c.alt || 'Become a Member') + '">' +
                    '<button class="ll-pop-close" type="button" aria-label="Close">&times;</button>' +
                    '<a class="ll-pop-promo-link" href="' + c.ctaHref + '">' +
                        '<img class="ll-pop-promo-img" src="' + c.image + '" alt="' + (c.alt || '') + '">' +
                    '</a>' +
                    '<div class="ll-pop-promo-foot">' +
                        '<a class="ll-pop-cta" href="' + c.ctaHref + '">' + (c.ctaText || 'Learn More') + '</a>' +
                        '<button class="ll-pop-later" type="button">Maybe later</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(backdrop);
            return backdrop;
        }
        var imgTag = (c.image && c.image.toLowerCase().indexOf('.pdf') === -1)
            ? '<img class="ll-pop-img" src="' + c.image + '" alt="">'
            : '';
        backdrop.innerHTML =
            '<div class="ll-pop" role="dialog" aria-modal="true" aria-labelledby="llPopTitle">' +
                '<button class="ll-pop-close" type="button" aria-label="Close">&times;</button>' +
                '<div class="ll-pop-head">' +
                    '<h2 class="ll-pop-title" id="llPopTitle"></h2>' +
                '</div>' +
                imgTag +
                '<div class="ll-pop-body">' +
                    '<p class="ll-pop-sub">' + c.sub + '</p>' +
                    '<p class="ll-pop-when"><strong>' + c.topic + '</strong><br>' + c.when + '</p>' +
                    '<a class="ll-pop-cta" href="' + signupUrl(c) + '">Sign Up Now</a>' +
                    '<button class="ll-pop-later" type="button">Maybe later</button>' +
                '</div>' +
            '</div>';
        backdrop.querySelector('#llPopTitle').textContent = headline(c);
        document.body.appendChild(backdrop);
        return backdrop;
    }

    function show(c) {
        if (root) { root.remove(); root = null; }
        activeCampaign = c;
        trackFlyer('seen', c._flyerKey || c.key);
        root = buildMarkup(c);
        wire();
        root.classList.add('active');
        root.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    // Any dismissal is permanent for THIS event (dismiss-once per event).
    function close() {
        if (activeCampaign) setFlag(activeCampaign);
        if (root) {
            root.classList.remove('active');
            root.setAttribute('aria-hidden', 'true');
        }
        document.body.style.overflow = '';
    }

    function wire() {
        root.querySelector('.ll-pop-close').addEventListener('click', close);
        root.querySelector('.ll-pop-later').addEventListener('click', close);
        // Sign Up Now: mark seen, then let the link navigate.
        root.querySelector('.ll-pop-cta').addEventListener('click', function () {
            if (activeCampaign) { setFlag(activeCampaign); trackFlyer('click', activeCampaign._flyerKey || activeCampaign.key); }
        });
        var promoLink = root.querySelector('.ll-pop-promo-link');
        if (promoLink) promoLink.addEventListener('click', function () { if (activeCampaign) { setFlag(activeCampaign); trackFlyer('click', activeCampaign._flyerKey || activeCampaign.key); } });
        root.addEventListener('click', function (ev) { if (ev.target === root) close(); });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && root && root.classList.contains('active')) close();
        });
    }

    // ── Home Rotation integration (2026-08-23) ────────────────────────────────
    // The popup now mirrors what staff tick in LDAH-Int > Home Rotation, reading
    // the SAME flags the homepage cards use: an event doc with homeRotation:true
    // (whole event) or homeRotationDates:[...] (per session), plus homePinned.
    // Each becomes a flyer "promo" popup (the flyer IS the popup). Pinned items
    // get priority; every item is still dismiss-once-per-browser so a modal never
    // nags. Only when NOTHING is ticked does it fall back to the hardcoded
    // CAMPAIGNS (the evergreen membership promo). Events/recurringEvents are
    // public-readable (the homepage already queries them unauthenticated).
    function rotCampaign(c, lbl, pinned) {
        return {
            key: 'rot-' + c.id + (lbl ? '::' + lbl : ''),
            promo: true,
            _pinned: !!pinned,
            _flyerKey: c.id,               // analytics: aggregate per event
            image: c.imageUrl,
            alt: c.title || 'LDAH',
            ctaText: 'See Details',
            ctaHref: 'events.html'   // just the events page — no auto-opened signup modal (matches the app)
        };
    }
    // Popup analytics — one write per show / per click into the same
    // siteAnalytics/<date> doc the site tracker uses, so it appears in the CMS
    // Web Analytics section. set(merge) with increment creates the day doc if
    // needed and increments it otherwise. (2026-08-23)
    function trackFlyer(action, key) {
        try {
            if (typeof firebase === 'undefined' || !firebase.firestore) return;
            var db = firebase.firestore();
            var d = new Date();
            var dateKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            var inc = firebase.firestore.FieldValue.increment(1);
            var field = action === 'click' ? 'flyer_click' : 'flyer_seen';
            var safe = String(key || 'unknown').replace(/[.#$/\[\]]/g, '_');
            var payload = { events: {} };
            payload.events[field] = {}; payload.events[field][safe] = inc;
            payload.events[field + '_total'] = inc;
            db.collection('siteAnalytics').doc(dateKey).set(payload, { merge: true }).catch(function () {});
        } catch (e) {}
    }
    // A homeRotation flag left on a PAST event (the CMS doesn't clear it when an
    // event passes) must not resurface in the popup — e.g. an August Parent Talk
    // Café whose date has gone by. Filter every rotation item by its date. (2026-08-23)
    function _rotDateFromLabel(lbl) {
        var m = String(lbl || '').match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
        if (!m) return null;
        var d = new Date(m[1] + ' ' + m[2] + ', ' + m[3]);
        return isNaN(d.getTime()) ? null : d;
    }
    function _rotNotPast(d) {
        if (!d) return true;                          // ongoing / unparseable → keep
        var n = new Date();
        return d >= new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }
    function loadRotationCampaigns(cb) {
        if (typeof firebase === 'undefined' || !firebase.firestore) { cb([]); return; }
        var db;
        try { db = firebase.firestore(); } catch (e) { cb([]); return; }
        Promise.all([
            db.collection('events').get(),
            db.collection('recurringEvents').where('active', '==', true).get()
        ]).then(function (snaps) {
            var pool = [];
            snaps.forEach(function (snap) {
                snap.forEach(function (doc) {
                    var c = doc.data(); c.id = doc.id;
                    if (c.archived === true) return;
                    if (!c.imageUrl) return;                              // popup is the flyer
                    if (/\.pdf($|\?)/i.test(c.imageUrl)) return;          // PDF flyers can't render as <img>
                    var picked = Array.isArray(c.homeRotationDates) ? c.homeRotationDates : [];
                    if (picked.length) {
                        picked.forEach(function (lbl) {
                            if (!_rotNotPast(_rotDateFromLabel(lbl))) return;   // skip a past ticked session
                            pool.push(rotCampaign(c, lbl, String(c.homePinned || '') === lbl));
                        });
                    } else if (c.homeRotation === true) {
                        // The event moves to Past on its own at moveToPastDate — honour the
                        // same boundary so a stale homeRotation flag can't resurface it.
                        var _bound = c.moveToPastDate || c.eventDate;
                        var _bd = _bound ? new Date(_bound + 'T00:00:00') : null;
                        if (_bd && !_rotNotPast(_bd)) return;
                        pool.push(rotCampaign(c, '', c.homePinned === true));
                    }
                });
            });
            cb(pool);
        }).catch(function () { cb([]); });
    }
    // Show each rotation flyer up to POPUP_VIEW_CAP times per browser, then stop.
    // Fewest-views-first so ticked flyers ALTERNATE (A, B, A, B) rather than
    // repeat back-to-back; pinned breaks ties. Counts live in one localStorage
    // map. Returns null once every flyer has hit its cap. (2026-08-23)
    var POPUP_VIEW_CAP = 2;
    var VIEWS_KEY = 'll_popup_views';
    function _views() { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}'); } catch (e) { return {}; } }
    function viewCount(k) { return +(_views()[k] || 0); }
    function bumpView(k) { try { var v = _views(); v[k] = viewCount(k) + 1; localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch (e) {} }
    function pickRotation(pool) {
        var avail = pool.filter(function (c) { return viewCount(c.key) < POPUP_VIEW_CAP; });
        if (!avail.length) return null;
        avail.sort(function (a, b) {
            var d = viewCount(a.key) - viewCount(b.key);
            return d !== 0 ? d : (b._pinned ? 1 : 0) - (a._pinned ? 1 : 0);
        });
        return avail[0];
    }

    function init() {
        loadRotationCampaigns(function (pool) {
            if (pool && pool.length) {
                var c = pickRotation(pool);
                if (!c) return;
                bumpView(c.key);                       // count this display
                setTimeout(function () { show(c); }, SHOW_DELAY_MS);
            } else {
                var f = pickCampaign();                // no ticks → hardcoded fallback (membership promo)
                if (f) setTimeout(function () { show(f); }, SHOW_DELAY_MS);
            }
        });
    }

    window.LLEventPopup = {
        close: close,
        // Clear every event's seen-flag (so they can all re-pop).
        reset: function () {
            // Clear every popup seen-flag (hardcoded campaigns AND rotation items).
            try {
                for (var i = localStorage.length - 1; i >= 0; i--) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(KEY_PREFIX) === 0) localStorage.removeItem(k);
                }
                localStorage.removeItem(VIEWS_KEY);
            } catch (e) {}
            console.log('[LLEventPopup] all popup flags + view counts cleared. Reload to retrigger.');
        },
        // Force-show a specific campaign by key, ignoring window + flag (testing only).
        preview: function (key) {
            var c = CAMPAIGNS.filter(function (x) { return x.key === key; })[0] || CAMPAIGNS[0];
            show(c);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
