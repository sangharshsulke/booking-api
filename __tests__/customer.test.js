/**
 * Customer API Tests
 * Routes tested (all under /api/customer — require verifyToken):
 *   GET  /dashboard/stats
 *   GET  /shops
 *   GET  /shops/:shopId
 *   GET  /shops/:shopId/available-slots
 *   POST /bookings
 *   GET  /bookings
 *   GET  /bookings/:bookingId
 *   PUT  /bookings/:bookingId/cancel
 *   POST /reviews
 *   GET  /categories
 *   GET  /categories/:category/services
 *   GET  /notifications
 *   PUT  /notifications/:notificationId/read
 *   PUT  /notifications/read-all
 *   PUT  /fcm-token
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../server');
const db      = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-unit-tests';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeCustomerToken = (userId = 10) =>
  jwt.sign({ userId, userType: 'CUSTOMER', deviceId: 'dev-c' }, JWT_SECRET, { expiresIn: '1d' });

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * verifyToken queries the DB once to check device_id.
 * Call this before every "real" DB mock to pre-fill that first slot.
 */
const dc = (deviceId = 'dev-c') =>
  db.query.mockResolvedValueOnce({ rows: [{ device_id: deviceId }] });

/** Returns a booking date ~6 months in the future */
const futureDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
};

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockShop = {
  shop_id:             1,
  vendor_id:           5,
  user_id:             5,
  shop_name:           'Test Salon',
  shop_address:        '123 Main St',
  city:                'Mumbai',
  state:               'MH',
  open_time:           '09:00',
  close_time:          '21:00',
  break_start_time:    null,
  break_end_time:      null,
  weekly_holiday:      null,   // null — NOT [] (array.toLowerCase() throws in slotService)
  no_of_seats:         2,
  latitude:            19.076,
  longitude:           72.877,
  verification_status: 'approved',
  average_rating:      4.5,
  total_reviews:       20,
};

