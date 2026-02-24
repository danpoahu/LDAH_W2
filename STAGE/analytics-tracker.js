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
    // Handle GitHub Pages subpath
    const cleanPath = path.replace(/^\/LDAH_W2/, '') || '/';
    return PAGE_NAMES[cleanPath] || cleanPath.replace(/^\/|\.html$/g, '') || 'home';
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

    // Build the update object from pending events
    const update = { date: dateKey };
    const pageName = getPageName();

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

    // Always register this visitor
    update['visitorIds'] = arrayUnion(visitorId);

    // Use set with merge to create doc if it doesn't exist
    docRef.set(update, { merge: true }).catch(function(err) {
      console.warn('Analytics flush error:', err.message);
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

  function trackFormSubmit(formName) {
    queueEvent('form_submit', { form: formName });
    fireGA4Event('form_submit', { form_name: formName });
    flushEvents();
  }

  // --- Auto-attach click listeners via event delegation ---
  document.addEventListener('click', function(e) {
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

  // PayPal form submit (the donate button is a form, not a link, on some pages)
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.action && form.action.indexOf('paypal.com/donate') !== -1) {
      trackDonationClick(form.action);
    }
  }, true);

  // --- Monkey-patch modal functions for tracking ---
  function patchModalFunctions() {
    // Patch openIframeModal
    if (typeof window.openIframeModal === 'function') {
      var originalIframe = window.openIframeModal;
      window.openIframeModal = function(title, url) {
        trackModalOpen(title || url || 'iframe');
        return originalIframe.apply(this, arguments);
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
    trackDonationClick: trackDonationClick,
    trackPhoneCall: trackPhoneCall,
    trackEmailClick: trackEmailClick,
    trackOutboundClick: trackOutboundClick
  };

  // --- Initialize ---
  function init() {
    trackPageView();
    patchModalFunctions();

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
