const db = require('../config/database');
const admin = require('../config/firebase');
function normalizeTime(t) {
  if (!t) return t;
  const parts = t.split(':');
  if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
  return t;
}
function getOccupiedSlots(startTime, durationMinutes, intervalMinutes = 30) {
  const slots = [];
  const parts = startTime.split(':').map(Number);
  let totalMins = parts[0] * 60 + parts[1]; // ignore seconds
  const endMins = totalMins + Math.max(durationMinutes, intervalMinutes);
  while (totalMins < endMins) {
    const h = Math.floor(totalMins / 60).toString().padStart(2, '0');
    const m = (totalMins % 60).toString().padStart(2, '0');
    slots.push(`${h}:${m}`);
    totalMins += intervalMinutes;
  }
  return slots;
}
// ============================================
// CUSTOMER DASHBOARD
// ============================================

const getDashboardStats = async (req, res) => {
  try {
    const customerId = req.user.userId;

    // Get total bookings
    const bookingsStats = await db.query(
        `SELECT 
        COUNT(*) as total_bookings,
        SUM(CASE WHEN booking_status = 'completed' THEN 1 ELSE 0 END) as completed_bookings,
        SUM(CASE WHEN booking_status = 'confirmed' THEN 1 ELSE 0 END) as upcoming_bookings,
        SUM(CASE WHEN booking_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bookings
      FROM bookings
      WHERE user_id = $1 AND status = 'active'`,
        [customerId]
    );

    // Get upcoming bookings
    const upcomingBookings = await db.query(
        `SELECT 
        b.booking_id,
        b.booking_date,
        b.booking_time,
        b.total_amount,
        b.booking_status,
        vsd.shop_name,
        vsd.shop_address,
        vsd.city,
        up.name as vendor_name,
        u.phone_number as vendor_phone
      FROM bookings b
      INNER JOIN vendor_shop_details vsd ON b.vendor_id = vsd.user_id
      LEFT JOIN users u ON b.vendor_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE b.user_id = $1 
        AND b.booking_status = 'confirmed'
        AND b.booking_date >= CURRENT_DATE
        AND b.status = 'active'
      ORDER BY b.booking_date ASC
      LIMIT 5`,
        [customerId]
    );

    // Get favorite vendors (most booked)
    const favoriteVendors = await db.query(
        `SELECT 
        b.vendor_id,
        vsd.shop_name,
        vsd.city,
        vm.average_rating,
        vm.total_reviews,
        COUNT(b.booking_id) as booking_count
      FROM bookings b
      INNER JOIN vendor_shop_details vsd ON b.vendor_id = vsd.user_id
      LEFT JOIN vendor_metrics vm ON b.vendor_id = vm.vendor_id
      WHERE b.user_id = $1 AND b.status = 'active'
      GROUP BY b.vendor_id, vsd.shop_name, vsd.city, vm.average_rating, vm.total_reviews
      ORDER BY booking_count DESC
      LIMIT 5`,
        [customerId]
    );

    const stats = bookingsStats.rows[0];

    res.json({
      success: true,
      message: "Loaded",
      data: {
        total_bookings: parseInt(stats.total_bookings) || 0,
        completed_bookings: parseInt(stats.completed_bookings) || 0,
        upcoming_bookings: parseInt(stats.upcoming_bookings) || 0,
        cancelled_bookings: parseInt(stats.cancelled_bookings) || 0,
        upcoming_appointments: upcomingBookings.rows,
        favorite_vendors: favoriteVendors.rows
      }
    });

  } catch (error) {
    console.error('Get customer dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics.',
      error: error.message
    });
  }
};

// ============================================
// SHOP DISCOVERY
// ============================================

