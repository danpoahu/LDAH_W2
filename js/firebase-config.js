// Firebase Configuration for LDAH Website
const firebaseConfig = {
  apiKey: "AIzaSyAU3CQ07bCVKlJIqGak-i50kaJEyPKldLk",
  authDomain: "ldah-932d5.firebaseapp.com",
  projectId: "ldah-932d5",
  storageBucket: "ldah-932d5.firebasestorage.app",
  messagingSenderId: "662130454003",
  appId: "1:662130454003:web:437576d5a5811ecd8df686",
  measurementId: "G-32PRRS0W85"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

// Collection references
const collections = {
  content: db.collection('website_content'),
  events: db.collection('events'),
  services: db.collection('services'),
  stats: db.collection('stats'),
  team: db.collection('team'),
  testimonials: db.collection('testimonials'),
  settings: db.collection('settings')
};

// CMS Content Structure
const contentStructure = {
  hero: {
    title: "Empowering Families, Transforming Lives",
    subtitle: "Supporting children and youth with disabilities across Hawai'i and the Pacific Islands through advocacy, education, and community partnerships.",
    image: "https://www.ldahawaii.org/wp-content/uploads/2023/10/Leadership-in-Disabilities-Achievement-of-Hawaii-5.jpg",
    buttons: [
      { text: "Our Services", link: "#services", style: "primary" },
      { text: "Get Involved", link: "volunteer.html", style: "secondary" }
    ]
  },
  services: {
    title: "Comprehensive Support Services",
    description: "We provide a wide range of services designed to empower families and support children with disabilities throughout their educational journey.",
    items: [
      {
        icon: "📚",
        title: "Parent Training & Information",
        description: "Comprehensive training and resources to help parents navigate special education systems and advocate for their children.",
        link: "services/parent-training.html"
      },
      {
        icon: "🎓",
        title: "School Readiness Project",
        description: "Early intervention programs helping children with disabilities prepare for successful school experiences.",
        link: "services/school-readiness.html"
      },
      {
        icon: "⚖️",
        title: "Special Education Advocacy",
        description: "Expert guidance on IEPs, IDEA, Chapter 60, and other education laws to ensure your child receives appropriate services.",
        link: "services/advocacy.html"
      },
      {
        icon: "🇺🇸",
        title: "Military Family Support",
        description: "Specialized assistance for military families navigating relocations and IEP transitions across installations.",
        link: "services/military-families.html"
      },
      {
        icon: "🏝️",
        title: "Pacific Islands Outreach",
        description: "Extending support to families across American Samoa, CNMI, FSM, Guam, Marshall Islands, and Palau.",
        link: "services/pacific-islands.html"
      },
      {
        icon: "🤝",
        title: "Community Partnerships",
        description: "Collaborating with schools, agencies, and organizations to build inclusive communities for all children.",
        link: "services/partnerships.html"
      }
    ]
  },
  stats: [
    {
      icon: "👨‍👩‍👧‍👦",
      number: "15,000+",
      label: "Families Served",
      order: 1
    },
    {
      icon: "📅",
      number: "200+",
      label: "Annual Events",
      order: 2
    },
    {
      icon: "🏫",
      number: "50+",
      label: "Years of Service",
      order: 3
    },
    {
      icon: "🌴",
      number: "7",
      label: "Pacific Islands",
      order: 4
    }
  ],
  cta: {
    title: "Ready to Make a Difference?",
    description: "Join our community of volunteers, supporters, and advocates working to create opportunities for children with disabilities.",
    buttons: [
      { text: "Become a Volunteer", link: "volunteer.html", style: "primary" },
      { text: "Support Our Mission", link: "#donate", style: "secondary" }
    ]
  }
};

// Initialize default content in Firestore (run once)
async function initializeContent() {
  try {
    // Check if content already exists
    const heroDoc = await collections.content.doc('hero').get();
    
    if (!heroDoc.exists) {
      console.log('Initializing default content...');
      
      // Hero content
      await collections.content.doc('hero').set(contentStructure.hero);
      
      // Services content
      await collections.content.doc('services').set(contentStructure.services);
      
      // Stats
      for (const stat of contentStructure.stats) {
        await collections.stats.add(stat);
      }
      
      // CTA content
      await collections.content.doc('cta').set(contentStructure.cta);
      
      console.log('Default content initialized successfully!');
    }
  } catch (error) {
    console.error('Error initializing content:', error);
  }
}

// Content fetching functions
async function getHeroContent() {
  try {
    const doc = await collections.content.doc('hero').get();
    return doc.exists ? doc.data() : contentStructure.hero;
  } catch (error) {
    console.error('Error fetching hero content:', error);
    return contentStructure.hero;
  }
}

async function getServicesContent() {
  try {
    const doc = await collections.content.doc('services').get();
    return doc.exists ? doc.data() : contentStructure.services;
  } catch (error) {
    console.error('Error fetching services content:', error);
    return contentStructure.services;
  }
}

async function getStats() {
  try {
    const snapshot = await collections.stats.orderBy('order').get();
    if (!snapshot.empty) {
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
    return contentStructure.stats;
  } catch (error) {
    console.error('Error fetching stats:', error);
    return contentStructure.stats;
  }
}

async function getEvents(limit = 6) {
  try {
    const snapshot = await collections.events
      .where('status', '==', 'published')
      .orderBy('date', 'asc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching events:', error);
    return [];
  }
}

async function getCTAContent() {
  try {
    const doc = await collections.content.doc('cta').get();
    return doc.exists ? doc.data() : contentStructure.cta;
  } catch (error) {
    console.error('Error fetching CTA content:', error);
    return contentStructure.cta;
  }
}

// Content update functions (for CMS)
async function updateContent(section, field, value) {
  try {
    await collections.content.doc(section).update({
      [field]: value,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating content:', error);
    return { success: false, error: error.message };
  }
}

async function updateStat(statId, data) {
  try {
    await collections.stats.doc(statId).update({
      ...data,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating stat:', error);
    return { success: false, error: error.message };
  }
}

// Image upload function
async function uploadImage(file, path) {
  try {
    const storageRef = storage.ref();
    const imageRef = storageRef.child(`${path}/${Date.now()}_${file.name}`);
    const snapshot = await imageRef.put(file);
    const downloadURL = await snapshot.ref.getDownloadURL();
    return { success: true, url: downloadURL };
  } catch (error) {
    console.error('Error uploading image:', error);
    return { success: false, error: error.message };
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    db,
    auth,
    storage,
    collections,
    getHeroContent,
    getServicesContent,
    getStats,
    getEvents,
    getCTAContent,
    updateContent,
    updateStat,
    uploadImage,
    initializeContent
  };
}
