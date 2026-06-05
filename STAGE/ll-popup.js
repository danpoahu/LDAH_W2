/* LDAH event first-launch popup — schedule-driven.
 *
 * Auto-shows once per browser, per event, on the homepage. Each event has a
 * 5-day window: the popup only appears in the 5 days leading up to (and on)
 * the event date, and shows ONLY that single upcoming date.
 *
 * Schedule (June 2026):
 *   - Learning Labs · Navigating Transitions  — June 10  (window June 5–10)
 *   - Parent Talk Café                         — June 17  (window June 12–17)
 *   - Learning Labs · Understanding ADHD       — June 24  (window June 19–24)
 *
 * Behavior:
 *   - 5-day window: show only when 0 <= daysUntil <= 5. Picks the soonest
 *     eligible event. Outside every window, nothing shows.
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
        for (var i = 0; i < CAMPAIGNS.length; i++) {
            var c = CAMPAIGNS[i];
            var d = daysUntil(c.date);
            if (d < 0 || d > WINDOW_DAYS) continue; // outside the 5-day window
            if (flagSet(c)) continue;               // already seen this one
            if (d < bestDays) { best = c; bestDays = d; }
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
        return 'events.html?eventId=' + c.eventId + '&autoOpen=1';
    }

    function buildMarkup(c) {
        var backdrop = document.createElement('div');
        backdrop.className = 'll-pop-backdrop';
        backdrop.id = 'llPopBackdrop';
        backdrop.setAttribute('aria-hidden', 'true');
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
            if (activeCampaign) setFlag(activeCampaign);
        });
        root.addEventListener('click', function (ev) { if (ev.target === root) close(); });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && root && root.classList.contains('active')) close();
        });
    }

    function init() {
        var c = pickCampaign();
        if (!c) return;
        setTimeout(function () { show(c); }, SHOW_DELAY_MS);
    }

    window.LLEventPopup = {
        close: close,
        // Clear every event's seen-flag (so they can all re-pop).
        reset: function () {
            CAMPAIGNS.forEach(function (c) {
                try { localStorage.removeItem(flagKey(c)); } catch (e) {}
            });
            console.log('[LLEventPopup] all event flags cleared. Reload to retrigger.');
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