// Get all shops with filters and search
const getAllShops = async (req, res) => {
  try {
    const {
      city, search, category, sort_by = 'rating',
      page = 1, limit = 10,
      latitude, longitude   // ✅ accept from query params
    } = req.query;

    const offset = (page - 1) * limit;
    const hasLocation = latitude && longitude &&
        !isNaN(parseFloat(latitude)) &&
        !isNaN(parseFloat(longitude));

    // ✅ Distance formula included only when coords are available
    const distanceExpr = hasLocation
        ? `ROUND(
          6371000 * acos(
            cos(radians(${ /* will be parameterized below */ 'LAT_PARAM'})) *
            cos(radians(vsd.latitude::float)) *
            cos(radians(vsd.longitude::float) - radians(${'LNG_PARAM'})) +
            sin(radians(${'LAT_PARAM'})) *
            sin(radians(vsd.latitude::float))
          )
        )::float`
        : 'NULL';

    let query = `
      SELECT 
        u.user_id as vendor_id,
        vsd.shop_id,
        vsd.shop_name,
        vsd.shop_address,
        vsd.city,
        vsd.state,
        vsd.latitude,
        vsd.longitude,
        vsd.open_time,
        vsd.close_time,
        vm.average_rating,
        vm.total_reviews,
        vm.total_bookings,
        (SELECT document_url FROM vendor_documents 
         WHERE vendor_id = u.user_id 
           AND document_type IN ('shop_profile_image', 'shop_gallery_image')
           AND status = 'active' 
         ORDER BY is_primary DESC, created_at DESC
         LIMIT 1) as profile_image,
        (SELECT COUNT(*) FROM vendor_services vs 
         WHERE vs.vendor_id = u.user_id 
           AND vs.status = 'active' 
           AND vs.is_available = true) as services_count
      FROM users u
      INNER JOIN vendor_shop_details vsd ON u.user_id = vsd.user_id
      LEFT JOIN vendor_metrics vm ON u.user_id = vm.vendor_id
      WHERE u.user_type = 'VENDOR' 
        AND u.status = 'active' 
        AND vsd.status = 'active'
        AND vsd.verification_status = 'approved'
    `;

    const params = [];
    let paramCount = 1;

    // ✅ Inject lat/lng as first params if available
    if (hasLocation) {
      params.push(parseFloat(latitude));  // $1 = lat
      params.push(parseFloat(longitude)); // $2 = lng
      paramCount = 3;

      // Replace placeholders with real param numbers
      query = query.replace('LAT_PARAM', '1').replace('LNG_PARAM', '2')
          .replace('LAT_PARAM', '1'); // second occurrence

      // Re-inject distance into SELECT
      query = query.replace(
          'vm.total_bookings,',
          `vm.total_bookings,
        ROUND(
          6371000 * acos(
            GREATEST(-1, LEAST(1,
              cos(radians($1)) *
              cos(radians(vsd.latitude::float)) *
              cos(radians(vsd.longitude::float) - radians($2)) +
              sin(radians($1)) *
              sin(radians(vsd.latitude::float))
            ))
          )
        )::float as distance,`
      );
    } else {
      query = query.replace('vm.total_bookings,', 'vm.total_bookings, NULL as distance,');
    }

    if (city) {
      query += ` AND vsd.city ILIKE $${paramCount}`;
      params.push(`%${city}%`);
      paramCount++;
    }

    if (search) {
      query += ` AND (vsd.shop_name ILIKE $${paramCount} OR vsd.shop_address ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (category) {
      query += ` AND EXISTS (
        SELECT 1 FROM vendor_services vs 
        INNER JOIN services_master sm ON vs.service_id = sm.service_id
        WHERE vs.vendor_id = u.user_id 
          AND sm.category = $${paramCount}
          AND vs.status = 'active'
      )`;
      params.push(category);
      paramCount++;
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${query}) as total_count`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Sorting
    switch(sort_by) {
      case 'distance':
        // Only sort by distance if coords available, else fall through to rating
        query += hasLocation
            ? ` ORDER BY distance ASC NULLS LAST`
            : ` ORDER BY vm.average_rating DESC NULLS LAST`;
        break;
      case 'reviews':
        query += ` ORDER BY vm.total_reviews DESC NULLS LAST`;
        break;
      default: // rating
        query += ` ORDER BY vm.average_rating DESC NULLS LAST`;
    }

    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      message: "Loaded",
      data: {
        shops: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get all shops error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching shops.',
      error: error.message
    });
  }
};

// Get shop details by ID
const getShopDetails = async (req, res) => {
  try {
    const { shopId } = req.params;

    // Get shop basic details
    const shopQuery = `
      SELECT 
        u.user_id as vendor_id,
        vsd.shop_id,
        vsd.shop_name,
        vsd.shop_address,
        vsd.city,
        vsd.state,
        vsd.latitude,
        vsd.longitude,
        vsd.open_time,
        vsd.close_time,
        vsd.break_start_time,
        vsd.break_end_time,
        vsd.weekly_holiday,
        vsd.no_of_seats,
        vsd.no_of_workers,
        vm.average_rating,
        vm.total_reviews,
        vm.total_bookings,
        vm.completed_bookings,
        up.name as owner_name,
        u.phone_number as contact_number
      FROM users u
      INNER JOIN vendor_shop_details vsd ON u.user_id = vsd.user_id
      LEFT JOIN vendor_metrics vm ON u.user_id = vm.vendor_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE vsd.shop_id = $1 
        AND u.status = 'active' 
        AND u.status = 'active' 
    `;

    const shop = await db.query(shopQuery, [shopId]);

    if (shop.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found or not available.'
      });
    }

    const shopData = shop.rows[0];

    // Get shop images — only approved images are visible to customers
    const images = await db.query(
        `SELECT document_id, document_url, document_type, is_primary
       FROM vendor_documents
       WHERE vendor_id = $1
         AND document_type IN ('shop_profile_image', 'shop_gallery_image')
         AND status = 'active'
         AND verification_status = 'approved'
       ORDER BY is_primary DESC, created_at DESC`,
        [shopData.vendor_id]
    );

    // Get shop services
    const services = await db.query(
        `SELECT 
        vs.vendor_service_id,
        sm.service_id,
        sm.service_name,
        sm.service_description as description,
        sm.category,
        vs.price,
        sm.default_duration_minutes as duration_minutes,
        vs.is_available
      FROM vendor_services vs
      INNER JOIN services_master sm ON vs.service_id = sm.service_id
      WHERE vs.vendor_id = $1 
        AND vs.status = 'active'
        AND sm.status = 'active'
        AND vs.is_available = true
      ORDER BY sm.category, sm.service_name`,
        [shopData.vendor_id]
    );

    // Get recent reviews
    const reviews = await db.query(
        `SELECT 
        r.review_id,
        r.rating,
        r.review_text,
        r.created_at,
        up.name as customer_name,
        (SELECT profile_picture FROM user_profiles 
         WHERE user_id = r.user_id AND is_current = true) as customer_photo
      FROM reviews r
      LEFT JOIN user_profiles up ON r.user_id = up.user_id AND up.is_current = true
      WHERE r.vendor_id = $1 AND r.status = 'active'
      ORDER BY r.created_at DESC
      LIMIT 10`,
        [shopData.vendor_id]
    );

    res.json({
      success: true,
      message: "Loaded",
      data: {
        ...shopData,
        images: images.rows,
        services: services.rows,
        reviews: reviews.rows
      }
    });

  } catch (error) {
    console.error('Get shop details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching shop details.',
      error: error.message
    });
  }
};

// Get available time slots for booking
const { getAvailableSlots: _getSlots } = require('../services/slotService');

