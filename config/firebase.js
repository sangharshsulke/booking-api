// config/firebase.js
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  try {
    const serviceAccount = require('./serviceAccountKey.json');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error.message);
    console.log('⚠️  Running in development mode without Firebase verification');
    console.log('⚠️  Make sure to add serviceAccountKey.json to config/ folder for production');
  }
}

module.exports = admin;