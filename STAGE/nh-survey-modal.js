/* Native Hawaiian Family Survey Modal — controller
 * Exposed as window.NHSurveyModal with init().
 * One-time per browser via localStorage key 'ldah_nh_survey_shown'.
 *
 * Flag rules (updated 2026-05-12):
 *   - localStorage 'ldah_nh_survey_shown' is set ONLY on X-close, backdrop click,
 *     Escape key, or Submit success. It is NOT set on auto-open.
 *   - "Maybe Later" button on the intro screen closes the modal WITHOUT setting
 *     the flag, so the modal reappears on the next page load (after the 2s init delay).
 *   - sessionStorage 'ldah_nh_survey_open' guards against a refresh while mid-survey
 *     re-popping the modal immediately within the same tab session. Cleared on any close.
 *   - openManual() (called from the footer link) bypasses BOTH flags and never sets them.
 */
(function() {
    'use strict';

    var STORAGE_KEY = 'ldah_nh_survey_shown';
    var SESSION_OPEN_KEY = 'ldah_nh_survey_open';
    var CF_ENDPOINT = 'https://us-central1-ldah-932d5.cloudfunctions.net/submitNativeHawaiianSurvey';
    var CONTACT_CF_ENDPOINT = 'https://us-central1-ldah-932d5.cloudfunctions.net/addNativeHawaiianSurveyContact';
    var MODAL_HTML_URL = 'nh-survey-modal.html';
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Screens in order. Intro = branded splash (no progress bar), 1..4 = numbered form steps (Step 1-4 of 4),
    // 'contact' = optional post-submit contact screen (no step number), 'mahalo' = final.
    var SCREEN_ORDER = ['intro', '1', '2', '3', '4', 'contact', 'mahalo'];
    // Progress label only shown for screens 1..4. The intro is a splash and has no step number.
    // Step 1 of 4 starts on Family Information.
    var STEP_LABEL = {
        '1':     'Step 1 of 4',
        '2':     'Step 2 of 4',
        '3':     'Step 3 of 4',
        '4':     'Step 4 of 4'
    };
    var STEP_PROGRESS_PCT = {
        '1':     25,
        '2':     50,
        '3':     75,
        '4':     100
    };

    var state = {
        currentIdx: 0,            // index into SCREEN_ORDER
        modalRoot: null,
        injected: false,
        submitting: false,
        completed: false,
        wired: false,             // wireEvents() only runs once even if markup is re-used
        surveyDocId: null,        // set after successful submit; used by contact CF
        contactSending: false
    };

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function showError(msg) {
        var err = $('#nhSurveyError');
        if (!err) return;
        err.textContent = msg;
        err.classList.add('active');
    }
    function clearError() {
        var err = $('#nhSurveyError');
        if (err) { err.classList.remove('active'); err.textContent = ''; }
    }

    function setScreenByKey(key) {
        $all('.nh-survey-screen').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-screen') === key);
        });
        // Scroll body back to top so user sees beginning of new screen
        var body = $('#nhSurveyBody');
        if (body) body.scrollTop = 0;
    }

    function updateChrome() {
        var key = SCREEN_ORDER[state.currentIdx];
        var progressWrap = $('#nhSurveyProgressWrap');
        var footer = $('#nhSurveyFooter');
        var backBtn = $('#nhSurveyBackBtn');
        var nextBtn = $('#nhSurveyNextBtn');
        var progressLabel = $('#nhSurveyProgressLabel');
        var progressFill = $('#nhSurveyProgressFill');

        // Toggle splash mode on the inner .nh-survey-modal. The 'nh-survey-on-intro'
        // class hides the header title + progress and strips body padding (used for
        // the branded splash). The 'nh-survey-on-contact' class also hides header
        // title + progress (post-survey contact screen) without stripping padding.
        var modalInner = state.modalRoot ? state.modalRoot.querySelector('.nh-survey-modal') : null;
        if (modalInner) {
            modalInner.classList.toggle('nh-survey-on-intro', key === 'intro');
            modalInner.classList.toggle('nh-survey-on-contact', key === 'contact');
        }

        if (key === 'mahalo') {
            if (progressWrap) progressWrap.style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
            if (nextBtn) {
                nextBtn.style.display = 'inline-block';
                nextBtn.textContent = 'Close';
                nextBtn.disabled = false;
            }
            if (footer) footer.style.justifyContent = 'center';
            return;
        }

        if (key === 'contact') {
            // Hide progress; Skip on left (always enabled), Send on right (disabled until any field has text).
            if (progressWrap) progressWrap.style.display = 'none';
            if (footer) footer.style.justifyContent = 'space-between';
            if (backBtn) {
                backBtn.style.display = 'inline-block';
                backBtn.textContent = "Skip — I'm done";
                backBtn.disabled = false;
            }
            if (nextBtn) {
                nextBtn.style.display = 'inline-block';
                nextBtn.textContent = state.contactSending ? 'Sending...' : 'Send Contact Info';
                nextBtn.disabled = state.contactSending || !contactHasContent();
            }
            return;
        }

        if (footer) footer.style.justifyContent = 'space-between';

        // Hide progress on intro (splash); show on steps 1-4.
        if (progressWrap) progressWrap.style.display = (key === 'intro') ? 'none' : '';
        if (progressLabel) progressLabel.textContent = STEP_LABEL[key] || '';
        if (progressFill) progressFill.style.width = (STEP_PROGRESS_PCT[key] || 0) + '%';

        // Back button: hidden on intro, shown otherwise
        if (backBtn) {
            backBtn.style.display = (key === 'intro') ? 'none' : 'inline-block';
            backBtn.disabled = false;
        }

        // Next button label by screen
        if (nextBtn) {
            nextBtn.style.display = 'inline-block';
            nextBtn.disabled = state.submitting;
            if (key === 'intro') {
                nextBtn.textContent = 'Take Survey';
            } else if (key === '4') {
                nextBtn.textContent = state.submitting ? 'Submitting...' : 'Submit';
            } else {
                nextBtn.textContent = 'Next';
            }
        }

        // On intro, swap Back button for "Maybe Later"
        if (key === 'intro' && backBtn) {
            backBtn.style.display = 'inline-block';
            backBtn.textContent = 'Maybe Later';
        } else if (backBtn) {
            backBtn.textContent = 'Back';
        }
    }

    function contactHasContent() {
        var root = state.modalRoot;
        if (!root) return false;
        var n = (root.querySelector('#nhSurveyContactName') || {}).value || '';
        var e = (root.querySelector('#nhSurveyContactEmail') || {}).value || '';
        var p = (root.querySelector('#nhSurveyContactPhone') || {}).value || '';
        return (n.trim().length + e.trim().length + p.trim().length) > 0;
    }

    function clearContactError() {
        var err = $('#nhSurveyContactError');
        if (err) { err.textContent = ''; err.style.display = 'none'; }
    }
    function showContactError(msg) {
        var err = $('#nhSurveyContactError');
        if (!err) return;
        err.textContent = msg;
        err.style.display = 'block';
    }

    function goNext() {
        clearError();
        var key = SCREEN_ORDER[state.currentIdx];
        if (key === 'mahalo') {
            // After submit success, flag is already set; this is just closing the Mahalo screen.
            closeModal({ permanent: true });
            return;
        }
        if (key === 'contact') {
            // Primary button on contact screen = "Send Contact Info"
            sendContactInfo();
            return;
        }
        if (key === '4') {
            // Submit
            submitSurvey();
            return;
        }
        state.currentIdx += 1;
        var newKey = SCREEN_ORDER[state.currentIdx];
        setScreenByKey(newKey);
        updateChrome();
    }

    function goBack() {
        clearError();
        var key = SCREEN_ORDER[state.currentIdx];
        if (key === 'intro') {
            // "Maybe Later" — defer only, do NOT set the permanent flag
            closeModal({ permanent: false });
            return;
        }
        if (key === 'contact') {
            // "Skip — I'm done" on contact screen jumps straight to Mahalo, no CF call.
            jumpToMahalo();
            return;
        }
        if (state.currentIdx > 0) {
            state.currentIdx -= 1;
            setScreenByKey(SCREEN_ORDER[state.currentIdx]);
            updateChrome();
        }
    }

    function jumpToMahalo() {
        state.currentIdx = SCREEN_ORDER.indexOf('mahalo');
        setScreenByKey('mahalo');
        updateChrome();
    }

    function collectFormState() {
        var root = state.modalRoot;
        function radioVal(name) {
            var el = root.querySelector('input[name="' + name + '"]:checked');
            return el ? el.value : null;
        }
        function checkedVals(name) {
            return $all('input[name="' + name + '"]:checked', root).map(function(el) { return el.value; });
        }
        function textVal(name) {
            var el = root.querySelector('[name="' + name + '"]');
            if (!el) return null;
            var v = (el.value || '').trim();
            return v.length ? v : null;
        }

        var q2val = radioVal('q2');
        var q2other = textVal('q2_other');
        var q3vals = checkedVals('q3');
        var q3other = textVal('q3_other');

        return {
            q1: radioVal('q1'),
            q2: { value: q2val, other: (q2val === 'other') ? q2other : null },
            q3: { values: q3vals, other: (q3vals.indexOf('other') !== -1) ? q3other : null },
            q4: radioVal('q4'),
            q5: checkedVals('q5'),
            q6: radioVal('q6'),
            q7: radioVal('q7'),
            q8: checkedVals('q8'),
            q9: radioVal('q9'),
            q10: checkedVals('q10'),
            q11: radioVal('q11'),
            q12: radioVal('q12'),
            q13: textVal('q13'),
            q14: textVal('q14'),
            q15: radioVal('q15'),
            honeypot: (root.querySelector('#nhSurveyHoneypot') || {}).value || ''
        };
    }

    function submitSurvey() {
        if (state.submitting) return;
        clearError();
        state.submitting = true;
        updateChrome();

        var body = collectFormState();

        fetch(CF_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function(res) {
            return res.json().then(function(data) { return { status: res.status, data: data }; }).catch(function() {
                return { status: res.status, data: null };
            });
        }).then(function(result) {
            state.submitting = false;
            if (result.status === 200 && result.data && result.data.success) {
                state.completed = true;
                // Submit success — permanently dismiss going forward
                try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (e) {}
                // If we got a surveyDocId back, route through the optional contact screen first.
                // Honeypot silent-success and any legacy response without an ID jump straight to mahalo.
                if (result.data.surveyDocId) {
                    state.surveyDocId = result.data.surveyDocId;
                    state.currentIdx = SCREEN_ORDER.indexOf('contact');
                    setScreenByKey('contact');
                    clearContactError();
                } else {
                    state.currentIdx = SCREEN_ORDER.indexOf('mahalo');
                    setScreenByKey('mahalo');
                }
                updateChrome();
            } else if (result.status === 429) {
                showError("You've reached today's submission limit. Mahalo for participating.");
                updateChrome();
            } else {
                showError('Something went wrong. Please try again later.');
                // Don't set the permanent flag — let them retry next visit
                updateChrome();
            }
        }).catch(function() {
            state.submitting = false;
            showError('Something went wrong. Please try again later.');
            updateChrome();
        });
    }

    function sendContactInfo() {
        if (state.contactSending) return;
        clearContactError();

        var root = state.modalRoot;
        if (!root || !state.surveyDocId) {
            // No docId — should never happen on this screen, but bail gracefully to mahalo.
            jumpToMahalo();
            return;
        }

        var nameVal = ((root.querySelector('#nhSurveyContactName') || {}).value || '').trim();
        var emailVal = ((root.querySelector('#nhSurveyContactEmail') || {}).value || '').trim();
        var phoneVal = ((root.querySelector('#nhSurveyContactPhone') || {}).value || '').trim();

        if (!nameVal && !emailVal && !phoneVal) {
            // Button shouldn't be enabled in this case, but guard anyway.
            return;
        }
        if (emailVal && !EMAIL_RE.test(emailVal)) {
            showContactError("Email address doesn't look right. Please check and try again.");
            return;
        }

        var payload = { surveyDocId: state.surveyDocId };
        if (nameVal) payload.fullName = nameVal;
        if (emailVal) payload.email = emailVal;
        if (phoneVal) payload.phone = phoneVal;

        state.contactSending = true;
        updateChrome();

        fetch(CONTACT_CF_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function(res) {
            return res.json().then(function(data) { return { status: res.status, data: data }; }).catch(function() {
                return { status: res.status, data: null };
            });
        }).then(function(result) {
            state.contactSending = false;
            if (result.status === 200 && result.data && result.data.success) {
                jumpToMahalo();
            } else {
                var msg = (result.data && result.data.error) || 'Something went wrong. Please try again.';
                showContactError(msg);
                updateChrome();
            }
        }).catch(function() {
            state.contactSending = false;
            showContactError('Something went wrong. Please try again.');
            updateChrome();
        });
    }

    function openModal() {
        if (!state.modalRoot) return;
        state.modalRoot.classList.add('active');
        state.modalRoot.setAttribute('aria-hidden', 'false');
        state.currentIdx = 0;
        setScreenByKey('intro');
        updateChrome();
        // Mark the modal as open for this tab session so a mid-survey refresh
        // doesn't immediately re-pop the modal. Cleared on any close.
        try { sessionStorage.setItem(SESSION_OPEN_KEY, 'true'); } catch (e) {}
        document.body.style.overflow = 'hidden';
    }

    // closeModal(opts):
    //   opts.permanent === true  -> set localStorage flag (never reopen automatically)
    //   opts.permanent === false -> defer only (clear sessionStorage, leave localStorage alone)
    //   opts undefined           -> treat as permanent (back-compat for X / Escape / backdrop)
    function closeModal(opts) {
        if (!state.modalRoot) return;
        var permanent = !opts || opts.permanent !== false;
        if (permanent) {
            try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (e) {}
        }
        try { sessionStorage.removeItem(SESSION_OPEN_KEY); } catch (e) {}
        state.modalRoot.classList.remove('active');
        state.modalRoot.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function wireEvents() {
        var root = state.modalRoot;
        if (!root) return;
        if (state.wired) return;
        state.wired = true;

        $('#nhSurveyNextBtn').addEventListener('click', goNext);
        $('#nhSurveyBackBtn').addEventListener('click', goBack);
        // X-close button: permanent dismiss
        $('#nhSurveyCloseBtn').addEventListener('click', function() { closeModal({ permanent: true }); });

        // Click backdrop to close — permanent dismiss
        root.addEventListener('click', function(ev) {
            if (ev.target === root) closeModal({ permanent: true });
        });

        // Escape to close — permanent dismiss
        document.addEventListener('keydown', function(ev) {
            if (ev.key === 'Escape' && root.classList.contains('active')) closeModal({ permanent: true });
        });

        // Highlight checked options
        $all('.nh-survey-option input', root).forEach(function(input) {
            input.addEventListener('change', function() {
                var label = input.closest('.nh-survey-option');
                if (input.type === 'radio') {
                    // Clear sibling labels
                    $all('input[name="' + input.name + '"]', root).forEach(function(sib) {
                        var lab = sib.closest('.nh-survey-option');
                        if (lab) lab.classList.toggle('checked', sib.checked);
                    });
                } else {
                    if (label) label.classList.toggle('checked', input.checked);
                }
            });
        });

        // Conditional "Other" inputs for Q2 (radio) and Q3 (checkboxes)
        function refreshConditional(name) {
            var conditional = root.querySelector('[data-conditional-for="' + name + '"]');
            if (!conditional) return;
            var triggerVal = conditional.getAttribute('data-conditional-on');
            var matched = false;
            $all('input[name="' + name + '"]', root).forEach(function(el) {
                if (el.value === triggerVal && el.checked) matched = true;
            });
            conditional.classList.toggle('active', matched);
        }
        ['q2', 'q3'].forEach(function(n) {
            $all('input[name="' + n + '"]', root).forEach(function(el) {
                el.addEventListener('change', function() { refreshConditional(n); });
            });
        });

        // Q8: max 3 checkboxes
        function refreshQ8() {
            var boxes = $all('input[name="q8"]', root);
            var checkedCount = boxes.filter(function(b) { return b.checked; }).length;
            var helper = $('#nhQ8Helper');
            boxes.forEach(function(b) {
                var lab = b.closest('.nh-survey-option');
                if (checkedCount >= 3 && !b.checked) {
                    b.disabled = true;
                    if (lab) lab.classList.add('disabled');
                } else {
                    b.disabled = false;
                    if (lab) lab.classList.remove('disabled');
                }
            });
            if (helper) {
                helper.textContent = checkedCount >= 3 ? '(3 selected — uncheck to choose different ones)' : '';
            }
        }
        $all('input[name="q8"]', root).forEach(function(el) {
            el.addEventListener('change', refreshQ8);
        });

        // Character counters for textareas
        function wireCount(textareaId, counterId) {
            var ta = $('#' + textareaId, root);
            var counter = $('#' + counterId, root);
            if (!ta || !counter) return;
            function update() { counter.textContent = (ta.value || '').length + ' / 1000'; }
            ta.addEventListener('input', update);
            update();
        }
        wireCount('nhQ13', 'nhQ13Count');
        wireCount('nhQ14', 'nhQ14Count');

        // Contact screen: refresh Send button enabled-state as user types.
        ['nhSurveyContactName', 'nhSurveyContactEmail', 'nhSurveyContactPhone'].forEach(function(id) {
            var el = $('#' + id, root);
            if (!el) return;
            el.addEventListener('input', function() {
                if (SCREEN_ORDER[state.currentIdx] === 'contact') {
                    clearContactError();
                    updateChrome();
                }
            });
        });
    }

    function injectMarkup() {
        // Try fetching the partial; if it fails (file:// or 404), fall through to inline check
        return fetch(MODAL_HTML_URL).then(function(res) {
            if (!res.ok) throw new Error('fetch failed: ' + res.status);
            return res.text();
        }).then(function(html) {
            var container = document.createElement('div');
            container.innerHTML = html;
            document.body.appendChild(container);
            state.modalRoot = document.getElementById('nhSurveyBackdrop');
            state.injected = true;
        });
    }

    // Ensure modal markup + wiring exist. Returns a Promise.
    function ensureReady() {
        var existing = document.getElementById('nhSurveyBackdrop');
        if (existing) {
            state.modalRoot = existing;
            state.injected = true;
            wireEvents();
            return Promise.resolve();
        }
        return injectMarkup().then(function() {
            wireEvents();
        });
    }

    function init() {
        // If permanently dismissed, do nothing
        var shown = null;
        try { shown = localStorage.getItem(STORAGE_KEY); } catch (e) {}
        if (shown === 'true') return;

        // If the modal was open in this tab session (e.g. user refreshed
        // while mid-survey), skip the auto-pop. The session flag stays set until
        // closeModal() runs, so repeated refreshes won't re-pop within this session.
        // openManual() (footer link) still works as a way back in.
        var sessionOpen = null;
        try { sessionOpen = sessionStorage.getItem(SESSION_OPEN_KEY); } catch (e) {}
        if (sessionOpen === 'true') return;

        ensureReady().then(function() {
            setTimeout(openModal, 2000);
        }).catch(function(err) {
            console.error('[NHSurveyModal] failed to load modal markup:', err);
        });
    }

    // Manual open from footer link / programmatic trigger.
    // Bypasses both flags entirely; does NOT mark the survey as shown.
    function openManual() {
        ensureReady().then(function() {
            openModal();
        }).catch(function(err) {
            console.error('[NHSurveyModal] failed to load modal markup:', err);
        });
    }

    window.NHSurveyModal = {
        init: init,
        open: openModal,
        openManual: openManual,
        close: closeModal,
        // For Daniel: clear the one-time flag from console
        reset: function() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            try { sessionStorage.removeItem(SESSION_OPEN_KEY); } catch (e) {}
            console.log('[NHSurveyModal] localStorage + sessionStorage flags cleared. Reload to retrigger.');
        }
    };

    // Global helper for the footer "Native Hawaiian Survey" link. The
    // header-footer-loader defines an equivalent fallback for pages where this
    // script hasn't loaded yet; this version wins once the controller is ready.
    if (typeof window.openNHSurvey !== 'function' || !window.openNHSurvey.__nhReal) {
        window.openNHSurvey = function(ev) {
            if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            openManual();
        };
        window.openNHSurvey.__nhReal = true;
    }
})();
