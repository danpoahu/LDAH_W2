// Header and Footer Loader
// This script loads the reusable header and footer into any page.
// NH Survey asset lazy-loading removed 2026-05-31 per Rosie's request — survey disabled.
// ensureNHSurveyAssets() and openNHSurvey() are no-ops; retained as stubs so
// footer.html onclick refs (if any old copies exist) don't throw ReferenceError.

function ensureNHSurveyAssets() {
    // DISABLED 2026-05-31 per Rosie's request — survey trigger removed.
}

// openNHSurvey() stub — footer link removed but kept for safety if old cached pages call it.
function openNHSurvey() {
    // DISABLED 2026-05-31 per Rosie's request.
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

        console.log('Header and footer loaded successfully');
    } catch (error) {
        console.error('❌ Error loading header/footer:', error);
    }
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
