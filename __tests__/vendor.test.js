/**
 * Vendor API Tests
 * All routes under /api/vendor — require verifyToken + isVendor
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../server');
const db      = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-unit-tests';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeVendorToken = (userId = 20) =>
  jwt.sign({ userId, userType: 'VENDOR', deviceId: 'dev-v' }, JWT_SECRET, { expiresIn: '1d' });

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Pre-fill the single device_id check done by verifyToken middleware */
const dc = () => db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-v' }] });

/** A date that is always "today + 2 days" (within the allowed 0-7 day window for block-time) */
const futureDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockShop = {
  shop_id: 1, user_id: 20, shop_name: 'Style Studio',
  shop_address: '5 Park Ave', city: 'Mumbai', state: 'MH',
  open_time: '09:00:00', close_time: '21:00:00', no_of_seats: 3,
  verification_status: 'approved',
};

const mockService = {
  vendor_service_id: 1, vendor_id: 20, service_id: 1,
  service_name: 'Haircut', price: 300, is_available: true,
};

/** booking_status (not status) is the field the controller reads for state checks */
const mockBooking = {
  booking_id: 200, vendor_id: 20, user_id: 10,
  booking_date: '2024-12-25', booking_time: '10:00',
  booking_status: 'confirmed',   // ← controller checks booking_status
  status: 'active',
  total_amount: 300,
};

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/profile
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/profile', () => {
  test('should return vendor profile with shop details', async () => {
    // Arrange
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ user_id: 20, shop_name: 'Style Studio', verification_status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [] }); // images

    // Act
    const res = await request(app).get('/api/vendor/profile').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('user_id');
  });

  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/vendor/profile');
    expect(res.statusCode).toBe(401);
  });

  test('should return 403 for non-vendor (customer) token', async () => {
    const customerToken = jwt.sign({ userId: 1, userType: 'CUSTOMER', deviceId: 'dev-v' }, JWT_SECRET, { expiresIn: '1d' });
    dc();
    const res = await request(app).get('/api/vendor/profile').set(auth(customerToken));
    expect(res.statusCode).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/profile
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/profile', () => {
  let mockClient;
  beforeEach(() => {
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should update vendor profile successfully', async () => {
    // Arrange
    const token = makeVendorToken();
    dc();
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rows: [] })  // email uniqueness check
      .mockResolvedValueOnce({ rows: [] })  // UPDATE users.email
      .mockResolvedValueOnce({ rows: [] })  // UPDATE user_profiles is_current=false
      .mockResolvedValueOnce({ rows: [] })  // INSERT new profile row
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    // Act
    const res = await request(app)
      .put('/api/vendor/profile')
      .set(auth(token))
      .send({ name: 'Updated Vendor', city: 'Delhi', email: 'updated@vendor.com' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/updated/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/shop
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/shop', () => {
  test('should return vendor shop details', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockShop] })  // shop
      .mockResolvedValueOnce({ rows: [] });          // documents

    const res = await request(app).get('/api/vendor/shop').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('shop_id');
  });

  test('should return 404 when shop not yet created', async () => {
    const token = makeVendorToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/vendor/shop').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/vendor/shop  — creates shop when none exists → 201
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/vendor/shop', () => {
  test('should create a new shop and return 201', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [] })            // existing shop check → none
      .mockResolvedValueOnce({ rows: [mockShop] });   // INSERT RETURNING

    const res = await request(app)
      .post('/api/vendor/shop')
      .set(auth(token))
      .send({
        shop_name: 'Style Studio', shop_address: '5 Park Ave',
        city: 'Mumbai', state: 'MH', open_time: '09:00', close_time: '21:00',
      });

    // Controller returns 201 for new shop, 200 for update
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 when required fields are missing', async () => {
    const token = makeVendorToken();
    dc();

    const res = await request(app)
      .post('/api/vendor/shop')
      .set(auth(token))
      .send({ shop_name: 'Incomplete' }); // city, state, open_time, close_time missing

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/shop/operating-hours
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/shop/operating-hours', () => {
  test('should update operating hours successfully', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ shop_id: 1 }] })  // shop exists check
      .mockResolvedValueOnce({ rows: [mockShop] });         // UPDATE RETURNING

    const res = await request(app)
      .put('/api/vendor/shop/operating-hours')
      .set(auth(token))
      .send({ open_time: '08:00', close_time: '22:00', weekly_holiday: ['Sunday'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/shop/capacity
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/shop/capacity', () => {
  test('should update shop capacity successfully', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ shop_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ ...mockShop, no_of_seats: 5 }] });

    const res = await request(app)
      .put('/api/vendor/shop/capacity')
      .set(auth(token))
      .send({ no_of_seats: 5, no_of_workers: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/vendor/block-time
// The controller validates: date must be within today → today+7 days
// block_full_day=true blocks the full day; otherwise start_time+end_time required
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/vendor/block-time', () => {
  let mockClient;
  beforeEach(() => {
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should block a full day successfully', async () => {
    // Arrange — date must be within next 7 days
    const token = makeVendorToken();
    dc();
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                   // BEGIN
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })                       // conflict check
      .mockResolvedValueOnce({ rows: [{ holiday_id: 10, holiday_date: futureDate() }] }) // INSERT holiday
      .mockResolvedValueOnce({ rows: [] });                                   // COMMIT

    // Act
    const res = await request(app)
      .post('/api/vendor/block-time')
      .set(auth(token))
      .send({ date: futureDate(), block_full_day: true });

    // Assert — controller returns 201 when creating a new holiday block
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 when date is missing', async () => {
    const token = makeVendorToken();
    dc();

    const res = await request(app)
      .post('/api/vendor/block-time')
      .set(auth(token))
      .send({ block_full_day: true }); // no date

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('should return 400 for date outside 7-day window', async () => {
    const token = makeVendorToken();
    dc();
    // 30 days in future — outside the allowed 7-day window
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);

    const res = await request(app)
      .post('/api/vendor/block-time')
      .set(auth(token))
      .send({ date: farFuture.toISOString().split('T')[0], block_full_day: true });

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/block-time
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/block-time', () => {
  test('should return combined list of blocked times', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [] })   // closures (partial-day blocks)
      .mockResolvedValueOnce({ rows: [] });  // holidays (full-day blocks)

    const res = await request(app).get('/api/vendor/block-time').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/vendor/block-time/:blockId?type=holiday|closure
// rowCount must be ≥ 1 — controller returns 404 when rowCount is falsy
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/vendor/block-time/:blockId', () => {
  test('should delete a holiday block', async () => {
    const token = makeVendorToken();
    dc();
    // rowCount signals how many rows were updated
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .delete('/api/vendor/block-time/10?type=holiday')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should delete a closure block', async () => {
    const token = makeVendorToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .delete('/api/vendor/block-time/5?type=closure')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 for invalid type param', async () => {
    const token = makeVendorToken();
    dc();

    const res = await request(app)
      .delete('/api/vendor/block-time/5?type=invalid')
      .set(auth(token));

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/shop/images
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/shop/images', () => {
  test('should return shop images', async () => {
    const token = makeVendorToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [{ document_id: 1, document_url: '/uploads/img.jpg', document_type: 'shop_gallery_image', is_primary: true }],
    });

    const res = await request(app).get('/api/vendor/shop/images').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/vendor/shop/images/:document_id
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/vendor/shop/images/:document_id', () => {
  test('should delete a shop image', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ document_id: 1, document_url: '/uploads/old.jpg', vendor_id: 20 }] })
      .mockResolvedValueOnce({ rows: [] }); // soft-delete

    const res = await request(app)
      .delete('/api/vendor/shop/images/1')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/shop/images/:document_id/primary
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/shop/images/:document_id/primary', () => {
  test('should set image as primary', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ document_id: 1, vendor_id: 20 }] })
      .mockResolvedValueOnce({ rows: [] })  // clear existing primary
      .mockResolvedValueOnce({ rows: [] }); // set new primary

    const res = await request(app)
      .put('/api/vendor/shop/images/1/primary')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/documents
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/documents', () => {
  test('should return vendor documents', async () => {
    const token = makeVendorToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [{ document_id: 1, document_url: '/uploads/license.pdf', document_type: 'license', verification_status: 'pending' }],
    });

    const res = await request(app).get('/api/vendor/documents').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/dashboard/stats
