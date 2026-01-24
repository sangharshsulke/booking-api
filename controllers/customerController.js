const db = require('../config/database');
const admin = require('../config/firebase');

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
<<<<<<< HEAD
      [customerId]
=======
        [customerId]
>>>>>>> 420b244 (Fixes in auth)
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
    const { city, search, category, sort_by = 'rating', page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

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
           AND document_type = 'shop_profile_image' 
           AND status = 'active' 
         LIMIT 1) as profile_image,
        (SELECT COUNT(*) FROM vendor_services vs 
         WHERE vs.vendor_id = u.user_id 
           AND vs.status = 'active' 
           AND vs.is_available = true) as services_count
      FROM users u
      INNER JOIN vendor_shop_details vsd ON u.user_id = vsd.user_id
      LEFT JOIN vendor_metrics vm ON u.user_id = vm.vendor_id
<<<<<<< HEAD
      WHERE u.user_type = 'vendor' 
=======
      WHERE u.user_type = 'VENDOR' 
>>>>>>> 420b244 (Fixes in auth)
        AND u.status = 'active' 
        AND u.status = 'active' 
        AND vsd.status = 'active'
    `;

    const params = [];
    let paramCount = 1;

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

    // Add sorting
    switch(sort_by) {
      case 'rating':
        query += ` ORDER BY vm.average_rating DESC NULLS LAST`;
        break;
      case 'reviews':
        query += ` ORDER BY vm.total_reviews DESC NULLS LAST`;
        break;
      case 'bookings':
        query += ` ORDER BY vm.total_bookings DESC NULLS LAST`;
        break;
      default:
        query += ` ORDER BY vm.average_rating DESC NULLS LAST`;
    }

    // Add pagination
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

    // Get shop images
    const images = await db.query(
        `SELECT document_id, document_url, document_type, is_primary
       FROM vendor_documents
       WHERE vendor_id = $1 
         AND document_type IN ('shop_profile_image', 'shop_gallery_image')
         AND status = 'active'
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
const getAvailableSlots = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required.'
      });
    }

    // Get shop details
    const shop = await db.query(
<<<<<<< HEAD
      `SELECT 
=======
        `SELECT 
>>>>>>> 420b244 (Fixes in auth)
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

    if (shop.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found.'
      });
    }

    const shopData = shop.rows[0];
    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Check if shop is closed on this day
    if (shopData.weekly_holiday && shopData.weekly_holiday.toLowerCase() === dayOfWeek.toLowerCase()) {
      return res.json({
        success: true,
        data: {
          is_closed: true,
          message: `Shop is closed on ${dayOfWeek}`,
          available_slots: []
        }
      });
    }

    // Get existing bookings for this date
    const existingBookings = await db.query(
        `SELECT booking_time, COUNT(*) as bookings_count
       FROM bookings
       WHERE vendor_id = $1 
         AND booking_date = $2
         AND booking_status IN ('confirmed', 'completed')
         AND status = 'active'
       GROUP BY booking_time`,
        [shopData.vendor_id, date]
    );

    // Generate time slots (30-minute intervals)
    const slots = [];
    const openTime = shopData.open_time;
    const closeTime = shopData.close_time;
    const breakStart = shopData.break_start_time;
    const breakEnd = shopData.break_end_time;

    let currentTime = new Date(`2000-01-01 ${openTime}`);
    const endTime = new Date(`2000-01-01 ${closeTime}`);
    const slotDuration = 30; // minutes

    while (currentTime < endTime) {
      const timeString = currentTime.toTimeString().slice(0, 5);

      // Check if slot is during break time
      let isDuringBreak = false;
      if (breakStart && breakEnd) {
        const slotTime = new Date(`2000-01-01 ${timeString}`);
        const breakStartTime = new Date(`2000-01-01 ${breakStart}`);
        const breakEndTime = new Date(`2000-01-01 ${breakEnd}`);
        isDuringBreak = slotTime >= breakStartTime && slotTime < breakEndTime;
      }

      // Check availability
      const booking = existingBookings.rows.find(b => b.booking_time === timeString + ':00');
      const bookedSeats = booking ? parseInt(booking.bookings_count) : 0;
      const availableSeats = shopData.no_of_seats - bookedSeats;

      slots.push({
        time: timeString,
        available_seats: isDuringBreak ? 0 : availableSeats,
        is_available: !isDuringBreak && availableSeats > 0,
        is_break: isDuringBreak
      });

      currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
    }

    res.json({
      success: true,
      message: "Loaded",
      data: {
        is_closed: false,
        date: date,
        open_time: openTime,
        close_time: closeTime,
        break_start_time: breakStart,
        break_end_time: breakEnd,
        total_seats: shopData.no_of_seats,
        available_slots: slots
      }
    });

  } catch (error) {
    console.error('Get available slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available slots.',
      error: error.message
    });
  }
};

