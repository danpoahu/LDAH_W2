// Logo Story — LDAH Quilt Description Tooltip
// First visit: cinematic reveal. Hover: quick tooltip. Double-click: replay cinematic.

(function () {
    const STORAGE_KEY = 'ldah-logo-story-seen';
    const PARAGRAPH_1 = 'The Hawaiian quilt symbolizes an attachment and a love for Hawai\u2018i, shared by people throughout the world.';
    const PARAGRAPH_2 = 'In our LDAH quilt design, the children are the center figures, those helping them achieve are the figures with open arms above the child, and the book/flower figures signify knowledge and growth.';

    let card = null;
    let overlay = null;
    let hoverTimer = null;
    let isShowingCinematic = false;
    let isShowingHover = false;

    function waitForLogo(cb) {
        const check = setInterval(() => {
            const logo = document.querySelector('.logo-img');
            if (logo) { clearInterval(check); cb(logo); }
        }, 200);
        // Give up after 10 seconds
        setTimeout(() => clearInterval(check), 10000);
    }

    function createElements() {
        // Overlay
        overlay = document.createElement('div');
        overlay.className = 'logo-story-overlay';
        document.body.appendChild(overlay);

        // Card
        card = document.createElement('div');
        card.className = 'logo-story-card';
        card.innerHTML =
            '<div class="logo-story-title">Our Logo Story</div>' +
            '<p class="logo-story-text" data-p="1">' + PARAGRAPH_1 + '</p>' +
            '<p class="logo-story-text" data-p="2">' + PARAGRAPH_2 + '</p>' +
            '<div class="logo-story-hint">double-click logo to see this again</div>';
        document.body.appendChild(card);
    }

    function positionCard(logo) {
        const rect = logo.getBoundingClientRect();
        const cardWidth = Math.min(420, window.innerWidth * 0.9);

        // Position below the logo, aligned to its left edge
        let left = rect.left;
        let top = rect.bottom + 12;

        // Keep card on screen
        if (left + cardWidth > window.innerWidth - 16) {
            left = window.innerWidth - cardWidth - 16;
        }
        if (left < 8) left = 8;

        card.style.left = left + 'px';
        card.style.top = top + 'px';
    }

    function showCinematic(logo) {
        if (isShowingCinematic) return;
        isShowingCinematic = true;
        hideHover();

        // Position
        positionCard(logo);

        // Reset paragraphs
        card.classList.remove('hover-mode');
        var texts = card.querySelectorAll('.logo-story-text');
        texts.forEach(function (t) { t.classList.remove('reveal', 'shimmer'); });

        // Spotlight the logo
        logo.closest('.logo-container').classList.add('logo-story-spotlight');

        // Show overlay + card
        overlay.classList.add('active');
        requestAnimationFrame(function () {
            card.classList.add('visible');
        });

        // Staggered paragraph reveals with shimmer
        setTimeout(function () {
            texts[0].classList.add('reveal', 'shimmer');
        }, 800);
        setTimeout(function () {
            texts[1].classList.add('reveal', 'shimmer');
        }, 3000);

        // Auto-dismiss after 16 seconds
        var autoDismiss = setTimeout(function () { dismissCinematic(logo); }, 16000);

        // Click overlay or card to dismiss
        function onDismiss(e) {
            // Don't dismiss if clicking the logo itself
            if (e.target === logo || logo.contains(e.target)) return;
            clearTimeout(autoDismiss);
            dismissCinematic(logo);
            overlay.removeEventListener('click', onDismiss);
            card.removeEventListener('click', onDismiss);
        }
        overlay.addEventListener('click', onDismiss);
        card.addEventListener('click', onDismiss);
    }

    function dismissCinematic(logo) {
        if (!isShowingCinematic) return;
        card.classList.remove('visible');
        overlay.classList.remove('active');
        logo.closest('.logo-container').classList.remove('logo-story-spotlight');
        isShowingCinematic = false;
    }

    function showHover(logo) {
        if (isShowingCinematic || isShowingHover) return;
        isShowingHover = true;

        positionCard(logo);
        card.classList.add('hover-mode');

        // Show all text immediately in hover mode
        var texts = card.querySelectorAll('.logo-story-text');
        texts.forEach(function (t) { t.classList.add('reveal'); t.classList.remove('shimmer'); });

        requestAnimationFrame(function () {
            card.classList.add('visible');
        });
    }

    function hideHover() {
        if (!isShowingHover) return;
        card.classList.remove('visible', 'hover-mode');
        isShowingHover = false;
    }

    function init(logo) {
        createElements();

        var logoContainer = logo.closest('.logo-container');

        // --- HOVER: show quick tooltip after 800ms ---
        logoContainer.addEventListener('mouseenter', function () {
            if (isShowingCinematic) return;
            hoverTimer = setTimeout(function () { showHover(logo); }, 800);
        });

        logoContainer.addEventListener('mouseleave', function () {
            clearTimeout(hoverTimer);
            hideHover();
        });

        // --- DOUBLE-CLICK: replay cinematic ---
        logoContainer.addEventListener('dblclick', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showCinematic(logo);
        });

        // --- SINGLE CLICK: navigate home (default behavior) ---
        // We need to prevent single-click from firing on double-click
        var clickTimer = null;
        logoContainer.addEventListener('click', function (e) {
            if (isShowingCinematic) {
                // During cinematic, click dismisses instead of navigating
                e.preventDefault();
                return;
            }
            // Delay single-click to detect double-click
            if (clickTimer) return; // Already waiting
            e.preventDefault();
            clickTimer = setTimeout(function () {
                clickTimer = null;
                // Perform the navigation
                window.location.href = logoContainer.href || 'index.html';
            }, 300);
        });

        // Cancel single-click on double-click
        logoContainer.addEventListener('dblclick', function () {
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
        });

        // --- MOBILE: long-press for tooltip ---
        var longPressTimer = null;
        var longPressTriggered = false;

        logoContainer.addEventListener('touchstart', function (e) {
            longPressTriggered = false;
            longPressTimer = setTimeout(function () {
                longPressTriggered = true;
                showCinematic(logo);
            }, 600);
        }, { passive: true });

        logoContainer.addEventListener('touchend', function (e) {
            clearTimeout(longPressTimer);
            if (longPressTriggered) {
                e.preventDefault(); // Don't navigate after long-press
            }
        });

        logoContainer.addEventListener('touchmove', function () {
            clearTimeout(longPressTimer);
        }, { passive: true });

        // --- FIRST VISIT: auto cinematic ---
        if (!localStorage.getItem(STORAGE_KEY)) {
            setTimeout(function () {
                showCinematic(logo);
                localStorage.setItem(STORAGE_KEY, Date.now());
            }, 1200);
        }

        // Reposition on scroll/resize
        window.addEventListener('scroll', function () {
            if (isShowingHover) positionCard(logo);
        }, { passive: true });

        window.addEventListener('resize', function () {
            if (isShowingHover || isShowingCinematic) positionCard(logo);
        });
    }

    waitForLogo(init);
})();
