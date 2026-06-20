const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { verifyToken, isVendor } = require('../middleware/auth');

// All vendor routes require authentication and vendor role
router.use(verifyToken);
router.use(isVendor);

// ============================================
// VENDOR PROFILE MANAGEMENT
// ============================================

// Get vendor profile
router.get('/profile', vendorController.getVendorProfile);

// Update vendor profile
router.put('/profile', vendorController.updateVendorProfile);

// ============================================
// SHOP MANAGEMENT
// ============================================

// Get shop details
router.get('/shop', vendorController.getVendorShop);

// Create or update shop
router.post('/shop', vendorController.createOrUpdateVendorShop);
router.put('/shop', vendorController.createOrUpdateVendorShop);

// Update specific shop settings
router.put('/shop/operating-hours', vendorController.updateShopOperatingHours);
router.put('/shop/capacity', vendorController.updateShopCapacity);

// ============================================
// BLOCK TIME  (uses vendor_early_closures + vendor_holidays tables)
//
//   POST   /vendor/block-time        → blockTime
//   GET    /vendor/block-time        → getBlockedTimes  (?date=YYYY-MM-DD optional)
//   DELETE /vendor/block-time/:id    → deleteBlockedTime (?type=closure|holiday)
// ============================================
router.post  ('/block-time',          vendorController.blockTime);
router.get   ('/block-time',          vendorController.getBlockedTimes);
router.delete('/block-time/:blockId', vendorController.deleteBlockedTime);

// ============================================
// IMAGE MANAGEMENT
// ============================================

// Upload shop profile image
router.post('/shop/profile-image', vendorController.uploadShopProfileImage);

// Upload shop gallery images
router.post('/shop/gallery-images', vendorController.uploadShopGalleryImages);

// Get all shop images
router.get('/shop/images', vendorController.getVendorImages);

// Delete shop image
router.delete('/shop/images/:document_id', vendorController.deleteVendorImage);

// Set primary gallery image
router.put('/shop/images/:document_id/primary', vendorController.setPrimaryImage);

//For vendor App
router.get('/images', vendorController.getVendorImages);

//vendor Images/Docs
router.post('/images', vendorController.uploadShopGalleryImages);

//Delete Image
router.delete('/images/:document_id', vendorController.deleteVendorImage);

// Documents
//For vendor App
router.get('/documents', vendorController.getVendorDocuments);
router.post('/documents', vendorController.uploadVendorDocument);
router.delete('/documents/:document_id', vendorController.deleteVendorImage);

// ============================================
// DASHBOARD
// ============================================

router.get('/dashboard/stats', vendorController.getDashboardStats);

// ============================================
// SERVICE MANAGEMENT
// ============================================

// Get all services from master
router.get('/services/master', vendorController.getAllServicesMaster);

// Get vendor's services
router.get('/services', vendorController.getVendorServices);

// Add single service
router.post('/services', vendorController.addVendorService);

router.post('/custom-service', vendorController.addCustomService);

// Add multiple services
router.post('/services/bulk', vendorController.addMultipleVendorServices);

// Update service
router.put('/services/:service_id', vendorController.updateVendorService);

// Toggle service availability
router.patch('/services/:service_id/availability', vendorController.toggleServiceAvailability);

// Delete service
router.delete('/services/:service_id', vendorController.deleteVendorService);

// ============================================
// BOOKING MANAGEMENT
// ============================================

// Get all bookings (with filters)
router.post('/bookings/offline', vendorController.createOfflineBooking);

router.get('/bookings', vendorController.getVendorBookings);

// Get booking details
router.get('/bookings/:bookingId', vendorController.getBookingDetails);

// Accept booking
router.put('/bookings/:bookingId/accept', vendorController.acceptBooking);

// Reject booking
router.put('/bookings/:bookingId/reject', vendorController.rejectBooking);

// Complete booking
router.put('/bookings/:bookingId/complete', vendorController.completeBooking);

// Mark as no-show
router.put('/bookings/:bookingId/no-show', vendorController.markNoShow);


// ============================================
// REVIEWS
// ============================================

// Get vendor reviews
router.get('/reviews', vendorController.getVendorReviews);

// ============================================
// NOTIFICATIONS
// ============================================

router.get('/notifications', vendorController.getNotifications);
router.put('/notifications/:notificationId/read', vendorController.markNotificationRead);
router.put('/notifications/read-all', vendorController.markAllNotificationsRead);
router.put('/fcm-token', vendorController.updateFCMToken);

module.exports = router;