// ============================================
// BOOKING MANAGEMENT
// ============================================

// Create Booking API
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
      payment_method
    } = req.body;

    // Accept both time field names
    const timeSlot = time_slot || booking_time;

    // Accept both service formats
    let serviceIdsList = [];
    if (service_ids && Array.isArray(service_ids)) {
      serviceIdsList = service_ids;
    } else if (services && Array.isArray(services)) {
      serviceIdsList = services.map(s =>
          parseInt(s.vendor_service_id) || parseInt(s.service_id)
      );
    }

    // Validation
    if (!vendor_id || !booking_date || !timeSlot || !serviceIdsList.length) {
      return res.status(400).json({
        success: false,
        message: 'Vendor ID, booking date, time, and services are required.',
      });
    }

    await client.query('BEGIN');

    // Verify vendor
    const vendorCheck = await client.query(
<<<<<<< HEAD
      'SELECT user_id, status FROM users WHERE user_id = $1 AND user_type = $2 AND status = $3',
      [vendor_id, 'VENDOR', 'active']
=======
        `SELECT user_id FROM users 
       WHERE user_id = $1 AND user_type = 'VENDOR' AND status = 'active'`,
        [vendor_id]
>>>>>>> 420b244 (Fixes in auth)
    );

    if (!vendorCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Vendor not found or not available.',
      });
    }

<<<<<<< HEAD
    if (vendorCheck.rows[0].status !== 'active') {
=======
    // Get shop details
    const shopDetails = await client.query(
        `SELECT no_of_seats, shop_id 
       FROM vendor_shop_details WHERE user_id = $1`,
        [vendor_id]
    );

    if (!shopDetails.rows.length) {
>>>>>>> 420b244 (Fixes in auth)
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Vendor shop details not found.',
      });
    }

    // Check slot availability
<<<<<<< HEAD
    const shopDetails = await client.query(
      'SELECT no_of_seats FROM vendor_shop_details WHERE user_id = $1',
      [vendor_id]
    );