// Controller makes 5 sequential db.query calls:
//   1. stats aggregate (total_bookings, revenue, rating…)
//   2. todayBookings
//   3. pendingCount
//   4. monthlyRevenue
//   5. servicesCount
//   6. upcomingBookings
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/dashboard/stats', () => {
  test('should return vendor dashboard statistics', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ total_bookings: '30', completed_bookings: '25', cancelled_bookings: '2', total_revenue: '15000', average_rating: '4.5', total_reviews: '12' }] }) // 1. stats aggregate
      .mockResolvedValueOnce({ rows: [] })                                   // 2. vendor_metrics INSERT sync (fire-and-forget — still consumes a mock slot)
      .mockResolvedValueOnce({ rows: [] })                                   // 3. todayBookings
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })                    // 4. pendingCount
      .mockResolvedValueOnce({ rows: [{ revenue: '5000' }] })               // 5. monthlyRevenue
      .mockResolvedValueOnce({ rows: [{ count: '8' }] })                    // 6. servicesCount
      .mockResolvedValueOnce({ rows: [] });                                   // 7. upcomingBookings

    const res = await request(app).get('/api/vendor/dashboard/stats').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/services/master
// Response: { success, data: { services: [...], total: N } }
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/services/master', () => {
  test('should return master services list', async () => {
    const token = makeVendorToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [
        { service_id: 1, service_name: 'Haircut', service_type: 'standard' },
        { service_id: 2, service_name: 'Shaving', service_type: 'standard' },
      ],
    });

    const res = await request(app).get('/api/vendor/services/master').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Controller wraps result: data.services is the array
    expect(Array.isArray(res.body.data.services)).toBe(true);
    expect(res.body.data.total).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/services
