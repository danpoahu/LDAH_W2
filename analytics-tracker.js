// LDAH Analytics Tracker
// Tracks page views, unique visitors, and user interactions
// Stores data in both GA4 and Firebase for CMS dashboard display

(function() {
  'use strict';

  // --- Configuration ---
  const ANALYTICS_COLLECTION = 'siteAnalytics';
  const FLUSH_INTERVAL = 30000; // 30 seconds
  const PAGE_NAMES = {
    '/': 'home', '/index.html': 'home',
    '/contact.html': 'contact',
    '/volunteer.html': 'volunteer',
    '/events.html': 'events',
    '/whoweare.html': 'whoweare',
    '/resources.html': 'resources',
    '/readiness.html': 'readiness',
    '/specialed.html': 'specialed',
    '/military.html': 'military',
    '/pacific.html': 'pacific',
    '/community.html': 'community',
    '/accessibility.html': 'accessibility',
    '/install.html': 'install',
    '/cms.html': 'cms'
  };

  // --- Visitor & Session IDs ---
  function getVisitorId() {
    let id = localStorage.getItem('ldah_visitor_id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('ldah_visitor_id', id);
    }
    return id;
  }

  function getSessionId() {
    let id = sessionStorage.getItem('ldah_session_id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : 's-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('ldah_session_id', id);
    }
    return id;
  }

  const visitorId = getVisitorId();
  const sessionId = getSessionId();

  // --- Page identification ---
  function getPageName() {
    const path = window.location.pathname;
    // Handle GitHub Pages subpath and STAGE path
    const cleanPath = path.replace(/^\/LDAH_W2/, '').replace(/^\/STAGE/, '') || '/';
    const mapped = PAGE_NAMES[cleanPath];
    if (mapped) return mapped;
    // Fallback: strip slashes/extension and replace illegal Firestore field chars
    return cleanPath.replace(/^\/|\.html$/g, '').replace(/[~*\/\[\]]/g, '_') || 'home';
  }

  // --- Pending events buffer ---
  let pendingEvents = [];
  let pageviewTracked = false;

  function queueEvent(eventType, details) {
    pendingEvents.push({ type: eventType, details: details || {}, timestamp: Date.now() });
  }

  // --- Firebase write (daily aggregation) ---
  function getDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function flushEvents() {
    if (pendingEvents.length === 0) return;
    if (typeof firebase === 'undefined' || !firebase.firestore) return;

    const db = firebase.firestore();
    const dateKey = getDateKey();
    const docRef = db.collection(ANALYTICS_COLLECTION).doc(dateKey);
    const increment = firebase.firestore.FieldValue.increment;
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;

    // Build update with dot-notation keys (update() treats these as nested paths)
    const pageName = getPageName();
    var update = {};

    pendingEvents.forEach(function(evt) {
      switch (evt.type) {
        case 'pageview':
          update['pageviews.' + pageName] = increment(1);
          update['totalPageviews'] = increment(1);
          break;
        case 'donation_click':
          update['events.donation_click'] = increment(1);
          break;
        case 'phone_call':
          update['events.phone_call'] = increment(1);
          break;
        case 'email_click':
          update['events.email_click'] = increment(1);
          break;
        case 'outbound_click':
          update['events.outbound_click'] = increment(1);
          break;
        case 'document_view':
          var docKey = (evt.details.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 50);
          update['events.document_view.' + docKey] = increment(1);
          update['events.document_view_total'] = increment(1);
          break;
        case 'modal_open':
          var modalKey = (evt.details.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 40);
          update['events.modal_open.' + modalKey] = increment(1);
          update['events.modal_open_total'] = increment(1);
          break;
        case 'form_submit':
          var formKey = (evt.details.form || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
          update['events.form_submit.' + formKey] = increment(1);
          update['events.form_submit_total'] = increment(1);
          break;
      }
    });

    // Stamp date on EVERY write, not just on create. The create path below
    // sets it, but if something else created today's doc first (the flyer
    // popup does, with a merge:true set) this update path ran instead and
    // the field was never written -- and the analytics report filters on it.
    update['date'] = dateKey;
    update['visitorIds'] = arrayUnion(visitorId);

    // Try update() first — dot-notation keys become nested paths with update()
    // Fall back to set() with nested objects if doc doesn't exist yet
    docRef.update(update).catch(function(err) {
      if (err.code === 'not-found') {
        // Doc doesn't exist yet today — create with properly nested structure
        var pageviews = {};
        var events = {};
        var totalPV = 0;
        pendingEvents.forEach(function(evt) {
          switch (evt.type) {
            case 'pageview': pageviews[pageName] = (pageviews[pageName] || 0) + 1; totalPV++; break;
            case 'donation_click': events['donation_click'] = (events['donation_click'] || 0) + 1; break;
            case 'phone_call': events['phone_call'] = (events['phone_call'] || 0) + 1; break;
            case 'email_click': events['email_click'] = (events['email_click'] || 0) + 1; break;
            case 'outbound_click': events['outbound_click'] = (events['outbound_click'] || 0) + 1; break;
            case 'document_view':
              if (!events['document_view']) events['document_view'] = {};
              var dk = (evt.details.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 50);
              events['document_view'][dk] = (events['document_view'][dk] || 0) + 1;
              events['document_view_total'] = (events['document_view_total'] || 0) + 1;
              break;
            case 'modal_open':
              if (!events['modal_open']) events['modal_open'] = {};
              var mk = (evt.details.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 40);
              events['modal_open'][mk] = (events['modal_open'][mk] || 0) + 1;
              events['modal_open_total'] = (events['modal_open_total'] || 0) + 1;
              break;
            case 'form_submit':
              if (!events['form_submit']) events['form_submit'] = {};
              var fk = (evt.details.form || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
              events['form_submit'][fk] = (events['form_submit'][fk] || 0) + 1;
              events['form_submit_total'] = (events['form_submit_total'] || 0) + 1;
              break;
          }
        });
        var setData = { date: dateKey, totalPageviews: totalPV, visitorIds: [visitorId] };
        if (Object.keys(pageviews).length) setData.pageviews = pageviews;
        if (Object.keys(events).length) setData.events = events;
        docRef.set(setData).catch(function(e) {
          console.warn('Analytics create error:', e.message);
        });
      } else {
        console.warn('Analytics flush error:', err.message);
      }
    });

    pendingEvents = [];
  }

  // --- GA4 event helper ---
  function fireGA4Event(eventName, params) {
    if (typeof gtag === 'function') {
      gtag('event', eventName, params || {});
    }
  }

  // --- Track page view ---
  function trackPageView() {
    if (pageviewTracked) return;
    var sessionPages = JSON.parse(sessionStorage.getItem('ldah_tracked_pages') || '[]');
    var pageName = getPageName();
    if (sessionPages.indexOf(pageName) !== -1) {
      pageviewTracked = true;
      return; // Already tracked this page this session
    }
    sessionPages.push(pageName);
    sessionStorage.setItem('ldah_tracked_pages', JSON.stringify(sessionPages));
    pageviewTracked = true;

    queueEvent('pageview');
    fireGA4Event('page_view', {
      page_title: pageName,
      page_location: window.location.href,
      page_path: window.location.pathname,
      visitor_id: visitorId
    });
  }

  // --- Event tracking functions ---
  function trackDonationClick(url) {
    queueEvent('donation_click', { url: url });
    fireGA4Event('donation_click', { link_url: url });
    flushEvents(); // Flush immediately for outbound navigation
  }

  function trackPhoneCall(number) {
    queueEvent('phone_call', { number: number });
    fireGA4Event('phone_call', { phone_number: number });
    flushEvents();
  }

  function trackEmailClick(email) {
    queueEvent('email_click', { email: email });
    fireGA4Event('email_click', { email_address: email });
    flushEvents();
  }

  function trackOutboundClick(url) {
    queueEvent('outbound_click', { url: url });
    fireGA4Event('outbound_click', { link_url: url });
    flushEvents();
  }

  function trackModalOpen(name) {
    queueEvent('modal_open', { name: name });
    fireGA4Event('modal_open', { modal_name: name });
  }

  function trackDocumentView(docName) {
    queueEvent('document_view', { name: docName });
    fireGA4Event('document_view', { document_name: docName });
    flushEvents();
  }

  function trackFormSubmit(formName) {
    queueEvent('form_submit', { form: formName });
    fireGA4Event('form_submit', { form_name: formName });
    flushEvents();
  }

  // --- Auto-attach click listeners via event delegation ---
  document.addEventListener('click', function(e) {
    // PayPal donate button (input type="image" inside a PayPal form)
    var paypalForm = e.target.closest('form[action*="paypal.com/donate"]');
    if (paypalForm) {
      trackDonationClick(paypalForm.getAttribute('action'));
      return;
    }

    var link = e.target.closest('a');
    if (!link) return;

    var href = link.getAttribute('href') || '';

    // PayPal donation links
    if (href.indexOf('paypal.com/donate') !== -1) {
      trackDonationClick(href);
      return;
    }

    // Phone calls
    if (href.indexOf('tel:') === 0) {
      trackPhoneCall(href.replace('tel:', ''));
      return;
    }

    // Email links
    if (href.indexOf('mailto:') === 0) {
      trackEmailClick(href.replace('mailto:', '').split('?')[0]);
      return;
    }

    // External / outbound links (target="_blank" or different domain)
    if (link.target === '_blank' && href.indexOf('javascript:') !== 0) {
      trackOutboundClick(href);
      return;
    }
  }, true);

  // (PayPal form clicks are tracked via the click handler above)

  // --- Monkey-patch modal functions for tracking ---
  function patchModalFunctions() {
    // Patch openIframeModal — also detect PDF/document views
    if (typeof window.openIframeModal === 'function') {
      var originalIframe = window.openIframeModal;
      window.openIframeModal = function(title, url) {
        trackModalOpen(title || url || 'iframe');
        // Track document/PDF views separately for dashboard reporting
        if (url && url.match(/\.(pdf|doc|docx)(\?|$)/i)) {
          trackDocumentView(title || url);
        }
        return originalIframe.apply(this, arguments);
      };
    }

    // Patch openVideoModal for webinar/video tracking
    if (typeof window.openVideoModal === 'function') {
      var originalVideo = window.openVideoModal;
      window.openVideoModal = function(title, videoId) {
        trackDocumentView(title || videoId || 'video');
        trackModalOpen('video_' + (title || videoId || 'unknown'));
        return originalVideo.apply(this, arguments);
      };
    }

    // Patch openMapModal
    if (typeof window.openMapModal === 'function') {
      var originalMap = window.openMapModal;
      window.openMapModal = function(officeName, mapUrl) {
        trackModalOpen('map_' + (officeName || 'unknown'));
        return originalMap.apply(this, arguments);
      };
    }
  }

  // --- Expose form tracking globally for existing form handlers ---
  window.ldahAnalytics = {
    trackFormSubmit: trackFormSubmit,
    trackModalOpen: trackModalOpen,
    trackDocumentView: trackDocumentView,
    trackDonationClick: trackDonationClick,
    trackPhoneCall: trackPhoneCall,
    trackEmailClick: trackEmailClick,
    trackOutboundClick: trackOutboundClick
  };

  // --- Initialize ---
  function init() {
    trackPageView();
    patchModalFunctions();

    // Fix footer year (innerHTML doesn't execute inline script tags)
    // Run immediately + delayed retry for async-loaded footer
    function fixDynamicYear() {
      document.querySelectorAll('.dynamic-year').forEach(function(el) {
        if (!el.textContent) el.textContent = new Date().getFullYear();
      });
    }
    fixDynamicYear();
    setTimeout(fixDynamicYear, 1500);
    setTimeout(fixDynamicYear, 3000);

    // Periodic flush
    setInterval(flushEvents, FLUSH_INTERVAL);

    // Flush on page unload
    window.addEventListener('beforeunload', function() {
      flushEvents();
    });

    // Also flush on visibility change (mobile backgrounding)
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        flushEvents();
      }
    });
  }

  // Wait for Firebase to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Small delay to let Firebase initialize
      setTimeout(init, 500);
    });
  } else {
    setTimeout(init, 500);
  }

})();
