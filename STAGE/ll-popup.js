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
    var LOGO_SRC = 'logo_quilt.png';
    var KEY_PREFIX = 'll_popup_seen_';

    // ── Schedule (edit here to add / change events) ───────────────────────────
    var CAMPAIGNS = [
        {
            key: 'll-2026-06-10',
            date: '2026-06-10',
            countdownLabel: 'Learning Labs June',
            sub: 'Free virtual Learning Lab for Hawaiʻi families.',
            topic: 'Navigating Transitions',
            when: 'June 10 &middot; 5:00 PM on Zoom',
            eventId: 'WyaBRKf0xhFsahAWgcbn'
        },
        {
            key: 'ptc-2026-06-17',
            date: '2026-06-17',
            countdownLabel: 'Parent Talk Café',
            sub: 'A relaxed space for parents to connect and talk story.',
            topic: 'Parent Talk Café',
            when: 'June 17 &middot; 5:00 PM on Facebook',
            eventId: 'D9PCAWigmVKkXfMzHVJI'
        },
        {
            key: 'll-2026-06-24',
            date: '2026-06-24',
            countdownLabel: 'Learning Labs June',
            sub: 'Free virtual Learning Lab for Hawaiʻi families.',
            topic: 'Understanding ADHD',
            when: 'June 24 &middot; 5:00 PM on Zoom',
            eventId: 'WyaBRKf0xhFsahAWgcbn'
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

    function headline(c) {
        var d = daysUntil(c.date);
        if (d <= 0) return c.countdownLabel + ' is today!';
        if (d === 1) return c.countdownLabel + ' is tomorrow!';
        return d + ' days until ' + c.countdownLabel;
    }

    function signupUrl(c) {
        return 'events.html?eventId=' + c.eventId + '&autoOpen=1';
    }

    function buildMarkup(c) {
        var backdrop = document.createElement('div');
        backdrop.className = 'll-pop-backdrop';
        backdrop.id = 'llPopBackdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.innerHTML =
            '<div class="ll-pop" role="dialog" aria-modal="true" aria-labelledby="llPopTitle">' +
                '<button class="ll-pop-close" type="button" aria-label="Close">&times;</button>' +
                '<div class="ll-pop-head">' +
                    '<img src="' + LOGO_SRC + '" alt="">' +
                    '<h2 class="ll-pop-title" id="llPopTitle"></h2>' +
                '</div>' +
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
