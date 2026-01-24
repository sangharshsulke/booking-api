const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middleware/auth');

// All admin routes require authentication and admin privileges
router.use(verifyToken);
router.use(isAdmin);

// Dashboard
router.get('/dashboard/stats', adminController.getDashboardStats);

// User Management
router.get('/users', adminController.getAllUsers);
router.get('/users/:id', adminController.getUserById);
router.put('/users/:id/status', adminController.updateUserStatus);
router.delete('/users/:id', adminController.deleteUser);

// Create Admin (only SUPERADMIN)
router.post('/users/admin', isSuperAdmin, adminController.createAdmin);

// Vendor Management
router.get('/vendors', adminController.getAllVendors);
router.get('/vendors/:id', adminController.getVendorById);
router.put('/vendors/:id/verification', adminController.updateVendorVerification);
router.put('/documents/:documentId/verification', adminController.updateDocumentVerification);
router.put('/vendors/:id/shop', adminController.updateVendorShop);
router.put('/vendors/:id/shop/profile-image', adminController.uploadShopProfileImage);
router.post('/vendors/:id/shop/gallery-images', adminController.uploadShopGalleryImages);
router.delete('/vendors/:id/shop/images/:imageId', adminController.deleteShopImage);
router.put('/vendors/:id/shop/images/:imageId/primary', adminController.setShopPrimaryImage);

// Vendor Documents Routes
router.get('/vendors/:id/documents',adminController.getVendorDocuments);
router.post('/vendors/:id/documents', adminController.uploadVendorDocument);
router.put('/documents/:id/verification', adminController.updateDocumentVerification);
router.delete('/documents/:id',adminController.deleteVendorDocument);


router.put('/vendors/:id/shop/profile-image', adminController.uploadShopProfileImage);
router.post('/vendors/:id/shop/gallery-images', adminController.uploadShopGalleryImages);
router.delete('/vendors/:id/shop/images/:imageId', adminController.deleteShopImage);
router.put('/vendors/:id/shop/images/:imageId/primary', adminController.setShopPrimaryImage);
router.get('/vendors/:id/documents', adminController.getVendorDocuments);
router.post('/vendors/:id/documents', adminController.uploadVendorDocument);
router.delete('/documents/:id', adminController.deleteVendorDocument);

//Service Management
router.get('/services', adminController.getAllServices);
router.get('/services/:id', adminController.getServiceById);
router.post('/services', adminController.createService);
router.put('/services/:id', adminController.updateService);
router.delete('/services/:id', adminController.deleteService);
router.put('/services/:id/availability', adminController.toggleServiceAvailability);

// Category Management Routes
router.get('/categories', adminController.getAllCategories);
router.get('/categories/:id', adminController.getCategoryById);
router.post('/categories', adminController.createCategory);
router.put('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);

// Booking Management
router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:id', adminController.getBookingById);
router.post('/bookings', adminController.createBooking);
router.put('/bookings/:id/status', adminController.updateBookingStatus);
router.put('/bookings/:id/cancel', adminController.cancelBooking);
router.get('/vendors/:id/services', adminController.getVendorServicesForBooking);

//Notification
router.post('/send-notification', adminController.sendNotification);
router.get('/fcm-tokens', adminController.checkUserFCMTokens);



module.exports = router;