=======
>>>>>>> 420b244 (Fixes in auth)
    const existingBookings = await client.query(
        `SELECT COUNT(*) 
       FROM bookings
       WHERE vendor_id = $1 
         AND booking_date = $2 
         AND booking_time = $3
         AND booking_status IN ('confirmed', 'completed')
         AND status = 'active'`,
        [vendor_id, booking_date, timeSlot]
    );

    if (
        parseInt(existingBookings.rows[0].count, 10) >=
        shopDetails.rows[0].no_of_seats
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Selected time slot is not available.',
      });
    }

    // Calculate total price and get service details
    let totalPrice = 0;
    let totalDuration = 0;
    const serviceDetails = [];

    for (const serviceId of serviceIdsList) {
      // Find service (try both vendor_service_id and service_id)
      let serviceRow = await client.query(
          `SELECT 
          vs.vendor_service_id,
          vs.service_id,
          vs.price,
          sm.service_name,
          sm.default_duration_minutes
         FROM vendor_services vs
         JOIN services_master sm ON sm.service_id = vs.service_id
         WHERE (vs.vendor_service_id = $1 OR vs.service_id = $1)
           AND vs.vendor_id = $2 
           AND vs.status = 'active'
         LIMIT 1`,
          [serviceId, vendor_id]
      );

      if (!serviceRow.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Service ${serviceId} not found for this vendor`,
        });
      }

      const service = serviceRow.rows[0];
      totalPrice += Number(service.price);
      totalDuration += Number(service.default_duration_minutes || 30);
      serviceDetails.push(service);
    }

    // Insert booking
    const bookingResult = await client.query(
<<<<<<< HEAD
      `INSERT INTO bookings (
=======
        `INSERT INTO bookings (
>>>>>>> 420b244 (Fixes in auth)
        user_id,
        vendor_id,
        booking_date,
        booking_time,
        total_amount,
        booking_status,
        payment_method,
        payment_status,
        customer_notes,
        created_at,
<<<<<<< HEAD
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'confirmed', 'cash', 'pending', $6, NOW(), NOW())
      RETURNING booking_id, booking_date, booking_time, total_amount`,
      [customerId, vendor_id, booking_date, booking_time, totalPrice, [notes]]
=======
        updated_at,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), 'active'
      )
      RETURNING booking_id`,
        [
          customerId,
          vendor_id,
          booking_date,
          timeSlot,
          totalPrice,
          'confirmed',
          payment_method || 'cash',
          'pending',
          notes ? [notes] : [],
        ]
>>>>>>> 420b244 (Fixes in auth)
    );

    const bookingId = bookingResult.rows[0].booking_id;

    // ✅ Insert booking services with start_time and end_time
    let currentStartTime = timeSlot; // Start with booking time

    for (const service of serviceDetails) {
      // Calculate end time based on duration
      const [hours, minutes] = currentStartTime.split(':').map(Number);
      const startMinutes = hours * 60 + minutes;
      const endMinutes = startMinutes + Number(service.default_duration_minutes || 30);
      const endHours = Math.floor(endMinutes / 60);
      const endMins = endMinutes % 60;
      const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

      await client.query(
          `INSERT INTO booking_services (
          booking_id,
          service_id,
          service_name,
          service_price,
          start_time,
          end_time,
          duration_minutes,
<<<<<<< HEAD
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6,$7, NOW())`,
        [
          booking.booking_id,
          service.vendor_service_id,
          serviceData.rows[0].service_name,
          serviceData.rows[0].price,
          '10:00', // Placeholder start time
          '11:00',
          serviceData.rows[0].default_duration_minutes
        ]
=======
          created_at,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'active')`,
          [
            bookingId,
            service.service_id,
            service.service_name,
            service.price,
            currentStartTime,  // ✅ start_time
            endTime,           // ✅ end_time
            service.default_duration_minutes,
          ]
>>>>>>> 420b244 (Fixes in auth)
      );

      // Next service starts when this one ends
      currentStartTime = endTime;
    }

    await client.query('COMMIT');

    // Return complete booking data
    const bookingData = await client.query(
        `
      SELECT 
        b.booking_id,
        b.user_id AS customer_id,
        b.vendor_id,
        vsd.shop_id,
        TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
        b.booking_time AS time_slot,
        b.booking_status AS status,
        b.payment_status,
        b.payment_method,
        CAST(b.total_amount AS DECIMAL(10,2)) AS total_price,
        $1::INTEGER AS total_duration,
        cp.name AS customer_name,
        cu.phone_number AS customer_phone,
        vsd.shop_name,
        TO_CHAR(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
      FROM bookings b
      JOIN vendor_shop_details vsd ON vsd.user_id = b.vendor_id
      JOIN users cu ON cu.user_id = b.user_id
      LEFT JOIN user_profiles cp 
        ON cp.user_id = cu.user_id AND cp.is_current = true
      WHERE b.booking_id = $2
      `,
        [totalDuration, bookingId]
    );

    // Add services array
    const servicesArray = serviceDetails.map(s => ({
      service_id: s.service_id,
      service_name: s.service_name,
      price: Number(s.price),
      duration: Number(s.default_duration_minutes),
    }));

    const result = {
      ...bookingData.rows[0],
      services: servicesArray,
    };

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully.',
      data: result,
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create booking error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating booking.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