const getAvailableSlots = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { date }   = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'date query param is required (YYYY-MM-DD)',
      });
    }

    const result = await _getSlots(shopId, date);
    // Get shop details
    const shop = await db.query(
      `SELECT 
        user_id,
        open_time,
        close_time,
        break_start_time,
        break_end_time,
        weekly_holiday,
        no_of_seats
      FROM vendor_shop_details
      WHERE shop_id = $1`,
        [shopId]
    );

    if (result.error) {
      return res.status(404).json({ success: false, message: result.error });
    }

    if (result.isClosed) {
      return res.json({
        success: true,
        message: 'Loaded',
        data: {
          is_closed:       true,
          date,
          open_time:       result.openTime,
          close_time:      result.closeTime,
          reason:          result.reason,
          available_slots: [],
        },
      });
    }

    return res.json({
      success: true,
      message: 'Loaded',
      data: {
        is_closed:         false,
        date,
        open_time:         result.openTime,
        close_time:        result.closeTime,
        break_start_time:  result.breakStartTime,
        break_end_time:    result.breakEndTime,
        total_seats:       result.totalSeats,
        available_slots:   result.slots,   // full grid — no filtering
      },
    });

  } catch (error) {
    console.error('getAvailableSlots error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching available slots.',
      error: error.message,
    });
  }
};
// const getAvailableSlots = async (req, res) => {
//   try {
//     const { shopId } = req.params;
//     const { date } = req.query;
//
//     if (!date) {
//       return res.status(400).json({ success: false, message: 'Date is required.' });
//     }
//
//     const shop = await db.query(
//         `SELECT user_id, open_time, close_time, break_start_time, break_end_time, weekly_holiday, no_of_seats
//        FROM vendor_shop_details WHERE shop_id = $1`,
//         [shopId]
//     );
//
//     if (shop.rows.length === 0) {
//       return res.status(404).json({ success: false, message: 'Shop not found.' });
//     }
//
//     const shopData = shop.rows[0];
//     const bookingDate = new Date(date);
//     const dayOfWeek = bookingDate.toLocaleDateString('en-US', { weekday: 'long' });
//
//     if (shopData.weekly_holiday && shopData.weekly_holiday.toLowerCase() === dayOfWeek.toLowerCase()) {
//       return res.json({
//         success: true,
//         data: { is_closed: true, message: `Shop is closed on ${dayOfWeek}`, available_slots: [] }
//       });
//     }
//
//     // ✅ ADD THESE — were missing after patch
//     const openTime = shopData.open_time;
//     const closeTime = shopData.close_time;
//     const breakStart = shopData.break_start_time;
//     const breakEnd = shopData.break_end_time;
//
//     // Fetch all active bookings with their duration
//     const existingBookings = await db.query(
//         `SELECT
//          booking_time,
//          COALESCE(
//            (SELECT SUM(bs.duration_minutes)
//             FROM booking_services bs
//             WHERE bs.booking_id = b.booking_id AND bs.status = 'active'),
//            30
//          ) AS total_duration
//        FROM bookings b
//        WHERE vendor_id = $1
//          AND booking_date = $2
//          AND booking_status IN ('confirmed', 'pending', 'completed')
//          AND status = 'active'`,
//         [shopData.user_id, date]
//     );
//
//     // Build occupied set — each booking blocks all slots it covers
//     const occupiedCounts = {};
//     for (const booking of existingBookings.rows) {
//       const bookedSlots = getOccupiedSlots(
//           booking.booking_time.substring(0, 5),
//           parseInt(booking.total_duration) || 30
//       );
//       for (const s of bookedSlots) {
//         occupiedCounts[s] = (occupiedCounts[s] || 0) + 1;
//       }
//     }
//
//     const slots = [];
//     let currentTime = new Date(`2000-01-01 ${openTime}`);
//     const endTime = new Date(`2000-01-01 ${closeTime}`);
//
//     while (currentTime < endTime) {
//       const timeString = currentTime.toTimeString().slice(0, 5);
//
//       let isDuringBreak = false;
//       if (breakStart && breakEnd) {
//         const slotTime = new Date(`2000-01-01 ${timeString}`);
//         const breakStartTime = new Date(`2000-01-01 ${breakStart}`);
//         const breakEndTime = new Date(`2000-01-01 ${breakEnd}`);
//         isDuringBreak = slotTime >= breakStartTime && slotTime < breakEndTime;
//       }
//
//       const bookedCount = occupiedCounts[timeString] || 0;
//       const availableSeats = Math.max(0, shopData.no_of_seats - bookedCount);
//
//       slots.push({
//         time: timeString,
//         available_seats: isDuringBreak ? 0 : availableSeats,
//         is_available: !isDuringBreak && availableSeats > 0,
//         is_break: isDuringBreak,
//       });
//
//       currentTime.setMinutes(currentTime.getMinutes() + 30);
//     }
//
//     res.json({
//       success: true,
//       message: "Loaded",
//       data: {
//         is_closed: false,
//         date,
//         open_time: openTime,
//         close_time: closeTime,
//         break_start_time: breakStart,
//         break_end_time: breakEnd,
//         total_seats: shopData.no_of_seats,
//         available_slots: slots
//       }
//     });
//
//   } catch (error) {
//     console.error('Get available slots error:', error);
//     res.status(500).json({ success: false, message: 'Error fetching available slots.', error: error.message });
//   }
// };



// ============================================
// BOOKING MANAGEMENT
// ============================================
// ============================================
// BOOKING MANAGEMENT
// ============================================
// ============================================
// BOOKING MANAGEMENT
// ============================================