// Response: { success, data: { services: [...], total: N } }
// ──────────────────────────────────────────────────────────────────────────────

describe("GET /api/vendor/services", () => {
  test("should return vendor's own services", async () => {
    const token = makeVendorToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [mockService] });

    const res = await request(app).get('/api/vendor/services').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.services)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/vendor/services
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/vendor/services', () => {
  test('should add a service to vendor portfolio (201)', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ service_id: 1, name: 'Haircut' }] })  // master check
      .mockResolvedValueOnce({ rows: [] })                                      // duplicate check
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 99 }] });            // INSERT

    const res = await request(app)
      .post('/api/vendor/services')
      .set(auth(token))
      .send({ service_id: 1, price: 300 });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 when service_id or price is missing', async () => {
    const token = makeVendorToken();
    dc();

    const res = await request(app)
      .post('/api/vendor/services')
      .set(auth(token))
      .send({ price: 300 }); // service_id missing

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/vendor/custom-service
// Controller fields: service_name (NOT name), price, description, is_available
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/vendor/custom-service', () => {
  test('should add a custom service successfully (201)', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ service_id: 99 }] })  // INSERT/upsert services_master
      .mockResolvedValueOnce({ rows: [] })                      // existing vendor link check
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 50 }] }); // INSERT vendor_services

    const res = await request(app)
      .post('/api/vendor/custom-service')
      .set(auth(token))
      .send({ service_name: 'Threading', price: 50, description: 'Eyebrow threading' });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('service_name', 'Threading');
  });

  test('should return 400 when service_name is missing', async () => {
    const token = makeVendorToken();
    dc();

    const res = await request(app)
      .post('/api/vendor/custom-service')
      .set(auth(token))
      .send({ price: 50 }); // service_name missing

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/vendor/services/bulk
// Uses db.pool.connect() transaction; returns 200 (not 201)
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/vendor/services/bulk', () => {
  let mockClient;
  beforeEach(() => {
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should add multiple services in a transaction (200)', async () => {
    const token = makeVendorToken();
    dc();
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                               // BEGIN
      .mockResolvedValueOnce({ rows: [] })                               // duplicate check svc 1
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 10 }] })     // INSERT svc 1
      .mockResolvedValueOnce({ rows: [] })                               // duplicate check svc 2
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 11 }] })     // INSERT svc 2
      .mockResolvedValueOnce({ rows: [] });                              // COMMIT

    const res = await request(app)
      .post('/api/vendor/services/bulk')
      .set(auth(token))
      .send({ services: [{ service_id: 1, price: 300 }, { service_id: 2, price: 150 }] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.added).toHaveLength(2);
  });

  test('should return 400 when services array is missing', async () => {
    const token = makeVendorToken();
    dc();

    const res = await request(app)
      .post('/api/vendor/services/bulk')
      .set(auth(token))
      .send({});

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/services/:service_id
// Controller parameter is vendor_service_id; field names: price, is_available
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/services/:service_id', () => {
  test('should update a vendor service', async () => {
    const token = makeVendorToken();
    dc();
    // Controller: 1) ownership check  2) UPDATE (returns vendor_service_id only)
    //             3) fullService JOIN SELECT (returns full row for Flutter)
    db.query
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1, vendor_id: 20 }] })          // 1. ownership check
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1 }] })                         // 2. UPDATE RETURNING vendor_service_id
      .mockResolvedValueOnce({ rows: [{ ...mockService, price: 400, category: 'Hair' }] }); // 3. fullService JOIN SELECT

    const res = await request(app)
      .put('/api/vendor/services/1')
      .set(auth(token))
      .send({ price: 400 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/vendor/services/:service_id/availability
// ──────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/vendor/services/:service_id/availability', () => {
  test('should toggle service availability', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockService] })
      .mockResolvedValueOnce({ rows: [{ ...mockService, is_available: false }] });

    const res = await request(app)
      .patch('/api/vendor/services/1/availability')
      .set(auth(token))
      .send({ is_available: false });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/vendor/services/:service_id
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/vendor/services/:service_id', () => {
  test('should soft-delete a vendor service', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1, vendor_id: 20 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete('/api/vendor/services/1')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/bookings
// Response: { data: { bookings: [...], pagination: {...} } }
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/bookings', () => {
  test('should return paginated vendor bookings', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })               // COUNT query
      .mockResolvedValueOnce({ rows: [mockBooking, { ...mockBooking, booking_id: 201 }] }); // bookings

    const res = await request(app).get('/api/vendor/bookings').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.bookings)).toBe(true);
    expect(res.body.data.pagination).toHaveProperty('total', 2);
  });

  test('should support status filter', async () => {
    const token = makeVendorToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [mockBooking] });

    const res = await request(app)
      .get('/api/vendor/bookings?status=confirmed')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/vendor/bookings/offline
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/vendor/bookings/offline', () => {
  let mockClient;
  beforeEach(() => {
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should create a walk-in offline booking (201)', async () => {
    const token = makeVendorToken(20);
    dc();
    // Offline booking uses client.query exclusively.
    // Required fields: customer_name, customer_phone, booking_date, booking_time, services
    // Sequence: BEGIN → serviceCheck (per service) → INSERT booking → serviceData (per service) → INSERT booking_services → COMMIT
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                                     // BEGIN
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1, price: 300, default_duration_minutes: 30 }] }) // serviceCheck svc 1
      .mockResolvedValueOnce({ rows: [{ booking_id: 300 }] })                                 // INSERT booking
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 1, service_name: 'Haircut', price: 300, default_duration_minutes: 30 }] }) // serviceData svc 1
      .mockResolvedValueOnce({ rows: [] })                                                     // INSERT booking_services svc 1
      .mockResolvedValueOnce({ rows: [] });                                                    // COMMIT

    const res = await request(app)
      .post('/api/vendor/bookings/offline')
      .set(auth(token))
      .send({
        customer_name:  'Walk-in Customer',
        customer_phone: '+919000000099',    // ← required field
        booking_date:   '2025-01-10',
        booking_time:   '11:00',
        services:       [{ service_id: 1, service_name: 'Haircut', price: 300 }],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/bookings/:bookingId
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/bookings/:bookingId', () => {
  test('should return booking details', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })
      .mockResolvedValueOnce({ rows: [] });  // booking services

    const res = await request(app)
      .get('/api/vendor/bookings/200')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('booking_id', 200);
  });

  test('should return 404 for non-existent booking', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/vendor/bookings/9999').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/bookings/:bookingId/accept
// booking_status must be 'pending' or 'confirmed' — fixture uses 'confirmed'
// Also queries shop_name after update
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/bookings/:bookingId/accept', () => {
  test('should accept a confirmed booking', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })                           // SELECT booking
      .mockResolvedValueOnce({ rows: [{ ...mockBooking, booking_status: 'confirmed' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ shop_name: 'Style Studio' }] });         // shop name for notification

    const res = await request(app)
      .put('/api/vendor/bookings/200/accept')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/bookings/:bookingId/reject
