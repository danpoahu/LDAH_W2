// Header and Footer Loader
// This script loads the reusable header and footer into any page.
// It also lazy-loads the Native Hawaiian Survey modal assets (CSS + JS)
// so the "Native Hawaiian Survey" footer link works on every page,
// not just pages that explicitly include the survey assets in their <head>.

function ensureNHSurveyAssets() {
    // Skip if controller is already present
    if (window.NHSurveyModal) return;

    // CSS — append to <head> if not already linked
    var existingCss = document.querySelector('link[href$="nh-survey-modal.css"]');
    if (!existingCss) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'nh-survey-modal.css';
        document.head.appendChild(link);
    }

    // JS — append to <body> if not already loaded.
    // The footer link only needs openManual(), which works without calling init(),
    // so we don't auto-init the survey on non-homepage pages.
    var existingJs = document.querySelector('script[src$="nh-survey-modal.js"]');
    if (!existingJs) {
        var script = document.createElement('script');
        script.src = 'nh-survey-modal.js';
        script.defer = true;
        document.body.appendChild(script);
    }
}

async function loadHeaderFooter() {
    try {
        // Load header
        const headerResponse = await fetch('header.html');
        const headerHtml = await headerResponse.text();
        document.getElementById('header-container').innerHTML = headerHtml;

        // Load footer
        const footerResponse = await fetch('footer.html');
        const footerHtml = await footerResponse.text();
        document.getElementById('footer-container').innerHTML = footerHtml;

        // Make sure the survey assets are available so the footer's
        // "Native Hawaiian Survey" link can call NHSurveyModal.openManual().
        ensureNHSurveyAssets();

        console.log('Header and footer loaded successfully');
    } catch (error) {
        console.error('❌ Error loading header/footer:', error);
    }
}

// Footer "Native Hawaiian Survey" link handler. Tolerates the survey
// script not being fully loaded yet by retrying briefly.
function openNHSurvey(ev) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    ensureNHSurveyAssets();
    var attempts = 0;
    function tryOpen() {
        if (window.NHSurveyModal && typeof window.NHSurveyModal.openManual === 'function') {
            window.NHSurveyModal.openManual();
            return;
        }
        attempts += 1;
        if (attempts < 40) {  // ~4 seconds max
            setTimeout(tryOpen, 100);
        } else {
            console.warn('[NHSurvey] modal controller never loaded');
        }
    }
    tryOpen();
}

// Mobile menu toggle function (needed for header)
function toggleMenu() {
    const navLinks = document.getElementById('navLinks');
    if (navLinks) {
        navLinks.classList.toggle('active');
    }
}

// Load on page ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHeaderFooter);
} else {
    loadHeaderFooter();
}