const createBooking = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const customerId = req.user.userId;
    const {
      vendor_id,
      booking_date,
      booking_time,
      time_slot,
      services,
      service_ids,
      notes,
      payment_method,
    } = req.body;

    // ── FIX 1: Safe integer parsing for vendor_id ──────────────────────────
    // parseInt(undefined) → NaN → "invalid input syntax for type integer"
    // Use Number() with fallback so we get a clear 400 instead of a 500.
    const vendorIdInt = Number(vendor_id);
    if (!vendor_id || isNaN(vendorIdInt) || vendorIdInt <= 0) {
      return res.status(400).json({
        success: false,
        message: `vendor_id is required and must be a positive integer. Received: ${JSON.stringify(vendor_id)}`,
      });
    }

    const timeSlot = normalizeTime(time_slot || booking_time);

    // ── FIX 2: Flexible service_id extraction ─────────────────────────────
    // Flutter may send:
    //   a) services: [{vendor_service_id: "5"}]   ← normal path
    //   b) service_ids: [5, 6]                    ← alternate path
    //   c) services: ["[Instance of ...]"]        ← broken (should never reach prod)
    let serviceIdsList = [];

    if (service_ids && Array.isArray(service_ids) && service_ids.length > 0) {
      serviceIdsList = service_ids
          .map(id => Number(id))
          .filter(id => !isNaN(id) && id > 0);
    } else if (services && Array.isArray(services) && services.length > 0) {
      serviceIdsList = services
          .map(s => {
            // Extract from {vendor_service_id: "5"} or {service_id: 5} or plain number
            if (typeof s === 'object' && s !== null) {
              return Number(s.vendor_service_id ?? s.service_id ?? 0);
            }
            return Number(s);
          })
          .filter(id => !isNaN(id) && id > 0);
    }

    if (!booking_date || !timeSlot || serviceIdsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: `booking_date, booking_time, and at least one valid service are required. ` +
            `Received: date=${booking_date}, time=${timeSlot}, services=${JSON.stringify(req.body.services)}`,
      });
    }

    // ── Rest of the existing createBooking logic continues unchanged ───────
    await client.query('BEGIN');

    const vendorCheck = await client.query(
        `SELECT user_id FROM users WHERE user_id = $1 AND user_type = 'VENDOR' AND status = 'active'`,
        [vendorIdInt]
    );
    if (!vendorCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Vendor not found or not available.' });
    }

    const shopDetails = await client.query(
        `SELECT no_of_seats, shop_id FROM vendor_shop_details WHERE user_id = $1`,
        [vendorIdInt]
    );
    if (!shopDetails.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Vendor shop details not found.' });
    }

    let totalPrice = 0;
    let totalDuration = 0;
    const serviceDetails = [];

    for (const serviceId of serviceIdsList) {
      const serviceRow = await client.query(
          `SELECT vs.vendor_service_id, vs.service_id, vs.price, sm.service_name,
                sm.default_duration_minutes
         FROM vendor_services vs
         JOIN services_master sm ON sm.service_id = vs.service_id
         WHERE (vs.vendor_service_id = $1 OR vs.service_id = $1)
           AND vs.vendor_id = $2
           AND vs.status = 'active'
         LIMIT 1`,
          [serviceId, vendorIdInt]
      );
      if (!serviceRow.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Service ${serviceId} not found for vendor ${vendorIdInt}`,
        });
      }
      const service = serviceRow.rows[0];
      totalPrice    += Number(service.price);
      totalDuration += Number(service.default_duration_minutes || 30);
      serviceDetails.push(service);
    }

    // Slot conflict check (existing logic)
    const existingBookings = await client.query(
        `SELECT COUNT(*) 
       FROM bookings
       WHERE vendor_id = $1 
         AND booking_date = $2 
         AND booking_time = $3
         AND booking_status IN ('confirmed', 'completed')
         AND status = 'active'`,
        [vendorIdInt, booking_date, timeSlot]
    );
    if (parseInt(existingBookings.rows[0].count, 10) >= shopDetails.rows[0].no_of_seats) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Selected time slot is not available.' });
    }

    // Close time check
    const shopHours = await client.query(
        `SELECT close_time FROM vendor_shop_details WHERE user_id = $1`,
        [vendorIdInt]
    );
    const closeTime = shopHours.rows[0]?.close_time ?? '21:00:00';
    const [ch, cm]  = closeTime.split(':').map(Number);
    const closeMins = ch * 60 + cm;
    const [th, tm]  = timeSlot.split(':').map(Number);
    const bookingEndMins = th * 60 + tm + totalDuration;
    if (bookingEndMins > closeMins) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Booking would end after closing time. Please choose an earlier slot.',
      });
    }

    // Insert booking
    const bookingResult = await client.query(
        `INSERT INTO bookings (
        user_id, vendor_id, booking_date, booking_time, total_amount,
        booking_status, payment_method, payment_status, customer_notes,
        created_at, updated_at, status
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'pending', $7, NOW(), NOW(), 'active')
      RETURNING booking_id`,
        [customerId, vendorIdInt, booking_date, timeSlot, totalPrice,
          payment_method || 'cash', notes ? [notes] : []]
    );

    const bookingId = bookingResult.rows[0].booking_id;
    let currentStartTime = timeSlot;

    for (const service of serviceDetails) {
      const [hours, minutes] = currentStartTime.split(':').map(Number);
      const startMins = hours * 60 + minutes;
      const endMins   = startMins + Number(service.default_duration_minutes || 30);
      const endTime   = `${String(Math.floor(endMins / 60)).padStart(2,'0')}:${String(endMins % 60).padStart(2,'0')}:00`;

      await client.query(
          `INSERT INTO booking_services (
          booking_id, service_id, service_name, service_price,
          start_time, end_time, duration_minutes, created_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'active')`,
          [bookingId, service.service_id, service.service_name, service.price,
            currentStartTime, endTime, service.default_duration_minutes]
      );
      currentStartTime = endTime;
    }

    await client.query('COMMIT');

    // Fetch full booking for response
    const bookingData = await db.query(
        `SELECT 
        b.booking_id, b.user_id AS customer_id, b.vendor_id, vsd.shop_id,
        TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
        b.booking_time AS time_slot, b.booking_status AS status,
        b.payment_status, b.payment_method,
        CAST(b.total_amount AS DECIMAL(10,2)) AS total_price,
        $1::INTEGER AS total_duration,
        cp.name AS customer_name, cu.phone_number AS customer_phone,
        vsd.shop_name,
        TO_CHAR(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
       FROM bookings b
       JOIN vendor_shop_details vsd ON vsd.user_id = b.vendor_id
       JOIN users cu ON cu.user_id = b.user_id
       LEFT JOIN user_profiles cp ON cp.user_id = cu.user_id AND cp.is_current = true
       WHERE b.booking_id = $2`,
        [totalDuration, bookingId]
    );

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully.',
      data: {
        ...bookingData.rows[0],
        services: serviceDetails.map(s => ({
          service_id:   s.service_id,
          service_name: s.service_name,
          price:        Number(s.price),
          duration:     Number(s.default_duration_minutes),
        })),
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createBooking error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
};
// Create Booking API
// const createBooking = async (req, res) => {
//   const client = await db.pool.connect();
//
//   try {
//     const customerId = req.user.userId;
//     const {
//       vendor_id,
//       booking_date,
//       booking_time,
//       time_slot,
//       services,
//       service_ids,
//       notes,
//       payment_method
//     } = req.body;
//
//     // const timeSlot = time_slot || booking_time;
//     const timeSlot = normalizeTime(time_slot || booking_time);
//
//     let serviceIdsList = [];
//     if (service_ids && Array.isArray(service_ids)) {
//       serviceIdsList = service_ids;
//     } else if (services && Array.isArray(services)) {
//       serviceIdsList = services.map(s =>
//           parseInt(s.vendor_service_id) || parseInt(s.service_id)
//       );
//     }
//
//     if (!vendor_id || !booking_date || !timeSlot || !serviceIdsList.length) {
//       return res.status(400).json({
//         success: false,
//         message: 'Vendor ID, booking date, time, and services are required.',
//       });
//     }
//
//     await client.query('BEGIN');
//
//     const vendorCheck = await client.query(
//         `SELECT user_id FROM users
//        WHERE user_id = $1 AND user_type = 'VENDOR' AND status = 'active'`,
//         [vendor_id]
//     );
//
//     if (!vendorCheck.rows.length) {
//       await client.query('ROLLBACK');
//       return res.status(404).json({
//         success: false,
//         message: 'Vendor not found or not available.',
//       });
//     }
//
//     if (vendorCheck.rows[0].status !== 'active') {
//     }
//
//     const shopDetails = await client.query(
//         `SELECT no_of_seats, shop_id
//        FROM vendor_shop_details WHERE user_id = $1`,
//         [vendor_id]
//     );
//
//     if (!shopDetails.rows.length) {
//       await client.query('ROLLBACK');
//       return res.status(404).json({
//         success: false,
//         message: 'Vendor shop details not found.',
//       });
//     }
//
//     const existingBookings = await client.query(
//         `SELECT COUNT(*)
//        FROM bookings
//        WHERE vendor_id = $1
//          AND booking_date = $2
//          AND booking_time = $3
//          AND booking_status IN ('confirmed', 'completed')
//          AND status = 'active'`,
//         [vendor_id, booking_date, timeSlot]
//     );
//
//     if (
//         parseInt(existingBookings.rows[0].count, 10) >=
//         shopDetails.rows[0].no_of_seats
//     ) {
//       await client.query('ROLLBACK');
//       return res.status(400).json({
//         success: false,
//         message: 'Selected time slot is not available.',
//       });
//     }
//
//     let totalPrice = 0;
//     let totalDuration = 0;
//     const serviceDetails = [];
//
//     for (const serviceId of serviceIdsList) {
//
//       let serviceRow = await client.query(
//           `SELECT
//           vs.vendor_service_id,
//           vs.service_id,
//           vs.price,
//           sm.service_name,
//           sm.default_duration_minutes
//          FROM vendor_services vs
//          JOIN services_master sm ON sm.service_id = vs.service_id
//          WHERE (vs.vendor_service_id = $1 OR vs.service_id = $1)
//            AND vs.vendor_id = $2
//            AND vs.status = 'active'
//          LIMIT 1`,
//           [serviceId, vendor_id]
//       );
//
//       if (!serviceRow.rows.length) {
//         await client.query('ROLLBACK');
//         return res.status(400).json({
//           success: false,
//           message: `Service ${serviceId} not found for this vendor`,
//         });
//       }
//
//       const service = serviceRow.rows[0];
//       totalPrice += Number(service.price);
//       totalDuration += Number(service.default_duration_minutes || 30);
//       serviceDetails.push(service);
//     }
//
//     const bookingResult = await client.query(
//         `INSERT INTO bookings (
//         user_id,
//         vendor_id,
//         booking_date,
//         booking_time,
//         total_amount,
//         booking_status,
//         payment_method,
//         payment_status,
//         customer_notes,
//         created_at,
//         updated_at,
//         status
//       ) VALUES (
//         $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), 'active'
//       )
//       RETURNING booking_id`,
//         [
//           customerId,
//           vendor_id,
//           booking_date,
//           timeSlot,
//           totalPrice,
//           'confirmed',
//           payment_method || 'cash',
//           'pending',
//           notes ? [notes] : [],
//         ]
//     );
//
//     const bookingId = bookingResult.rows[0].booking_id;
//
//     let currentStartTime = timeSlot;
//
//     for (const service of serviceDetails) {
//
//       const [hours, minutes] = currentStartTime.split(':').map(Number);
//       const startMinutes = hours * 60 + minutes;
//       const endMinutes = startMinutes + Number(service.default_duration_minutes || 30);
//       const endHours = Math.floor(endMinutes / 60);
//       const endMins = endMinutes % 60;
//
//       const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
//
//       await client.query(
//           `INSERT INTO booking_services (
//           booking_id,
//           service_id,
//           service_name,
//           service_price,
//           start_time,
//           end_time,
//           duration_minutes,
//           created_at,
//           status
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'active')`,
//           [
//             bookingId,
//             service.service_id,
//             service.service_name,
//             service.price,
//             currentStartTime,
//             endTime,
//             service.default_duration_minutes,
//           ]
//       );
//
//       currentStartTime = endTime;
//     }
//
//     await client.query('COMMIT');
//
//     const bookingData = await client.query(
//         `
//       SELECT
//         b.booking_id,
//         b.user_id AS customer_id,
//         b.vendor_id,
//         vsd.shop_id,
//         TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
//         b.booking_time AS time_slot,
//         b.booking_status AS status,
//         b.payment_status,
//         b.payment_method,
//         CAST(b.total_amount AS DECIMAL(10,2)) AS total_price,
//         $1::INTEGER AS total_duration,
//         cp.name AS customer_name,
//         cu.phone_number AS customer_phone,
//         vsd.shop_name,
//         TO_CHAR(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
//       FROM bookings b
//       JOIN vendor_shop_details vsd ON vsd.user_id = b.vendor_id
//       JOIN users cu ON cu.user_id = b.user_id
//       LEFT JOIN user_profiles cp
//         ON cp.user_id = cu.user_id AND cp.is_current = true
//       WHERE b.booking_id = $2
//       `,
//         [totalDuration, bookingId]
//     );
//
//     const servicesArray = serviceDetails.map(s => ({
//       service_id: s.service_id,
//       service_name: s.service_name,
//       price: Number(s.price),
//       duration: Number(s.default_duration_minutes),
//     }));
//
//     const result = {
//       ...bookingData.rows[0],
//       services: servicesArray,
//     };
//
//     return res.status(201).json({
//       success: true,
//       message: 'Booking created successfully.',
//       data: result,
//     });
//
//   } catch (error) {
//
//     await client.query('ROLLBACK');
//     console.error(error);
//
//     return res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//     });
//
//   } finally {
//     client.release();
//   }
// };

const getMyBookings = async (req, res) => {
  try {
    const customerId = req.user.userId;
    const { status, page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 Fetching bookings for customer:', customerId);
    console.log('Status filter:', status);
    console.log('Page:', page, 'Limit:', limit);

    // ✅ Main query - Fixed JOIN conditions
    let query = `SELECT 
    b.booking_id,
    b.user_id AS customer_id,
    b.vendor_id,
    vsd.shop_id,
    TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
    b.booking_time AS time_slot,
    CAST(b.total_amount AS DECIMAL(10,2)) AS total_price,
    b.booking_status AS status,
    b.payment_status,
    b.payment_method,
    cp.name AS customer_name,
    cu.phone_number AS customer_phone,
    vsd.shop_name,
    TO_CHAR(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    
    COALESCE(
      (SELECT SUM(bs.duration_minutes)
       FROM booking_services bs
       WHERE bs.booking_id = b.booking_id AND bs.status = 'active'),
      0
    ) AS total_duration,
    
    (
      SELECT COALESCE(
        (SELECT json_agg(svc)
         FROM (
           SELECT 
             json_build_object(
               'service_id', bs.service_id,
               'service_name', bs.service_name,
               'price', CAST(bs.service_price AS DECIMAL(10,2)),
               'duration', bs.duration_minutes,
               'start_time', bs.start_time::TEXT,
               'end_time', bs.end_time::TEXT
             ) AS svc
           FROM booking_services bs
           WHERE bs.booking_id = b.booking_id 
             AND bs.status = 'active'
           ORDER BY bs.start_time
         ) ordered_services
        ),
        '[]'::json
      )
    ) AS services

  FROM bookings b
  INNER JOIN vendor_shop_details vsd 
    ON vsd.user_id = b.vendor_id
  INNER JOIN users cu 
    ON cu.user_id = b.user_id
  LEFT JOIN user_profiles cp 
    ON cp.user_id = cu.user_id AND cp.is_current = true

  WHERE b.user_id = $1
    AND b.booking_status != 'deleted'
    `;

    const params = [customerId];
    let paramCount = 2;

    // Add status filter if provided
    if (status) {
      query += ` AND b.booking_status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    console.log('Query params:', params);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) 
      FROM bookings b
      WHERE b.user_id = $1 
        AND b.status = 'active'
      ${status ? `AND b.booking_status = $${params.length > 1 ? 2 : 1}` : ''}
    `;

    const countResult = await db.query(
        countQuery,
        status ? [customerId, status] : [customerId]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    console.log('Total bookings found:', total);

    // Add pagination
    query += `
      ORDER BY b.booking_date DESC, b.booking_time DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(parseInt(limit), parseInt(offset));

    console.log('Final query params:', params);

    // Execute query
    const result = await db.query(query, params);

    console.log('Bookings retrieved:', result.rows.length);

    return res.json({
      success: true,
      message: result.rows.length > 0
          ? 'Bookings loaded successfully'
          : 'No bookings found',
      data: {
        bookings: result.rows,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error('❌ Get bookings error:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);

    return res.status(500).json({
      success: false,
      message: 'Error fetching bookings.',
      error: error.message,
    });
  }
};

// Get booking details
const getBookingDetails = async (req, res) => {
  try {
    const customerId = req.user.userId;
    const { bookingId } = req.params;
    const booking = await db.query(
        `SELECT 
        b.*,
        vsd.shop_name,
        vsd.shop_address,
        vsd.city,
        vsd.state,
        vsd.latitude,
        vsd.longitude,
        up.name as vendor_name,
        u.phone_number as vendor_phone,
        (SELECT document_url FROM vendor_documents
         WHERE vendor_id = b.vendor_id
           AND document_type = 'shop_profile_image'
           AND status = 'active'
           AND verification_status = 'approved'
         LIMIT 1) as shop_image
      FROM bookings b
      INNER JOIN vendor_shop_details vsd ON b.vendor_id = vsd.user_id
      LEFT JOIN users u ON b.vendor_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE b.booking_id = $1 AND b.user_id = $2 AND b.status = 'active'`,
        [bookingId, customerId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    // Get booking services
    const services = await db.query(
        `SELECT * FROM booking_services 
       WHERE booking_id = $1 AND status = 'active'
       ORDER BY created_at`,
        [bookingId]
    );

    res.json({
      success: true,
      message: "Loaded",
      data: {
        ...booking.rows[0],
        services: services.rows
      }
    });

  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking details.',
      error: error.message
    });
  }
};

// Cancel booking
const cancelBooking = async (req, res) => {
  try {
    const customerId = req.user.userId;
    const { bookingId } = req.params;
    const { cancellation_reason } = req.body;

    if (!cancellation_reason) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required.'
      });
    }

    // Check if booking exists and belongs to customer
    const booking = await db.query(
        `SELECT booking_id, vendor_id, booking_status, booking_date 
       FROM bookings 
       WHERE booking_id = $1 AND user_id = $2 AND status = 'active'`,
        [bookingId, customerId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    if (booking.rows[0].booking_status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Booking is already cancelled.'
      });
    }

    if (booking.rows[0].booking_status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed booking.'
      });
    }

    // Update booking
    await db.query(
        `UPDATE bookings 
       SET booking_status = 'cancelled',
           cancellation_reason = $1,
           cancelled_by = 'customer',
           updated_at = NOW()
       WHERE booking_id = $2`,
        [cancellation_reason, bookingId]
    );

    // Update vendor metrics
    await db.query(
        `UPDATE vendor_metrics 
       SET cancelled_bookings = COALESCE(cancelled_bookings, 0) + 1,
           updated_at = NOW()
       WHERE vendor_id = $1`,
        [booking.rows[0].vendor_id]
    );

    // Send notification to vendor
    try {
      const vendorFCM = await db.query(
          'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
          [booking.rows[0].vendor_id]
      );

      if (vendorFCM.rows[0]?.fcm_token) {
        await admin.messaging().send({
          token: vendorFCM.rows[0].fcm_token,
          notification: {
            title: 'Booking Cancelled',
            body: `A booking has been cancelled by customer`
          },
          data: {
            type: 'booking_cancelled',
            booking_id: bookingId.toString()
          }
        });
      }
    } catch (notifError) {
      console.error('Notification error:', notifError);
    }

    res.json({
      success: true,
      message: "Loaded",
      message: 'Booking cancelled successfully.'
    });

  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling booking.',
      error: error.message
    });
  }
};

// ============================================
// REVIEWS
// ============================================

// Add review
// Add review — POST /customer/reviews
const addReview = async (req, res) => {
  try {
    const customerId = req.user.userId;
    const { booking_id, rating, review_text } = req.body;

    if (!booking_id || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and rating are required.'
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5.'
      });
    }

    // Check booking exists, belongs to customer, and is completed
    const booking = await db.query(
        `SELECT vendor_id, booking_status 
       FROM bookings 
       WHERE booking_id = $1 AND user_id = $2 AND status = 'active'`,
        [booking_id, customerId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    if (booking.rows[0].booking_status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only review completed bookings.'
      });
    }

    // Check if already reviewed
    const existingReview = await db.query(
        `SELECT review_id FROM reviews 
       WHERE booking_id = $1 AND status = 'active'`,
        [booking_id]
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this booking.'
      });
    }

    const vendorId = booking.rows[0].vendor_id;

    // Insert review — use user_id not customer_id
    const result = await db.query(
        `INSERT INTO reviews (
        booking_id, user_id, vendor_id, rating, review_text, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'active', NOW())
      RETURNING review_id`,
        [booking_id, customerId, vendorId, rating, review_text || null]
    );

    // Update vendor average rating
    const metrics = await db.query(
        `SELECT average_rating, total_reviews 
       FROM vendor_metrics WHERE vendor_id = $1`,
        [vendorId]
    );

    const currentRating = parseFloat(metrics.rows[0]?.average_rating || 0);
    const currentReviews = parseInt(metrics.rows[0]?.total_reviews || 0);
    const newAverage = ((currentRating * currentReviews) + rating) / (currentReviews + 1);

    await db.query(
        `UPDATE vendor_metrics 
       SET average_rating = $1, total_reviews = total_reviews + 1, updated_at = NOW()
       WHERE vendor_id = $2`,
        [newAverage, vendorId]
    );

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully.',
      data: { review_id: result.rows[0].review_id }
    });

  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting review.',
      error: error.message
    });
  }
};

// ============================================
// CATEGORIES & SERVICES
// ============================================

// Get all categories
const getAllCategories = async (req, res) => {
  try {
    const result = await db.query(
        `SELECT 
        category_id,
        category_name,
        description,
        icon,
        color,
        display_order,
        (SELECT COUNT(*) FROM services_master 
         WHERE category = sc.category_name AND status = 'active') as services_count
      FROM service_categories sc
      WHERE status = 'active' AND is_active = true
      ORDER BY display_order ASC, category_name ASC`
    );

    res.json({
      success: true,
      message:"Hello",
      data: result.rows
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories.',
      error: error.message
    });
  }
};

// Get services by category
const getServicesByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    const result = await db.query(
        `SELECT 
        service_id,
        service_name,
        service_description as description,
        default_duration_minutes as duration_minutes,
        base_price,
        category,
        image_url
      FROM services_master
      WHERE category = $1 AND status = 'active' AND is_available = true
      ORDER BY service_name ASC`,
        [category]
    );

    res.json({
      success: true,
      message:"Hello",
      data: result.rows
    });

  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching services.',
      error: error.message
    });
  }
};

// ============================================
// NOTIFICATIONS
// ============================================

// Get notifications
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(
        `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );

    const total = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
        [userId]
    );

    const unreadCount = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [userId]
    );

    res.json({
      success: true,
      message: "Loaded",
      data: {
        notifications: result.rows,
        unread_count: parseInt(unreadCount.rows[0].count),
        pagination: {
          total: parseInt(total.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(parseInt(total.rows[0].count) / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications.',
      error: error.message
    });
  }
};

// Mark notification as read
const markNotificationRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notificationId } = req.params;

    await db.query(
        `UPDATE notifications 
       SET is_read = true
       WHERE notification_id = $1 AND user_id = $2`,
        [notificationId, userId]
    );

    res.json({
      success: true,
      message: "Loaded",
      message: 'Notification marked as read.'
    });

  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification.',
      error: error.message
    });
  }
};

// Mark all notifications as read
const markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user.userId;

    await db.query(
        `UPDATE notifications 
       SET is_read = true
       WHERE user_id = $1 AND is_read = false`,
        [userId]
    );

    res.json({
      success: true,
      message: "Loaded",
      message: 'All notifications marked as read.'
    });

  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notifications.',
      error: error.message
    });
  }
};

