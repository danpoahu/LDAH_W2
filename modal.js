/**
 * LDAH Shared Modal Functions
 * Include this file on all pages that use iframe modals
 */

// Open iframe modal with special handling for different sites
function openIframeModal(title, url) {
    const modal = document.getElementById('iframeModal');
    const titleEl = document.getElementById('iframeTitle');
    const frame = document.getElementById('iframeFrame');
    
    if (!modal || !titleEl || !frame) {
        console.warn('Modal elements not found, opening in new tab');
        window.open(url, '_blank');
        return;
    }
    
    // Special handling for Facebook (blocks iframes entirely)
    if (url.includes('facebook.com')) {
        titleEl.textContent = title;
        frame.outerHTML = `<div id="iframeFrame" style="width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; padding: 3rem; text-align: center; flex-direction: column;">
            <h4 style="color: #004E7C; font-size: 1.5rem; margin-bottom: 1rem;">🌺 Join Our Facebook Community</h4>
            <p style="font-size: 1.1rem; line-height: 1.8; color: #666; margin-bottom: 2rem; max-width: 500px;">Connect with other Hawaii families navigating special education and disabilities. Share experiences, ask questions, and find support.</p>
            <a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 1rem 2rem; background: linear-gradient(135deg, #004E7C, #0066a1); color: white; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 1.1rem;">📱 Open Parent Talk Cafe →</a>
        </div>`;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } 
    // Special handling for HR Symphony / Career pages (job links don't work in iframes)
    else if (url.includes('hrsymphony.com') || url.includes('careers')) {
        titleEl.textContent = title;
        frame.outerHTML = `<div id="iframeFrame" style="width: 100%; flex: 1; display: flex; flex-direction: column;">
            <div style="background: linear-gradient(135deg, #e0f2fe, #f0f9ff); padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid #bae6fd;">
                <p style="color: #0369a1; margin: 0; font-size: 0.95rem;">
                    💼 <strong>Tip:</strong> Click job listings to view details. To apply, open in a new tab.
                </p>
                <a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.25rem; background: linear-gradient(135deg, #004E7C, #0066a1); color: white; border-radius: 50px; text-decoration: none; font-weight: 600; font-size: 0.9rem; white-space: nowrap;">
                    Open in New Tab ↗
                </a>
            </div>
            <iframe src="${url}" style="flex: 1; width: 100%; border: none;" allowfullscreen loading="lazy"></iframe>
        </div>`;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    // Standard iframe handling
    else {
        titleEl.textContent = title;
        // Reset to iframe if it was replaced
        if (frame.tagName !== 'IFRAME') {
            frame.outerHTML = '<iframe id="iframeFrame" class="iframe-frame" src="" allowfullscreen loading="lazy"></iframe>';
        }
        document.getElementById('iframeFrame').src = url;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close iframe modal
function closeIframeModal(event) {
    if (event && event.target !== event.currentTarget && !event.target.classList.contains('close-iframe')) {
        return;
    }
    const modal = document.getElementById('iframeModal');
    const frameEl = document.getElementById('iframeFrame');
    
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Reset to standard iframe structure
    if (frameEl) {
        frameEl.outerHTML = '<iframe id="iframeFrame" class="iframe-frame" src="" allowfullscreen loading="lazy"></iframe>';
    }
    
    document.body.style.overflow = 'auto';
}

// Keyboard support for modals - close on Escape
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeIframeModal();
    }
});
