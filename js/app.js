// LDAH Website - Main Application
(function() {
  'use strict';

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
  });

  async function initializeApp() {
    // Initialize Firebase content if needed
    await initializeContent();
    
    // Load all dynamic content
    await Promise.all([
      loadStats(),
      loadServices(),
      loadEvents()
    ]);
    
    // Initialize UI components
    initNavigation();
    initScrollEffects();
    initEditableContent();
  }

  // Load Statistics
  async function loadStats() {
    const container = document.getElementById('statsContainer');
    if (!container) return;

    try {
      const stats = await getStats();
      
      container.innerHTML = stats.map(stat => `
        <div class="stat-card">
          <div class="stat-icon">${stat.icon}</div>
          <div class="stat-number">${stat.number}</div>
          <div class="stat-label">${stat.label}</div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error loading stats:', error);
      container.innerHTML = '<p style="text-align: center; color: #666;">Unable to load statistics.</p>';
    }
  }

  // Load Services
  async function loadServices() {
    const container = document.getElementById('servicesGrid');
    if (!container) return;

    try {
      const servicesData = await getServicesContent();
      const services = servicesData.items || [];
      
      container.innerHTML = services.map(service => `
        <div class="service-card">
          <div class="service-icon">${service.icon}</div>
          <h3 class="service-title">${service.title}</h3>
          <p class="service-description">${service.description}</p>
          <a href="${service.link}" class="service-link">
            Learn More
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error loading services:', error);
      container.innerHTML = '<p style="text-align: center; color: #666;">Unable to load services.</p>';
    }
  }

  // Load Events
  async function loadEvents() {
    const container = document.getElementById('eventsGrid');
    if (!container) return;

    try {
      const events = await getEvents(6);
      
      if (events.length === 0) {
        container.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
            <h3 style="color: var(--primary-blue); margin-bottom: 1rem;">No Upcoming Events</h3>
            <p style="color: var(--text-light);">Check back soon for new workshops, training sessions, and community events!</p>
          </div>
        `;
        return;
      }
      
      container.innerHTML = events.map(event => {
        const eventDate = event.date?.toDate ? event.date.toDate() : new Date(event.date);
        const formattedDate = eventDate.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        });
        
        return `
          <div class="event-card">
            ${event.imageUrl ? `<img src="${event.imageUrl}" alt="${event.title}" class="event-image">` : ''}
            <div class="event-content">
              <span class="event-date">📅 ${formattedDate}</span>
              <h3 class="event-title">${event.title}</h3>
              <p class="event-description">${event.description || ''}</p>
              <div class="event-footer">
                <span class="event-location">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  ${event.location || 'TBA'}
                </span>
                <a href="events.html#${event.id}" class="service-link" style="font-size: 0.9rem;">
                  Details
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('Error loading events:', error);
      container.innerHTML = '<p style="text-align: center; color: #666;">Unable to load events.</p>';
    }
  }

  // Navigation functionality
  function initNavigation() {
    const navbar = document.getElementById('navbar');
    const mobileToggle = document.getElementById('mobileMenuToggle');
    const navLinks = document.getElementById('navLinks');

    // Scroll effect for navbar
    window.addEventListener('scroll', function() {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    });

    // Mobile menu toggle
    if (mobileToggle) {
      mobileToggle.addEventListener('click', function() {
        navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
      });
    }

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href !== '#' && href !== '#donate') {
          e.preventDefault();
          const target = document.querySelector(href);
          if (target) {
            const offsetTop = target.offsetTop - 88; // Account for fixed navbar
            window.scrollTo({
              top: offsetTop,
              behavior: 'smooth'
            });
          }
        }
      });
    });
  }

  // Scroll effects and animations
  function initScrollEffects() {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, observerOptions);

    // Observe all sections
    document.querySelectorAll('.service-card, .event-card, .stat-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      observer.observe(el);
    });
  }

  // Initialize editable content (for CMS mode)
  function initEditableContent() {
    // Check if user is admin (authenticated)
    auth.onAuthStateChanged(async function(user) {
      if (user) {
        // Check if user is admin
        const isAdmin = await checkAdminStatus(user.uid);
        if (isAdmin) {
          enableCMSMode();
        }
      }
    });
  }

  async function checkAdminStatus(uid) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      return userDoc.exists && userDoc.data().role === 'admin';
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }

  function enableCMSMode() {
    // Add edit buttons to editable elements
    document.querySelectorAll('.editable').forEach(element => {
      const editBtn = document.createElement('button');
      editBtn.className = 'cms-edit-btn';
      editBtn.innerHTML = '✏️';
      editBtn.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        background: var(--primary-blue);
        color: white;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        cursor: pointer;
        z-index: 100;
        opacity: 0;
        transition: opacity 0.3s;
      `;
      
      element.style.position = 'relative';
      element.appendChild(editBtn);
      
      element.addEventListener('mouseenter', () => {
        editBtn.style.opacity = '1';
      });
      
      element.addEventListener('mouseleave', () => {
        editBtn.style.opacity = '0';
      });
      
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(element);
      });
    });

    // Add image edit buttons
    document.querySelectorAll('.editable-image').forEach(element => {
      const editBtn = document.createElement('button');
      editBtn.className = 'cms-edit-btn';
      editBtn.innerHTML = '🖼️';
      editBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: var(--primary-blue);
        color: white;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        cursor: pointer;
        z-index: 100;
        opacity: 0;
        transition: opacity 0.3s;
        font-size: 1.2rem;
      `;
      
      element.parentElement.style.position = 'relative';
      element.parentElement.appendChild(editBtn);
      
      element.parentElement.addEventListener('mouseenter', () => {
        editBtn.style.opacity = '1';
      });
      
      element.parentElement.addEventListener('mouseleave', () => {
        editBtn.style.opacity = '0';
      });
      
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openImageEditModal(element);
      });
    });

    console.log('CMS mode enabled');
  }

  function openEditModal(element) {
    const section = element.dataset.section;
    const field = element.dataset.field;
    const currentValue = element.textContent.trim();
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    modal.innerHTML = `
      <div style="
        background: white;
        padding: 2rem;
        border-radius: 16px;
        max-width: 600px;
        width: 90%;
      ">
        <h3 style="margin-bottom: 1rem; color: var(--primary-blue);">Edit Content</h3>
        <textarea 
          id="editContent"
          style="
            width: 100%;
            min-height: 150px;
            padding: 1rem;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-family: inherit;
            font-size: 1rem;
            resize: vertical;
          "
        >${currentValue}</textarea>
        <div style="display: flex; gap: 1rem; margin-top: 1rem; justify-content: flex-end;">
          <button id="cancelEdit" style="
            padding: 0.75rem 1.5rem;
            border: 2px solid var(--primary-blue);
            background: white;
            color: var(--primary-blue);
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
          ">Cancel</button>
          <button id="saveEdit" style="
            padding: 0.75rem 1.5rem;
            border: none;
            background: var(--gradient-1);
            color: white;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
          ">Save Changes</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('cancelEdit').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    document.getElementById('saveEdit').addEventListener('click', async () => {
      const newValue = document.getElementById('editContent').value;
      const result = await updateContent(section, field, newValue);
      
      if (result.success) {
        element.textContent = newValue;
        document.body.removeChild(modal);
        showNotification('Content updated successfully!', 'success');
      } else {
        showNotification('Error updating content: ' + result.error, 'error');
      }
    });
  }

  function openImageEditModal(element) {
    const section = element.dataset.section;
    const field = element.dataset.field;
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    modal.innerHTML = `
      <div style="
        background: white;
        padding: 2rem;
        border-radius: 16px;
        max-width: 500px;
        width: 90%;
      ">
        <h3 style="margin-bottom: 1rem; color: var(--primary-blue);">Change Image</h3>
        <input 
          type="file" 
          id="imageUpload" 
          accept="image/*"
          style="
            width: 100%;
            padding: 1rem;
            border: 2px dashed var(--primary-blue);
            border-radius: 8px;
            cursor: pointer;
          "
        >
        <div style="display: flex; gap: 1rem; margin-top: 1rem; justify-content: flex-end;">
          <button id="cancelImageEdit" style="
            padding: 0.75rem 1.5rem;
            border: 2px solid var(--primary-blue);
            background: white;
            color: var(--primary-blue);
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
          ">Cancel</button>
          <button id="saveImageEdit" style="
            padding: 0.75rem 1.5rem;
            border: none;
            background: var(--gradient-1);
            color: white;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
          ">Upload</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('cancelImageEdit').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    document.getElementById('saveImageEdit').addEventListener('click', async () => {
      const fileInput = document.getElementById('imageUpload');
      const file = fileInput.files[0];
      
      if (!file) {
        showNotification('Please select an image', 'error');
        return;
      }
      
      showNotification('Uploading image...', 'info');
      const result = await uploadImage(file, `website/${section}`);
      
      if (result.success) {
        await updateContent(section, field, result.url);
        element.src = result.url;
        document.body.removeChild(modal);
        showNotification('Image updated successfully!', 'success');
      } else {
        showNotification('Error uploading image: ' + result.error, 'error');
      }
    });
  }

  function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      padding: 1rem 1.5rem;
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
      color: white;
      border-radius: 8px;
      z-index: 10001;
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  // Make functions available globally if needed
  window.LDAHApp = {
    loadStats,
    loadServices,
    loadEvents,
    enableCMSMode
  };
})();
