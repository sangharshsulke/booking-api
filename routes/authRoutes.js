const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

// ============================================
// PUBLIC ROUTES - OTP BASED
// ============================================

// // Send OTP (Firebase handles this on client side)
router.post('/send-otp', authController.sendOTP);

// // Verify OTP and Register/Login
router.post('/verify-otp', authController.verifyOTP);

// ============================================
// PUBLIC ROUTES - TRADITIONAL (Optional)
// ============================================

// Traditional login (for users with password)
router.post('/login', authController.login);

router.post('/register', authController.register);

// ============================================
// PROTECTED ROUTES
// ============================================

// Get current user profile
router.get('/profile', verifyToken, authController.getProfile);

// Update user profile
router.put('/profile', verifyToken, authController.updateProfile);

// Logout
// router.post('/logout', verifyToken, authController.logout);

module.exports = router;