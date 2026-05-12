/* Native Hawaiian Family Survey Modal — controller
 * Exposed as window.NHSurveyModal with init().
 * One-time per browser via localStorage key 'ldah_nh_survey_shown'.
 */
(function() {
    'use strict';

    var STORAGE_KEY = 'ldah_nh_survey_shown';
    var CF_ENDPOINT = 'https://us-central1-ldah-932d5.cloudfunctions.net/submitNativeHawaiianSurvey';
    var MODAL_HTML_URL = 'nh-survey-modal.html';

    // Screens in order. -1 sentinel = intro (no progress bar shown), 1..5 = numbered form steps, 'mahalo' = final.
    // Match user spec: 5 form steps with progress 1-5 + intro + mahalo screen.
    var SCREEN_ORDER = ['intro', '1', '2', '3', '4', 'mahalo'];
    // Progress label only shown for screens 1..4 (which we render as "Step N of 5"). Submit is step 5.
    // The spec says progress 1-5 across form steps. Intro is screen 1 of 5 in plain count, but it doesn't ask questions.
    // We'll treat: intro = step 1 of 5, family = step 2 of 5, understanding = step 3, IEP = step 4, final = step 5.
    var STEP_LABEL = {
        'intro': 'Step 1 of 5',
        '1':     'Step 2 of 5',
        '2':     'Step 3 of 5',
        '3':     'Step 4 of 5',
        '4':     'Step 5 of 5'
    };
    var STEP_PROGRESS_PCT = {
        'intro': 5,
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
        completed: false
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

        if (footer) footer.style.justifyContent = 'space-between';

        if (progressWrap) progressWrap.style.display = '';
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
                nextBtn.textContent = 'Begin Survey';
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

    function goNext() {
        clearError();
        var key = SCREEN_ORDER[state.currentIdx];
        if (key === 'mahalo') {
            closeModal();
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
            // "Maybe Later" — dismiss
            closeModal();
            return;
        }
        if (state.currentIdx > 0) {
            state.currentIdx -= 1;
            setScreenByKey(SCREEN_ORDER[state.currentIdx]);
            updateChrome();
        }
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
                // Jump to mahalo
                state.currentIdx = SCREEN_ORDER.indexOf('mahalo');
                setScreenByKey('mahalo');
                updateChrome();
            } else if (result.status === 429) {
                showError("You've reached today's submission limit. Mahalo for participating.");
                updateChrome();
            } else {
                showError('Something went wrong. Please try again later.');
                // Don't set completion flag — let them retry next visit (already set at open, see openModal note)
                updateChrome();
            }
        }).catch(function() {
            state.submitting = false;
            showError('Something went wrong. Please try again later.');
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
        // Set the one-time flag immediately on open so a refresh during the modal doesn't re-trigger it.
        try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (e) {}
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        if (!state.modalRoot) return;
        state.modalRoot.classList.remove('active');
        state.modalRoot.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function wireEvents() {
        var root = state.modalRoot;
        if (!root) return;

        $('#nhSurveyNextBtn').addEventListener('click', goNext);
        $('#nhSurveyBackBtn').addEventListener('click', goBack);
        $('#nhSurveyCloseBtn').addEventListener('click', closeModal);

        // Click backdrop to close
        root.addEventListener('click', function(ev) {
            if (ev.target === root) closeModal();
        });

        // Escape to close
        document.addEventListener('keydown', function(ev) {
            if (ev.key === 'Escape' && root.classList.contains('active')) closeModal();
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

    function init() {
        // If flag already set, do nothing
        var shown = null;
        try { shown = localStorage.getItem(STORAGE_KEY); } catch (e) {}
        if (shown === 'true') return;

        // If markup already present (rare), wire it up immediately
        var existing = document.getElementById('nhSurveyBackdrop');
        if (existing) {
            state.modalRoot = existing;
            state.injected = true;
            wireEvents();
            setTimeout(openModal, 2000);
            return;
        }

        injectMarkup().then(function() {
            wireEvents();
            setTimeout(openModal, 2000);
        }).catch(function(err) {
            console.error('[NHSurveyModal] failed to load modal markup:', err);
        });
    }

    window.NHSurveyModal = {
        init: init,
        open: openModal,
        close: closeModal,
        // For Daniel: clear the one-time flag from console
        reset: function() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            console.log('[NHSurveyModal] localStorage flag cleared. Reload to retrigger.');
        }
    };
})();
