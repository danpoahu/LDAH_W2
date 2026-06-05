/* Learning Labs June — first-launch popup controller.
 *
 * Auto-shows once per browser on the homepage, modeled on the (now disabled)
 * NH survey auto-pop + dismiss-once pattern.
 *
 * Behavior:
 *   - Dismiss-once: localStorage key 'll_june_popup_seen' is set on ANY close
 *     (X, backdrop, Escape, "Maybe later", or Sign Up Now). Once set, never shows again.
 *   - Dynamic countdown: headline counts down to the next upcoming session.
 *     June 10 (Navigating Transitions) -> after it passes, June 24 (Understanding ADHD).
 *   - Self-hiding: after the last session day has passed, the popup never shows,
 *     so it can be left in place safely with no manual removal needed.
 *
 * To re-test from the console: LLJunePopup.reset(); location.reload();
 */
(function () {
    'use strict';

    // ── Config (edit here if dates/event change) ──────────────────────────────
    var STORAGE_KEY = 'll_june_popup_seen';
    var EVENT_ID = 'WyaBRKf0xhFsahAWgcbn';
    var EVENT_LABEL = 'Learning Labs June';
    // Sessions in chronological order. Countdown targets the next one not yet past.
    var SESSIONS = ['2026-06-10', '2026-06-24'];
    var SIGNUP_URL = 'events.html?eventId=' + EVENT_ID + '&autoOpen=1';
    var SHOW_DELAY_MS = 1500;
    var LOGO_SRC = 'logo_quilt.png';
    // ──────────────────────────────────────────────────────────────────────────

    var root = null;

    function flagSet() {
        try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch (e) { return false; }
    }
    function setFlag() {
        try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (e) {}
    }

    // Local midnight for a 'YYYY-MM-DD' string (avoids UTC off-by-one).
    function midnight(ymd) {
        var p = ymd.split('-');
        return new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0);
    }

    // Returns the next session Date whose day has not fully passed, or null if all are over.
    function nextSession() {
        var now = new Date();
        var todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        for (var i = 0; i < SESSIONS.length; i++) {
            // A session is "still upcoming or today" while today <= its date.
            if (midnight(SESSIONS[i]).getTime() >= todayMid.getTime()) {
                return midnight(SESSIONS[i]);
            }
        }
        return null;
    }

    function countdownHeadline() {
        var target = nextSession();
        if (!target) return null; // event fully past
        var now = new Date();
        var todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        var days = Math.round((target.getTime() - todayMid.getTime()) / 86400000);
        if (days <= 0) return EVENT_LABEL + ' is today!';
        if (days === 1) return EVENT_LABEL + ' is tomorrow!';
        return days + ' days until ' + EVENT_LABEL;
    }

    function buildMarkup(headline) {
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
                    '<p class="ll-pop-sub">Free virtual Learning Labs for Hawaiʻi families.</p>' +
                    '<p class="ll-pop-when">' +
                        '<strong>June 10</strong> &middot; Navigating Transitions<br>' +
                        '<strong>June 24</strong> &middot; Understanding ADHD<br>' +
                        '5:00 PM on Zoom' +
                    '</p>' +
                    '<a class="ll-pop-cta" href="' + SIGNUP_URL + '">Sign Up Now</a>' +
                    '<button class="ll-pop-later" type="button">Maybe later</button>' +
                '</div>' +
            '</div>';
        backdrop.querySelector('#llPopTitle').textContent = headline;
        document.body.appendChild(backdrop);
        return backdrop;
    }

    function open() {
        if (!root) return;
        root.classList.add('active');
        root.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    // Any dismissal is permanent (dismiss-once).
    function close() {
        setFlag();
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
        root.querySelector('.ll-pop-cta').addEventListener('click', function () { setFlag(); });
        // Backdrop click (outside the card) closes.
        root.addEventListener('click', function (ev) { if (ev.target === root) close(); });
        // Escape closes.
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && root.classList.contains('active')) close();
        });
    }

    function init() {
        if (flagSet()) return;
        var headline = countdownHeadline();
        if (!headline) return; // event over — never show
        root = buildMarkup(headline);
        wire();
        setTimeout(open, SHOW_DELAY_MS);
    }

    window.LLJunePopup = {
        open: function () { if (!root) { root = buildMarkup(countdownHeadline() || EVENT_LABEL); wire(); } open(); },
        close: close,
        reset: function () {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            console.log('[LLJunePopup] flag cleared. Reload to retrigger.');
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
