// config/firebase.js
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  try {
    // Railway / production: use environment variables
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Railway stores \n as literal \\n — unescape it
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      console.log('✅ Firebase Admin SDK initialized via environment variables');
    } else {
      // Local development: use serviceAccountKey.json
      const serviceAccount = require('./serviceAccountKey.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase Admin SDK initialized via serviceAccountKey.json');
    }
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error.message);
    console.log('⚠️  OTP verification will not work without Firebase credentials');
  }
}

module.exports = admin;