const getMyBookings = async (req, res) => {
  try {
    const customerId = req.user.userId;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 Fetching bookings for customer:', customerId);
    console.log('Status filter:', status);
    console.log('Page:', page, 'Limit:', limit);

    // ✅ Main query - Fixed JOIN conditions
    let query = `
      SELECT 
        b.booking_id,
        b.user_id AS customer_id,
        b.vendor_id,
        vsd.shop_id,
        TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
        b.booking_time AS time_slot,
        CAST(b.total_amount AS DECIMAL(10,2)) AS total_price,
        b.booking_status AS status,
        b.payment_status,
<<<<<<< HEAD
        b.customer_notes,
        b.created_at,
        vsd.shop_name,
        vsd.shop_address,
        vsd.city,
        up.name as vendor_name,
        u.phone_number as vendor_phone,
        (SELECT document_url FROM vendor_documents 
         WHERE vendor_id = b.vendor_id 
           AND document_type = 'shop_profile_image' 
           AND status = 'active' 
         LIMIT 1) as shop_image,
        (SELECT COUNT(*) FROM booking_services 
         WHERE booking_id = b.booking_id AND status = 'active') as services_count
      FROM bookings b
      INNER JOIN vendor_shop_details vsd ON b.vendor_id = vsd.user_id
      LEFT JOIN users u ON b.vendor_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE b.user_id = $1 AND b.status = 'active'
=======
        b.payment_method,
        cp.name AS customer_name,
        cu.phone_number AS customer_phone,
        vsd.shop_name,
        TO_CHAR(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        
        -- ✅ Calculate total duration from booking_services
        COALESCE(
          (SELECT SUM(bs.duration_minutes)
           FROM booking_services bs
           WHERE bs.booking_id = b.booking_id AND bs.status = 'active'),
          0
        ) AS total_duration,
        
        -- ✅ Get services array - Fixed JOIN
        (
          SELECT COALESCE(json_agg(
            json_build_object(
              'service_id', bs.service_id,
              'service_name', bs.service_name,
              'price', CAST(bs.service_price AS DECIMAL(10,2)),
              'duration', bs.duration_minutes,
              'start_time', bs.start_time::TEXT,
              'end_time', bs.end_time::TEXT
            )
            ORDER BY bs.start_time
          ), '[]'::json)
          FROM booking_services bs
          WHERE bs.booking_id = b.booking_id 
            AND bs.status = 'active'
        ) AS services

      FROM bookings b
      INNER JOIN vendor_shop_details vsd 
        ON vsd.user_id = b.vendor_id
      INNER JOIN users cu 
        ON cu.user_id = b.user_id
      LEFT JOIN user_profiles cp 
        ON cp.user_id = cu.user_id AND cp.is_current = true

      WHERE b.user_id = $1
        AND b.status = 'active'
>>>>>>> 420b244 (Fixes in auth)
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
<<<<<<< HEAD
      [bookingId, customerId]
=======
        [bookingId, customerId]
>>>>>>> 420b244 (Fixes in auth)
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
const addReview = async (req, res) => {
  try {
    const customerId = req.user.userId;
    const { booking_id, rating, review_text } = req.body;

    // Validation
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

    // Check if booking exists and is completed
    const booking = await db.query(
<<<<<<< HEAD
      `SELECT vendor_id, booking_status FROM bookings 
       WHERE booking_id = $1 AND user_id = $2 AND status = 'active'`,
      [booking_id, customerId]
=======
        `SELECT vendor_id, booking_status FROM bookings 
       WHERE booking_id = $1 AND user_id = $2 AND status = 'active'`,
        [booking_id, customerId]
>>>>>>> 420b244 (Fixes in auth)
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

    // Check if review already exists
    const existingReview = await db.query(
        'SELECT review_id FROM reviews WHERE booking_id = $1 AND status = $2',
        [booking_id, 'active']
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this booking.'
      });
    }

    // Add review
    const result = await db.query(
        `INSERT INTO reviews (
        booking_id,
        customer_id,
        vendor_id,
        rating,
        review_text,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING review_id`,
        [booking_id, customerId, booking.rows[0].vendor_id, rating, review_text]
    );

    // Update vendor metrics
    const metrics = await db.query(
        `SELECT average_rating, total_reviews FROM vendor_metrics 
       WHERE vendor_id = $1`,
        [booking.rows[0].vendor_id]
    );

    const currentRating = parseFloat(metrics.rows[0]?.average_rating || 0);
    const currentReviews = parseInt(metrics.rows[0]?.total_reviews || 0);
    const newAverageRating = ((currentRating * currentReviews) + rating) / (currentReviews + 1);

    await db.query(
        `UPDATE vendor_metrics 
       SET average_rating = $1,
           total_reviews = total_reviews + 1,
           updated_at = NOW()
       WHERE vendor_id = $2`,
        [newAverageRating, booking.rows[0].vendor_id]
    );

    res.status(201).json({
      success: true,
      message: 'Review added successfully.',
      data: {
        review_id: result.rows[0].review_id
      }
    });

  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding review.',
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
       SET is_read = true, read_at = NOW()
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
       SET is_read = true, read_at = NOW()
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
  updateFCMToken
};