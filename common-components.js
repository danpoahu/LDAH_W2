// LDAH Common Components - Header and Footer System

// Header Component
const headerHTML = `
<header class="site-header">
    <div class="header-content">
        <a href="index.html" class="logo-container">
            <img src="https://www.ldahawaii.org/wp-content/uploads/2023/10/Leadership-in-Disabilities-Achievement-of-Hawaii-4.jpg" 
                 alt="LDAH Logo" 
                 class="logo">
        </a>
        <nav>
            <ul class="nav-menu">
                <li><a href="index.html">Home</a></li>
                <li><a href="about.html">Who We Are</a></li>
                <li><a href="services.html">What We Do</a></li>
                <li><a href="calendar.html">What's Happening</a></li>
                <li><a href="resources.html">Resources</a></li>
                <li><a href="contact.html">Contact</a></li>
            </ul>
        </nav>
        <button class="mobile-menu-toggle" aria-label="Toggle menu">
            ☰
        </button>
    </div>
</header>
`;

// Footer Component
const footerHTML = `
<footer class="site-footer">
    <div class="footer-content">
        <div class="footer-grid">
            <div class="footer-section">
                <h3>Honolulu Office</h3>
                <address>
                    Harry and Jeanette Weinberg<br>
                    Kukui Center<br>
                    245 North Kukui Street, Suite 205<br>
                    Honolulu, HI 96817<br>
                    <br>
                    Phone: (808) 536-9684<br>
                    Fax: (808) 537-6780<br>
                    <br>
                    Monday to Friday – 8am to 5pm
                </address>
            </div>
            
            <div class="footer-section">
                <h3>Ma'ili Office</h3>
                <address>
                    School Readiness Project<br>
                    Community Learning Center<br>
                    Kauhale Building<br>
                    87-790 Kulauku St., Suite A116<br>
                    Wai'anae, HI 96792<br>
                    <br>
                    Phone: (808) 696-5361<br>
                    Fax: (808) 696-5371<br>
                    <br>
                    Monday to Friday – 8am to 5pm
                </address>
            </div>
            
            <div class="footer-section">
                <h3>Quick Links</h3>
                <p>
                    <a href="volunteer.html">Volunteer</a><br>
                    <a href="resources.html">Resources</a><br>
                    <a href="news.html">News & Events</a><br>
                    <a href="pacific-islands.html">Pacific Islands</a><br>
                    <a href="contact.html">Contact Us</a>
                </p>
            </div>
            
            <div class="footer-section">
                <h3>Connect With Us</h3>
                <p>Stay updated with our latest news and events</p>
                <div class="social-links">
                    <a href="#" aria-label="Facebook">f</a>
                    <a href="#" aria-label="Twitter">t</a>
                    <a href="#" aria-label="Instagram">i</a>
                </div>
            </div>
        </div>
        
        <div class="footer-bottom">
            <p>© 2025 Leadership in Disabilities and Achievement of Hawai'i (LDAH). All Rights Reserved.</p>
            <p style="margin-top: 10px; font-size: 0.9em;">IT Powered by DP Consulting</p>
        </div>
    </div>
</footer>
`;

// Initialize header and footer
document.addEventListener('DOMContentLoaded', function() {
    // Inject header
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
        headerContainer.innerHTML = headerHTML;
    }
    
    // Inject footer
    const footerContainer = document.getElementById('footer-container');
    if (footerContainer) {
        footerContainer.innerHTML = footerHTML;
    }
    
    // Mobile menu toggle functionality
    const mobileToggle = document.querySelector('.mobile-menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    
    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener('click', function() {
            navMenu.style.display = navMenu.style.display === 'flex' ? 'none' : 'flex';
        });
    }
});

// Page tracking function for Firebase Analytics
function initializePageTracking(pageName) {
    // This will be implemented when Firebase is configured
    console.log('Page view tracked:', pageName);
    
    // If Firebase Analytics is available
    if (typeof gtag !== 'undefined') {
        gtag('event', 'page_view', {
            page_title: pageName,
            page_location: window.location.href,
            page_path: window.location.pathname
        });
    }
}