// Requires rejection_reason (NOT reason) in request body
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/bookings/:bookingId/reject', () => {
  test('should reject a booking with rejection_reason', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })
      .mockResolvedValueOnce({ rows: [{ ...mockBooking, booking_status: 'cancelled' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] })                                                  // UPDATE vendor_metrics
      .mockResolvedValueOnce({ rows: [{ shop_name: 'Style Studio' }] });                   // shop name

    const res = await request(app)
      .put('/api/vendor/bookings/200/reject')
      .set(auth(token))
      .send({ rejection_reason: 'Fully booked' }); // ← correct field name

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 when rejection_reason is missing', async () => {
    const token = makeVendorToken(20);
    dc();

    const res = await request(app)
      .put('/api/vendor/bookings/200/reject')
      .set(auth(token))
      .send({}); // no rejection_reason

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/bookings/:bookingId/complete
// booking_status must be 'confirmed'; also queries shop_name
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/bookings/:bookingId/complete', () => {
  test('should mark a confirmed booking as completed', async () => {
    const token = makeVendorToken(20);
    dc();
    // completeBooking sequence:
    //   1. SELECT booking  2. UPDATE booking  3. UPDATE vendor_metrics
    //   4. INSERT notification (fire-and-forget .catch — still consumes mock slot)
    //   5. SELECT shop_name (for FCM notification via _notifyCustomerBookingUpdate)
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })                                        // 1. SELECT booking
      .mockResolvedValueOnce({ rows: [{ ...mockBooking, booking_status: 'completed' }] })   // 2. UPDATE booking
      .mockResolvedValueOnce({ rows: [] })                                                    // 3. UPDATE vendor_metrics
      .mockResolvedValueOnce({ rows: [] })                                                    // 4. INSERT notification (non-awaited)
      .mockResolvedValueOnce({ rows: [{ shop_name: 'Style Studio' }] });                    // 5. SELECT shop_name

    const res = await request(app)
      .put('/api/vendor/bookings/200/complete')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/bookings/:bookingId/no-show
// booking_status must be 'confirmed'
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/bookings/:bookingId/no-show', () => {
  test('should mark a booking as no-show', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })                              // SELECT booking
      .mockResolvedValueOnce({ rows: [{ ...mockBooking, booking_status: 'no_show' }] }); // UPDATE

    const res = await request(app)
      .put('/api/vendor/bookings/200/no-show')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/reviews
