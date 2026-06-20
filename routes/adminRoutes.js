const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middleware/auth');

// All admin routes require authentication + admin role
router.use(verifyToken);
router.use(isAdmin);

// ============================================
// DASHBOARD
// ============================================

router.get('/dashboard/stats', adminController.getDashboardStats);

// ============================================
// USER MANAGEMENT
// ============================================

router.get('/users', adminController.getAllUsers);
router.get('/users/:id', adminController.getUserById);
router.put('/users/:id/status', adminController.updateUserStatus);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.delete('/users/:id', adminController.deleteUser);

// Create Admin — SUPERADMIN only
// FIX: isSuperAdmin was undefined (not exported from auth middleware).
// Now exported → this route no longer crashes Express on startup.
router.post('/users/admin', isSuperAdmin, adminController.createAdmin);

// ============================================
// VENDOR MANAGEMENT
// ============================================

router.get('/vendors', adminController.getAllVendors);
router.get('/vendors/:id', adminController.getVendorById);
router.put('/vendors/:id/verification', adminController.updateVendorVerification);
router.put('/vendors/:id/shop', adminController.updateVendorShop);

// Shop images
router.put('/vendors/:id/shop/profile-image', adminController.uploadShopProfileImage);
router.post('/vendors/:id/shop/gallery-images', adminController.uploadShopGalleryImages);
router.delete('/vendors/:id/shop/images/:imageId', adminController.deleteShopImage);
router.put('/vendors/:id/shop/images/:imageId/primary', adminController.setShopPrimaryImage);

// Vendor documents
router.get('/vendors/:id/documents', adminController.getVendorDocuments);
router.post('/vendors/:id/documents', adminController.uploadVendorDocument);

// Document verification (two path styles — keep both for compatibility)
router.put('/documents/:documentId/verification', adminController.updateDocumentVerification);
router.delete('/documents/:documentId', adminController.deleteVendorDocument);

// Vendor services (for booking creation in admin panel)
router.get('/vendors/:id/services', adminController.getVendorServicesForBooking);

// ============================================
// SERVICE MANAGEMENT
// ============================================

router.get('/services', adminController.getAllServices);
router.get('/services/:id', adminController.getServiceById);
router.post('/services', adminController.createService);
router.put('/services/:id', adminController.updateService);
router.delete('/services/:id', adminController.deleteService);
router.put('/services/:id/availability', adminController.toggleServiceAvailability);

// ============================================
// CATEGORY MANAGEMENT
// ============================================

router.get('/categories', adminController.getAllCategories);
router.get('/categories/:id', adminController.getCategoryById);
router.post('/categories', adminController.createCategory);
router.put('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);

// ============================================
// BOOKING MANAGEMENT
// ============================================

router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:id', adminController.getBookingById);
router.post('/bookings', adminController.createBooking);
router.put('/bookings/:id/status', adminController.updateBookingStatus);
router.put('/bookings/:id/cancel', adminController.cancelBooking);

// Add/remove vendor services via admin
router.post('/vendors/:id/services/add', adminController.adminAddVendorService);
router.delete('/vendors/:id/services/:serviceId', adminController.adminRemoveVendorService);

// ============================================
// NOTIFICATIONS (optional — only if adminController exports them)
// ============================================

if (typeof adminController.sendNotification === 'function') {
    router.post('/send-notification', adminController.sendNotification);
}
if (typeof adminController.checkUserFCMTokens === 'function') {
    router.get('/fcm-tokens', adminController.checkUserFCMTokens);
}

module.exports = router;