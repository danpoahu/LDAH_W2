// LDAH CMS - Admin Panel Logic
(function() {
  'use strict';

  let currentUser = null;
  let currentStats = [];
  let currentServices = [];

  // Initialize CMS
  document.addEventListener('DOMContentLoaded', function() {
    initAuth();
    initTabs();
  });

  // Authentication
  function initAuth() {
    auth.onAuthStateChanged(async function(user) {
      if (user) {
        // Check if user is admin
        const isAdmin = await checkAdminStatus(user.uid);
        if (isAdmin) {
          currentUser = user;
          showCMSPanel();
          loadAllContent();
        } else {
          showError('You do not have admin access');
          auth.signOut();
        }
      } else {
        showLoginScreen();
      }
    });

    // Login form
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (error) {
        showError(error.message);
      }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', function() {
      auth.signOut();
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

  function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('cmsPanel').style.display = 'none';
  }

  function showCMSPanel() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('cmsPanel').style.display = 'block';
    document.getElementById('userEmail').textContent = currentUser.email;
  }

  function showError(message) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 5000);
  }

  // Tab Navigation
  function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', function() {
        const tabName = this.dataset.tab;
        
        // Update tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // Update content
        document.querySelectorAll('.tab-content').forEach(content => {
          content.classList.remove('active');
        });
        document.getElementById(tabName + '-tab').classList.add('active');
      });
    });
  }

  // Load All Content
  async function loadAllContent() {
    await Promise.all([
      loadHeroContent(),
      loadStatsContent(),
      loadServicesContent(),
      loadCTAContent()
    ]);
  }

  // Hero Content
  async function loadHeroContent() {
    try {
      const heroData = await getHeroContent();
      document.getElementById('heroTitle').value = heroData.title || '';
      document.getElementById('heroSubtitle').value = heroData.subtitle || '';
      document.getElementById('heroImagePreview').src = heroData.image || '';
    } catch (error) {
      console.error('Error loading hero content:', error);
    }
  }

  window.saveHeroContent = async function() {
    try {
      const title = document.getElementById('heroTitle').value;
      const subtitle = document.getElementById('heroSubtitle').value;
      
      // Handle image upload if new image selected
      const imageInput = document.getElementById('heroImageInput');
      let imageUrl = document.getElementById('heroImagePreview').src;
      
      if (imageInput.files.length > 0) {
        const file = imageInput.files[0];
        const uploadResult = await uploadImage(file, 'website/hero');
        if (uploadResult.success) {
          imageUrl = uploadResult.url;
        } else {
          showNotification('Error uploading image: ' + uploadResult.error, 'error');
          return;
        }
      }
      
      await collections.content.doc('hero').set({
        title,
        subtitle,
        image: imageUrl,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      showSuccessMessage('heroSuccess');
    } catch (error) {
      console.error('Error saving hero content:', error);
      alert('Error saving content: ' + error.message);
    }
  };

  document.getElementById('heroImageInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        document.getElementById('heroImagePreview').src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  // Stats Content
  async function loadStatsContent() {
    try {
      currentStats = await getStats();
      const container = document.getElementById('statsEditor');
      
      container.innerHTML = currentStats.map((stat, index) => `
        <div class="stat-editor">
          <div class="field-group">
            <label>Icon (Emoji)</label>
            <input type="text" class="stat-icon" data-index="${index}" value="${stat.icon || ''}">
          </div>
          <div class="field-group">
            <label>Number</label>
            <input type="text" class="stat-number" data-index="${index}" value="${stat.number || ''}">
          </div>
          <div class="field-group">
            <label>Label</label>
            <input type="text" class="stat-label" data-index="${index}" value="${stat.label || ''}">
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  window.saveStats = async function() {
    try {
      const statEditors = document.querySelectorAll('.stat-editor');
      const updates = [];
      
      statEditors.forEach((editor, index) => {
        const icon = editor.querySelector('.stat-icon').value;
        const number = editor.querySelector('.stat-number').value;
        const label = editor.querySelector('.stat-label').value;
        const statId = currentStats[index].id;
        
        updates.push(
          collections.stats.doc(statId).update({
            icon,
            number,
            label,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
          })
        );
      });
      
      await Promise.all(updates);
      showSuccessMessage('statsSuccess');
    } catch (error) {
      console.error('Error saving stats:', error);
      alert('Error saving statistics: ' + error.message);
    }
  };

  // Services Content
  async function loadServicesContent() {
    try {
      const servicesData = await getServicesContent();
      document.getElementById('servicesTitle').value = servicesData.title || '';
      document.getElementById('servicesDescription').value = servicesData.description || '';
      
      currentServices = servicesData.items || [];
      renderServicesList();
    } catch (error) {
      console.error('Error loading services:', error);
    }
  }

  function renderServicesList() {
    const container = document.getElementById('servicesList');
    container.innerHTML = currentServices.map((service, index) => `
      <div class="service-item">
        <h3>Service ${index + 1}</h3>
        <div class="field-group">
          <label>Icon (Emoji)</label>
          <input type="text" class="service-icon" data-index="${index}" value="${service.icon || ''}">
        </div>
        <div class="field-group">
          <label>Title</label>
          <input type="text" class="service-title" data-index="${index}" value="${service.title || ''}">
        </div>
        <div class="field-group">
          <label>Description</label>
          <textarea class="service-description" data-index="${index}">${service.description || ''}</textarea>
        </div>
        <div class="field-group">
          <label>Link URL</label>
          <input type="text" class="service-link" data-index="${index}" value="${service.link || ''}">
        </div>
        <button class="btn-upload" onclick="removeService(${index})" style="background: #f44336;">Remove Service</button>
      </div>
    `).join('');
  }

  window.addServiceItem = function() {
    currentServices.push({
      icon: '📌',
      title: 'New Service',
      description: 'Service description',
      link: '#'
    });
    renderServicesList();
  };

  window.removeService = function(index) {
    if (confirm('Are you sure you want to remove this service?')) {
      currentServices.splice(index, 1);
      renderServicesList();
    }
  };

  window.saveServices = async function() {
    try {
      const title = document.getElementById('servicesTitle').value;
      const description = document.getElementById('servicesDescription').value;
      
      // Collect service data from form
      const services = Array.from(document.querySelectorAll('.service-item')).map((item, index) => ({
        icon: item.querySelector('.service-icon').value,
        title: item.querySelector('.service-title').value,
        description: item.querySelector('.service-description').value,
        link: item.querySelector('.service-link').value
      }));
      
      await collections.content.doc('services').set({
        title,
        description,
        items: services,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      showSuccessMessage('servicesSuccess');
    } catch (error) {
      console.error('Error saving services:', error);
      alert('Error saving services: ' + error.message);
    }
  };

  // CTA Content
  async function loadCTAContent() {
    try {
      const ctaData = await getCTAContent();
      document.getElementById('ctaTitle').value = ctaData.title || '';
      document.getElementById('ctaDescription').value = ctaData.description || '';
    } catch (error) {
      console.error('Error loading CTA content:', error);
    }
  }

  window.saveCTA = async function() {
    try {
      const title = document.getElementById('ctaTitle').value;
      const description = document.getElementById('ctaDescription').value;
      
      await collections.content.doc('cta').set({
        title,
        description,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      showSuccessMessage('ctaSuccess');
    } catch (error) {
      console.error('Error saving CTA content:', error);
      alert('Error saving content: ' + error.message);
    }
  };

  // Utility Functions
  function showSuccessMessage(elementId) {
    const element = document.getElementById(elementId);
    element.style.display = 'block';
    setTimeout(() => {
      element.style.display = 'none';
    }, 3000);
  }

  function showNotification(message, type) {
    alert(message);
  }
})();