// Response: { data: { reviews: [...], pagination: {...} } }
// Controller makes 2 queries: reviews list + COUNT
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/reviews', () => {
  test('should return paginated vendor reviews', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ review_id: 1, rating: 5, review_text: 'Great!', customer_name: 'John' }] }) // reviews list
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }); // COUNT

    const res = await request(app).get('/api/vendor/reviews').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.reviews)).toBe(true);
    expect(res.body.data.pagination).toHaveProperty('total', 1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/vendor/notifications
// Controller makes 3 queries: list + COUNT total + COUNT unread
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/vendor/notifications', () => {
  test('should return vendor notifications with unread count', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ notification_id: 1, title: 'New Booking', is_read: false }] }) // notifications list
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })   // COUNT total
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });  // COUNT unread

    const res = await request(app).get('/api/vendor/notifications').set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.notifications)).toBe(true);
    expect(res.body.data).toHaveProperty('unread_count', 1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/notifications/:notificationId/read
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/notifications/:notificationId/read', () => {
  test('should mark a notification as read', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query.mockResolvedValueOnce({ rows: [{ notification_id: 1, is_read: true }] });

    const res = await request(app)
      .put('/api/vendor/notifications/1/read')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/notifications/read-all
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/notifications/read-all', () => {
  test('should mark all notifications as read', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/vendor/notifications/read-all')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/vendor/fcm-token
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/vendor/fcm-token', () => {
  test('should update vendor FCM token', async () => {
    const token = makeVendorToken(20);
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/vendor/fcm-token')
      .set(auth(token))
      .send({ fcm_token: 'vendor-new-fcm-token-xyz' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 when fcm_token is missing', async () => {
    const token = makeVendorToken(20);
    dc();

    const res = await request(app)
      .put('/api/vendor/fcm-token')
      .set(auth(token))
      .send({});

    expect(res.statusCode).toBe(400);
  });
});