const mockBooking = {
  booking_id:     100,
  customer_id:    10,
  vendor_id:      5,
  shop_id:        1,
  booking_date:   '2026-12-25',
  time_slot:      '10:00',
  booking_status: 'confirmed',
  status:         'active',
  total_amount:   500,
  services:       [{ service_id: 1, service_name: 'Haircut', price: 250, duration_minutes: 30 }],
};

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/dashboard/stats
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/dashboard/stats', () => {
  test('should return dashboard stats for authenticated customer', async () => {
    // Arrange — controller makes 3 db.query calls:
    //   1. bookingsStats (aggregate counts)
    //   2. upcomingBookings (list)
    //   3. favoriteVendors (list)
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ total_bookings: '5', completed_bookings: '3', upcoming_bookings: '1', cancelled_bookings: '1' }] })
      .mockResolvedValueOnce({ rows: [] })   // upcomingBookings
      .mockResolvedValueOnce({ rows: [] });  // favoriteVendors

    // Act
    const res = await request(app)
      .get('/api/customer/dashboard/stats')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data).toHaveProperty('total_bookings');
  });

  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/customer/dashboard/stats');
    expect(res.statusCode).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/shops
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/shops', () => {
  test('should return list of approved shops', async () => {
    // Arrange — controller: countQuery first, then shops list
    //   Response shape: { data: { shops: [...], pagination: {...} } }
    const token = makeCustomerToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [mockShop, { ...mockShop, shop_id: 2, shop_name: 'Barber Pro' }] });

    // Act
    const res = await request(app)
      .get('/api/customer/shops')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('shops');
    expect(Array.isArray(res.body.data.shops)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  test('should support city filter query param', async () => {
    const token = makeCustomerToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [mockShop] });

    const res = await request(app)
      .get('/api/customer/shops?city=Mumbai')
      .set(authHeader(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shops.length).toBe(1);
  });

  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/customer/shops');
    expect(res.statusCode).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/shops/:shopId
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/shops/:shopId', () => {
  test('should return shop details for a valid shopId', async () => {
    // Arrange — controller makes 4 db.query calls:
    //   1. shop details (JOIN users + vendor_shop_details + vendor_metrics + user_profiles)
    //   2. shop images  (vendor_documents)
    //   3. shop services (vendor_services JOIN services_master)
    //   4. recent reviews
    const token = makeCustomerToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockShop] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1, service_name: 'Haircut', price: 250 }] })
      .mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .get('/api/customer/shops/1')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('shop_id');
    expect(res.body.data).toHaveProperty('services');
  });

  test('should return 404 for a non-existent shop', async () => {
    const token = makeCustomerToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/customer/shops/9999')
      .set(authHeader(token));

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/shops/:shopId/available-slots
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/shops/:shopId/available-slots', () => {
  test('should return available time slots for a shop on a date', async () => {
    // Arrange — slotService makes 4 db.query calls:
    //   1. shop meta (vendor_shop_details)
    //   2. full-day holidays (vendor_holidays)
    //   3. partial-day closures (vendor_early_closures)
    //   4. existing bookings
    //
    // IMPORTANT: weekly_holiday must be null (not []) — slotService calls
    //            weekly_holiday.toLowerCase() which throws on an array.
    const token = makeCustomerToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ ...mockShop, user_id: 5, vendor_id: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .get('/api/customer/shops/1/available-slots?date=2026-12-25')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('available_slots');
  });

  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/customer/shops/1/available-slots?date=2026-12-25');
    expect(res.statusCode).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/customer/bookings
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/customer/bookings', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = db.__mockClient;
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should create a booking successfully', async () => {
    // Arrange
    // createBooking uses client.query for the transaction (9 calls) then
    // db.query for the final bookingData fetch (1 call).
    //
    // client.query sequence:
    //   BEGIN → vendorCheck → shopDetails → serviceRow(x1) →
    //   existingBookings → shopHours → INSERT booking →
    //   INSERT booking_services(x1) → COMMIT
    //
    // booking_date must be FUTURE (controller rejects past dates).
    const token = makeCustomerToken(10);
    const bDate = futureDate();
    dc();

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                                // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 5 }] })                                 // vendorCheck
      .mockResolvedValueOnce({ rows: [{ no_of_seats: 2, shop_id: 1 }] })                 // shopDetails
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1, service_id: 1, price: 250, service_name: 'Haircut', default_duration_minutes: 30 }] }) // serviceRow
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })                                 // existingBookings count
      .mockResolvedValueOnce({ rows: [{ close_time: '21:00:00' }] })                     // shopHours
      .mockResolvedValueOnce({ rows: [{ booking_id: 100 }] })                            // INSERT booking
      .mockResolvedValueOnce({ rows: [] })                                                // INSERT booking_services
      .mockResolvedValueOnce({ rows: [] });                                               // COMMIT

    // After COMMIT — db.query (not client.query) fetches full booking for response
    db.query.mockResolvedValueOnce({ rows: [{
      booking_id:   100,
      customer_id:  10,
      vendor_id:    5,
      shop_id:      1,
      booking_date: bDate,
      time_slot:    '10:00:00',
      status:       'pending',
      total_price:  250,
      shop_name:    'Test Salon',
    }] });

    // Act
    const res = await request(app)
      .post('/api/customer/bookings')
      .set(authHeader(token))
      .send({
        vendor_id:    5,
        booking_date: bDate,
        booking_time: '10:00',
        services:     [{ service_id: 1 }],
        notes:        'Please be on time',
      });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('booking_id');
  });

  test('should return 400 when vendor_id is missing', async () => {
    const token = makeCustomerToken();
    dc();

    const res = await request(app)
      .post('/api/customer/bookings')
      .set(authHeader(token))
      .send({ booking_date: futureDate(), booking_time: '10:00', services: [1] });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('should return 401 without token', async () => {
    const res = await request(app)
      .post('/api/customer/bookings')
      .send({ vendor_id: 5 });

    expect(res.statusCode).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/bookings
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/bookings', () => {
  test('should return all bookings for the authenticated customer', async () => {
    // Arrange — controller: countQuery first, then paginated list
    //   Response shape: { data: { bookings: [...], pagination: {...} } }
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })  // count query
      .mockResolvedValueOnce({ rows: [mockBooking] });     // list query

    // Act
    const res = await request(app)
      .get('/api/customer/bookings')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('bookings');
    expect(Array.isArray(res.body.data.bookings)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  test('should support status filter', async () => {
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [mockBooking] });

    const res = await request(app)
      .get('/api/customer/bookings?status=confirmed')
      .set(authHeader(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('bookings');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/bookings/:bookingId
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/bookings/:bookingId', () => {
  test('should return booking details for valid bookingId', async () => {
    // Arrange
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })
      .mockResolvedValueOnce({ rows: mockBooking.services });

    // Act
    const res = await request(app)
      .get('/api/customer/bookings/100')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('booking_id');
  });

  test('should return 404 for non-existent booking', async () => {
    const token = makeCustomerToken(10);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/customer/bookings/9999')
      .set(authHeader(token));

    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/customer/bookings/:bookingId/cancel
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/customer/bookings/:bookingId/cancel', () => {
  test('should cancel a confirmed booking successfully', async () => {
    // Arrange — cancelBooking uses db.query (NO pool.connect transaction).
    //   Sequence (4 db.query calls after device check):
    //   1. SELECT booking (ownership + status check)
    //   2. UPDATE booking_status = 'cancelled'
    //   3. UPDATE vendor_metrics (cancelled_bookings++)
    //   4. SELECT vendor FCM token (inside notification try/catch — still consumes slot)
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ booking_id: 100, vendor_id: 5, booking_status: 'confirmed', booking_date: '2026-12-25' }] })
      .mockResolvedValueOnce({ rows: [] })   // UPDATE booking
      .mockResolvedValueOnce({ rows: [] })   // UPDATE vendor_metrics
      .mockResolvedValueOnce({ rows: [] });  // SELECT vendor FCM (empty → skip firebase)

    // Act
    const res = await request(app)
      .put('/api/customer/bookings/100/cancel')
      .set(authHeader(token))
      .send({ cancellation_reason: 'Change of plans' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/cancel/i);
  });

  test('should return 400 when cancellation_reason is missing', async () => {
    const token = makeCustomerToken(10);
    dc();

    const res = await request(app)
      .put('/api/customer/bookings/100/cancel')
      .set(authHeader(token))
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/customer/reviews
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/customer/reviews', () => {
  test('should add a review for a completed booking', async () => {
    // Arrange — addReview uses db.query (NO pool.connect transaction).
    //   Sequence (5 db.query calls after device check):
    //   1. SELECT booking (existence + booking_status = 'completed')
    //   2. SELECT existing review (duplicate guard)
    //   3. INSERT review RETURNING review_id
    //   4. SELECT vendor_metrics (current average_rating & total_reviews)
    //   5. UPDATE vendor_metrics (new computed average)
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ vendor_id: 5, booking_status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ review_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ average_rating: '4.5', total_reviews: '10' }] })
      .mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .post('/api/customer/reviews')
      .set(authHeader(token))
      .send({ booking_id: 100, rating: 5, review_text: 'Excellent service!' });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('review_id');
  });

  test('should return 400 when booking_id or rating is missing', async () => {
    const token = makeCustomerToken(10);
    dc();

    const res = await request(app)
      .post('/api/customer/reviews')
      .set(authHeader(token))
      .send({ rating: 5 }); // missing booking_id

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/categories
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/categories', () => {
  test('should return all active service categories', async () => {
    // Arrange
    const token = makeCustomerToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [
        { category_id: 1, category_name: 'Hair', icon: 'hair.png' },
        { category_id: 2, category_name: 'Beard', icon: 'beard.png' },
      ],
    });

    // Act
    const res = await request(app)
      .get('/api/customer/categories')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/categories/:category/services
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/categories/:category/services', () => {
  test('should return services under a category', async () => {
    // Arrange
    const token = makeCustomerToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [{ service_id: 1, service_name: 'Haircut', category: 'Hair', base_price: 250 }],
    });

    // Act
    const res = await request(app)
      .get('/api/customer/categories/Hair/services')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/notifications
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/customer/notifications', () => {
  test('should return notifications for the customer', async () => {
    // Arrange — controller makes 3 db.query calls:
    //   1. SELECT notifications (paginated list)
    //   2. SELECT COUNT(*) total
    //   3. SELECT COUNT(*) unread (is_read = false)
    //   Response shape: { data: { notifications: [...], unread_count: N, pagination: {...} } }
    const token = makeCustomerToken(10);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ notification_id: 1, title: 'Booking Confirmed', body: 'Your booking is confirmed', is_read: false }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    // Act
    const res = await request(app)
      .get('/api/customer/notifications')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('notifications');
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
    expect(res.body.data).toHaveProperty('unread_count');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/customer/notifications/:notificationId/read
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/customer/notifications/:notificationId/read', () => {
  test('should mark a notification as read', async () => {
    // Arrange
    const token = makeCustomerToken(10);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .put('/api/customer/notifications/1/read')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/customer/notifications/read-all
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/customer/notifications/read-all', () => {
  test('should mark all notifications as read', async () => {
    // Arrange
    const token = makeCustomerToken(10);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .put('/api/customer/notifications/read-all')
      .set(authHeader(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/customer/fcm-token
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/customer/fcm-token', () => {
  test('should update FCM token successfully', async () => {
    // Arrange
    const token = makeCustomerToken(10);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .put('/api/customer/fcm-token')
      .set(authHeader(token))
      .send({ fcm_token: 'new-fcm-token-abc123' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 when fcm_token is missing', async () => {
    const token = makeCustomerToken(10);
    dc();

    const res = await request(app)
      .put('/api/customer/fcm-token')
      .set(authHeader(token))
      .send({});

    expect(res.statusCode).toBe(400);
  });
});
