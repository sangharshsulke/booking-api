const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

// ============================================
// PUBLIC ROUTES — OTP BASED
// ============================================

router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/check-user', authController.checkUser);

// ============================================
// PUBLIC ROUTES — TRADITIONAL (legacy)
// ============================================

router.post('/login', authController.login);
router.post('/register', authController.register);

// ============================================
// PROTECTED ROUTES
// ============================================

router.get('/profile', verifyToken, authController.getProfile);
router.put('/profile', verifyToken, authController.updateProfile);

// B15: Logout clears device_id so the old JWT can no longer pass
// the device_id check in the auth middleware.
router.post('/logout', verifyToken, authController.logout);

module.exports = router;