// Update FCM token
const updateFCMToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcm_token, device_id } = req.body;

    if (!fcm_token) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required.'
      });
    }

    await db.query(
        `UPDATE user_profiles 
       SET fcm_token = $1, device_id = $2, updated_at = NOW()
       WHERE user_id = $3 AND is_current = true`,
        [fcm_token, device_id, userId]
    );

    res.json({
      success: true,
      message: "Loaded",
      message: 'FCM token updated successfully.'
    });

  } catch (error) {
    console.error('Update FCM token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating FCM token.',
      error: error.message
    });
  }
};

const _notifyVendorNewBooking = async ({
                                         vendorId,
                                         bookingId,
                                         customerId,
                                         serviceDetails = [],
                                         timeSlot,
                                         bookingDate,
                                       }) => {
  try {
    // ── 1. Resolve vendor FCM token ──────────────────────────────────────
    const vendorRow = await db.query(
        `SELECT up.fcm_token
       FROM user_profiles up
       WHERE up.user_id = $1 AND up.is_current = true`,
        [vendorId]
    );
    if (!vendorRow.rows.length) {
      console.log(`ℹ️ B05: No profile found for vendor ${vendorId}`);
      return;
    }
    const vendorFcmToken = vendorRow.rows[0].fcm_token;

    // ── 2. Resolve customer name ─────────────────────────────────────────
    const customerRow = await db.query(
        `SELECT up.name, u.phone_number
       FROM user_profiles up
       JOIN users u ON u.user_id = up.user_id
       WHERE up.user_id = $1 AND up.is_current = true`,
        [customerId]
    );
    const customerName = customerRow.rows[0]?.name || 'A customer';

    // ── 3. Build notification strings ────────────────────────────────────
    // serviceDetails is an array of objects — pick service_name or name
    const serviceNames = serviceDetails
        .map(s => s.service_name || s.name || '')
        .filter(Boolean)
        .join(', ');

    const shortTime  = timeSlot ? String(timeSlot).substring(0, 5) : '';
    const notifTitle = '🔔 New Booking!';
    const notifBody  = serviceNames
        ? `${customerName} booked ${serviceNames}${shortTime ? ' at ' + shortTime : ''}`
        : `${customerName} made a new booking${shortTime ? ' at ' + shortTime : ''}`;

    // ── 4. Insert in-app notification row for vendor ─────────────────────
    // Adjust column names to match your actual notifications table schema.
    // Common schemas use: user_id | vendor_id | title | message | notification_type
    await db.query(
        `INSERT INTO notifications
         (vendor_id, title, message, notification_type, is_read, created_at)
       VALUES ($1, $2, $3, 'new_booking', false, NOW())
       ON CONFLICT DO NOTHING`,
        [vendorId, notifTitle, notifBody]
    ).catch(dbErr => {
      // Non-fatal — notification insert should never break bookings
      console.warn('⚠️ B05: notifications insert failed:', dbErr.message);
    });

    // ── 5. Send FCM push ──────────────────────────────────────────────────
    if (!vendorFcmToken) {
      console.log(`ℹ️ B05: Vendor ${vendorId} has no FCM token — skipping push`);
      return;
    }

    if (!admin.apps.length) {
      console.warn('⚠️ B05: Firebase Admin not initialised — skipping push');
      return;
    }

    await admin.messaging().send({
      token: vendorFcmToken,

      // data-only so Flutter's onMessage handler fires in foreground
      // and can play the custom sound
      data: {
        type:         'NEW_BOOKING',
        booking_id:   String(bookingId),
        title:        notifTitle,
        body:         notifBody,
        booking_date: bookingDate ? String(bookingDate) : '',
        time_slot:    shortTime,
      },

      android: {
        priority: 'high',
        notification: {
          title:        notifTitle,
          body:         notifBody,
          channelId:    'new_bookings',    // matches kBookingChannel.id in Flutter
          sound:        'booking_alert',   // matches res/raw/booking_alert.mp3
          defaultSound: false,
          priority:     'high',
        },
      },

      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: { title: notifTitle, body: notifBody },
            sound: 'booking_alert.caf',   // matches ios/Runner/booking_alert.caf
            badge: 1,
          },
        },
      },
    });

    console.log(`✅ B05: FCM push sent to vendor ${vendorId} for booking ${bookingId}`);

  } catch (err) {
    // Never throw — a notification failure must not affect the booking
    console.error('❌ _notifyVendorNewBooking error:', err.message);
  }
};

module.exports = {
  getDashboardStats,
  getAllShops,
  getShopDetails,
  getAvailableSlots,
  createBooking,
  getMyBookings,
  getBookingDetails,
  cancelBooking,
  addReview,
  getAllCategories,
  getServicesByCategory,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  updateFCMToken,
  _notifyVendorNewBooking,
};