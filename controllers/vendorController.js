const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const admin = require('../config/firebase');

// ============================================
// VENDOR PROFILE MANAGEMENT
// ============================================

// Get vendor profile
const getVendorProfile = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const result = await db.query(
        `SELECT 
        u.user_id,
        u.phone_number,
        u.email,
        u.user_type,
        u.status,
        u.phone_verified,
        u.created_at,
        up.name,
        up.city,
        up.state,
        up.gender,
        up.profile_picture,
        up.last_login_at,
        vs.shop_id,
        vs.shop_name,
        vs.shop_address,
        vs.city as shop_city,
        vs.state as shop_state,
        vs.latitude,
        vs.longitude,
        vs.open_time,
        vs.close_time,
        vs.break_start_time,
        vs.break_end_time,
        vs.weekly_holiday,
        vs.no_of_seats,
        vs.no_of_workers,
        vs.verification_status,
        vs.business_license,
        vs.tax_number,
        vs.bank_account_number,
        vs.bank_ifsc_code,
        vm.total_bookings,
        vm.completed_bookings,
        vm.cancelled_bookings,
        vm.average_rating,
        vm.total_reviews,
        vm.total_revenue
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      LEFT JOIN vendor_shop_details vs ON u.user_id = vs.user_id
      LEFT JOIN vendor_metrics vm ON u.user_id = vm.vendor_id
      WHERE u.user_id = $1`,
        [vendorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found.'
      });
    }

    // Get shop images
    const images = await db.query(
        `SELECT document_id, document_url, document_type, is_primary
       FROM vendor_documents
       WHERE vendor_id = $1 
         AND document_type IN ('shop_profile_image', 'shop_gallery_image')
         AND status = 'active'
       ORDER BY is_primary DESC, created_at DESC`,
        [vendorId]
    );

    res.json({
      success: true,
      message: 'Vendor profile retrieved successfully.',
      data: {
        ...result.rows[0],
        shop_images: images.rows
      }
    });

  } catch (error) {
    console.error('Get vendor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendor profile.',
      error: error.message
    });
  }
};

// Update vendor personal profile
const updateVendorProfile = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const vendorId = req.user.userId;
    const { name, email, city, state, gender, profile_picture } = req.body;

    await client.query('BEGIN');

    // Update email in users table if provided
    if (email) {
      // Check if email already exists for another user
      const emailCheck = await client.query(
          'SELECT user_id FROM users WHERE email = $1 AND user_id != $2',
          [email, vendorId]
      );

      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Email already exists.'
        });
      }

      await client.query(
          'UPDATE users SET email = $1, updated_at = NOW() WHERE user_id = $2',
          [email, vendorId]
      );
    }

    // Mark current profile as not current
    await client.query(
        'UPDATE user_profiles SET is_current = false WHERE user_id = $1 AND is_current = true',
        [vendorId]
    );

    // Insert new profile version
    await client.query(
        `INSERT INTO user_profiles (user_id, name, city, state, gender, profile_picture, is_current, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
        [vendorId, name, city, state, gender, profile_picture]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Profile updated successfully.'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update vendor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// ============================================
// VENDOR SHOP MANAGEMENT
// ============================================

// Get vendor shop details
const getVendorShop = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const shop = await db.query(
        `SELECT 
      shop_id,
      user_id AS vendor_id,
      shop_name,
      shop_address,
      city,
      state,
      latitude,
      longitude,
      open_time,
      close_time,
      break_start_time,
      break_end_time,
      weekly_holiday,
      no_of_seats,
      no_of_workers,
      verification_status,
      admin_comments,
      verified_at,
      verified_by,
      business_license,
      tax_number,
      bank_account_number,
      bank_ifsc_code,
      status,
      created_at,
      updated_at,
      deleted_at
   FROM vendor_shop_details 
   WHERE user_id = $1`,
        [vendorId]
    );

    if (shop.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop details not found. Please create your shop first.'
      });
    }

    // Get shop documents
    const documents = await db.query(
        `SELECT document_id, document_url, document_type, is_primary, verification_status, admin_comments
       FROM vendor_documents
       WHERE vendor_id = $1 AND status = 'active'
       ORDER BY is_primary DESC, created_at DESC`,
        [vendorId]
    );

    res.json({
      success: true,
      message: 'Shop details retrieved successfully.',
      data: {
        ...shop.rows[0],
        documents: documents.rows
      }
    });

  } catch (error) {
    console.error('Get vendor shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching shop details.',
      error: error.message
    });
  }
};

// Create or update vendor shop
const createOrUpdateVendorShop = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const {
      shop_name, shop_address, city, state,
      latitude, longitude, open_time, close_time,
      break_start_time, break_end_time, weekly_holiday,
      no_of_seats, no_of_workers, business_license,
      tax_number, bank_account_number, bank_ifsc_code
    } = req.body;

    // Validation
    if (!shop_name || !shop_address || !city || !state || !open_time || !close_time) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: shop_name, shop_address, city, state, open_time, close_time'
      });
    }

    // Check if shop exists
    const existingShop = await db.query(
        'SELECT shop_id FROM vendor_shop_details WHERE user_id = $1',
        [vendorId]
    );

    let result;

    if (existingShop.rows.length > 0) {
      // Update existing shop
      result = await db.query(
          `UPDATE vendor_shop_details SET
          shop_name = $1,
          shop_address = $2,
          city = $3,
          state = $4,
          latitude = $5,
          longitude = $6,
          open_time = $7,
          close_time = $8,
          break_start_time = $9,
          break_end_time = $10,
          weekly_holiday = $11,
          no_of_seats = $12,
          no_of_workers = $13,
          business_license = $14,
          tax_number = $15,
          bank_account_number = $16,
          bank_ifsc_code = $17,
          updated_at = NOW()
        WHERE user_id = $18
        RETURNING *`,
          [
            shop_name, shop_address, city, state,
            latitude, longitude, open_time, close_time,
            break_start_time, break_end_time, weekly_holiday,
            no_of_seats || 1, no_of_workers || 1, business_license,
            tax_number, bank_account_number, bank_ifsc_code,
            vendorId
          ]
      );

      res.json({
        success: true,
        message: 'Shop updated successfully.',
        data: result.rows[0]
      });
    } else {
      // Create new shop
      result = await db.query(
          `INSERT INTO vendor_shop_details (
          user_id, shop_name, shop_address, city, state,
          latitude, longitude, open_time, close_time,
          break_start_time, break_end_time, weekly_holiday,
          no_of_seats, no_of_workers, business_license,
          tax_number, bank_account_number, bank_ifsc_code,
          verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pending', NOW(), NOW())
        RETURNING *`,
          [
            vendorId, shop_name, shop_address, city, state,
            latitude, longitude, open_time, close_time,
            break_start_time, break_end_time, weekly_holiday,
            no_of_seats || 1, no_of_workers || 1, business_license,
            tax_number, bank_account_number, bank_ifsc_code
          ]
      );

      res.status(201).json({
        success: true,
        message: 'Shop created successfully.',
        data: result.rows[0]
      });
    }

  } catch (error) {
    console.error('Create/Update shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Error managing shop details.',
      error: error.message
    });
  }
};

// Update shop operating hours
const updateShopOperatingHours = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { open_time, close_time, break_start_time, break_end_time, weekly_holiday } = req.body;

    if (!open_time || !close_time) {
      return res.status(400).json({
        success: false,
        message: 'Open time and close time are required.'
      });
    }

    const result = await db.query(
        `UPDATE vendor_shop_details SET
        open_time = $1,
        close_time = $2,
        break_start_time = $3,
        break_end_time = $4,
        weekly_holiday = $5,
        updated_at = NOW()
      WHERE user_id = $6
      RETURNING *`,
        [open_time, close_time, break_start_time, break_end_time, weekly_holiday, vendorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found. Please create shop details first.'
      });
    }

    res.json({
      success: true,
      message: 'Operating hours updated successfully.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update operating hours error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating operating hours.',
      error: error.message
    });
  }
};

// Update shop capacity
const updateShopCapacity = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { no_of_seats, no_of_workers } = req.body;

    if (!no_of_seats || !no_of_workers) {
      return res.status(400).json({
        success: false,
        message: 'Number of seats and workers are required.'
      });
    }

    const result = await db.query(
        `UPDATE vendor_shop_details SET
        no_of_seats = $1,
        no_of_workers = $2,
        updated_at = NOW()
      WHERE user_id = $3
      RETURNING *`,
        [no_of_seats, no_of_workers, vendorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found.'
      });
    }

    res.json({
      success: true,
      message: 'Shop capacity updated successfully.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update shop capacity error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating shop capacity.',
      error: error.message
    });
  }
};

// ============================================
// VENDOR SERVICE MANAGEMENT
// ============================================

// Get all services from master
const getAllServicesMaster = async (req, res) => {
  try {
    const result = await db.query(
        `SELECT 
        service_id,
        service_name,
        service_description as description,
        default_duration_minutes as duration_minutes,
        base_price,
        category,
        is_available,
        document_url,
        requirements,
        benefits,
        service_type,
        status
      FROM services_master 
      WHERE status = 'active'
      ORDER BY category, service_name`
    );

    res.json({
      success: true,
      message: 'Services fetched successfully.',
      data: {
        services: result.rows,
        total: result.rows.length
      }
    });

  } catch (error) {
    console.error('Get all services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching services.',
      error: error.message
    });
  }
};

// Get vendor's services
const getVendorServices = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const result = await db.query(
        `SELECT 
        vs.vendor_service_id,
        vs.service_id,
        vs.vendor_id,
        sm.service_name,
        sm.service_description as description,
        vs.price,
        sm.default_duration_minutes as duration_minutes,
        sm.category,
        vs.is_available,
<<<<<<< HEAD
        sm.document_url,
        vs.created_at
=======
        sm.image_url,
        vs.created_at,
        vs.updated_at
>>>>>>> 420b244 (Fixes in auth)
      FROM vendor_services vs
      INNER JOIN services_master sm ON vs.service_id = sm.service_id
      WHERE vs.vendor_id = $1 
        AND vs.status = 'active' 
        AND sm.status = 'active'
      ORDER BY sm.category, sm.service_name`,
        [vendorId]
    );

    res.json({
      success: true,
      message: 'Vendor services fetched successfully.',
      data: {
        services: result.rows,
        total: result.rows.length
      }
    });

  } catch (error) {
    console.error('Get vendor services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vendor services.',
      error: error.message
    });
  }
};

// Add service to vendor
const addVendorService = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { service_id, price, is_available } = req.body;

    // Validation
    if (!service_id || !price) {
      return res.status(400).json({
        success: false,
        message: 'Service ID and price are required.'
      });
    }

    // Check if service exists in master
    const serviceCheck = await db.query(
        'SELECT service_id FROM services_master WHERE service_id = $1 AND status = $2',
        [service_id, 'active']
    );

    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found in master list.'
      });
    }

    // Check if vendor already has this service
    const existingService = await db.query(
        'SELECT vendor_service_id FROM vendor_services WHERE vendor_id = $1 AND service_id = $2 AND status = $3',
        [vendorId, service_id, 'active']
    );

    if (existingService.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This service is already added to your shop.'
      });
    }

    // Add service
    const result = await db.query(
        `INSERT INTO vendor_services (
        vendor_id, 
        service_id, 
        price, 
        is_available, 
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW())
      RETURNING vendor_service_id`,
        [vendorId, service_id, price, is_available !== false]
    );

    res.status(201).json({
      success: true,
      message: 'Service added successfully.',
      data: {
        vendor_service_id: result.rows[0].vendor_service_id
      }
    });

  } catch (error) {
    console.error('Add vendor service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding service.',
      error: error.message
    });
  }
};

// Add multiple services at once
const addMultipleVendorServices = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const vendorId = req.user.userId;
    const { services } = req.body;

    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Services array is required.'
      });
    }

    await client.query('BEGIN');

    const addedServices = [];
    const errors = [];

    for (const service of services) {
      try {
        const { service_id, price, is_available } = service;

        // Check if already exists
        const existing = await client.query(
            'SELECT vendor_service_id FROM vendor_services WHERE vendor_id = $1 AND service_id = $2 AND status = $3',
            [vendorId, service_id, 'active']
        );

        if (existing.rows.length === 0) {
          const result = await client.query(
              `INSERT INTO vendor_services (
              vendor_id, service_id, price, is_available, status, created_at
            ) VALUES ($1, $2, $3, $4, 'active', NOW())
            RETURNING vendor_service_id`,
              [vendorId, service_id, price, is_available !== false]
          );

          addedServices.push({
            service_id,
            vendor_service_id: result.rows[0].vendor_service_id
          });
        } else {
          errors.push({
            service_id,
            message: 'Service already exists'
          });
        }
      } catch (err) {
        errors.push({
          service_id: service.service_id,
          message: err.message
        });
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `${addedServices.length} service(s) added successfully.`,
      data: {
        added: addedServices,
        errors: errors
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add multiple services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding services.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Update vendor service
const updateVendorService = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { service_id } = req.params;
    const { price, is_available } = req.body;

    // Check ownership
    const serviceCheck = await db.query(
        'SELECT vendor_service_id FROM vendor_services WHERE vendor_service_id = $1 AND vendor_id = $2 AND status = $3',
        [service_id, vendorId, 'active']
    );

    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found or does not belong to you.'
      });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (price !== undefined) {
      updates.push(`price = $${paramCount++}`);
      values.push(price);
    }

    if (is_available !== undefined) {
      updates.push(`is_available = $${paramCount++}`);
      values.push(is_available);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update.'
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(service_id);

    const query = `
      UPDATE vendor_services 
      SET ${updates.join(', ')}
      WHERE vendor_service_id = $${paramCount}
      RETURNING *
    `;

    const result = await db.query(query, values);

    res.json({
      success: true,
      message: 'Service updated successfully.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update vendor service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating service.',
      error: error.message
    });
  }
};

// Toggle service availability
const toggleServiceAvailability = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { service_id } = req.params;
    const { is_available } = req.body;

    const result = await db.query(
        `UPDATE vendor_services 
       SET is_available = $1, updated_at = NOW()
       WHERE vendor_service_id = $2 AND vendor_id = $3 AND status = 'active'
       RETURNING is_available`,
        [is_available, service_id, vendorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found.'
      });
    }

    res.json({
      success: true,
      message: `Service ${is_available ? 'enabled' : 'disabled'} successfully.`,
      data: {
        is_available: result.rows[0].is_available
      }
    });

  } catch (error) {
    console.error('Toggle availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating service availability.',
      error: error.message
    });
  }
};

// Delete vendor service (soft delete)
const deleteVendorService = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { service_id } = req.params;

    const result = await db.query(
        `UPDATE vendor_services 
       SET status = 'inactive', deleted_at = NOW()
       WHERE vendor_service_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [service_id, vendorId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found.'
      });
    }

    res.json({
      success: true,
      message: 'Service removed successfully.'
    });

  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing service.',
      error: error.message
    });
  }
};

// ============================================
// VENDOR BOOKING MANAGEMENT
// ============================================

// Get vendor bookings with filters
const getVendorBookings = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const {
      status,
      date_from,
      date_to,
      booking_date,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        b.*,
        COALESCE(up.name) as customer_name,
        COALESCE(u.phone_number) as customer_phone,
        COALESCE(u.email) as customer_email,
        (SELECT COUNT(*) FROM booking_services bs 
         WHERE bs.booking_id = b.booking_id AND bs.status = 'active') as services_count
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE b.vendor_id = $1 AND b.status = 'active'
    `;

    const params = [vendorId];
    let paramCount = 2;

    if (status) {
      query += ` AND b.booking_status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (booking_date) {
      query += ` AND b.booking_date = $${paramCount}`;
      params.push(booking_date);
      paramCount++;
    } else {
      if (date_from) {
        query += ` AND b.booking_date >= $${paramCount}`;
        params.push(date_from);
        paramCount++;
      }

      if (date_to) {
        query += ` AND b.booking_date <= $${paramCount}`;
        params.push(date_to);
        paramCount++;
      }
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${query}) as total_count`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    query += ` ORDER BY b.booking_date DESC, b.booking_time DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      message: 'Bookings retrieved successfully.',
      data: {
        bookings: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get vendor bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings.',
      error: error.message
    });
  }
};

// Get booking details
const getBookingDetails = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;

    const booking = await db.query(
        `SELECT 
        b.*,
        COALESCE(up.name) as customer_name,
        COALESCE(u.phone_number) as customer_phone,
        COALESCE(u.email) as customer_email,
        up.profile_picture as customer_photo
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE b.booking_id = $1 AND b.vendor_id = $2 AND b.status = 'active'`,
        [bookingId, vendorId]
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
       ORDER BY start_time`,
        [bookingId]
    );

    res.json({
      success: true,
      message: 'Booking details retrieved successfully.',
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

// Accept booking
const acceptBooking = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;
    const { customer_notes } = req.body;

    // Check if booking belongs to vendor and is pending
    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status 
       FROM bookings 
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    if (booking.rows[0].booking_status !== 'pending' && booking.rows[0].booking_status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking with status: ${booking.rows[0].booking_status}`
      });
    }

    // Update booking status
    const result = await db.query(
        `UPDATE bookings 
       SET booking_status = 'confirmed',
           customer_notes = $1,
           updated_at = NOW()
       WHERE booking_id = $2
       RETURNING *`,
        [customer_notes, bookingId]
    );

    // Send notification to customer
    if (booking.rows[0].customer_id) {
      try {
        const customerFCM = await db.query(
            'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
            [booking.rows[0].customer_id]
        );

        if (customerFCM.rows[0]?.fcm_token) {
          await admin.messaging().send({
            token: customerFCM.rows[0].fcm_token,
            notification: {
              title: 'Booking Confirmed',
              body: 'Your booking has been confirmed by the vendor'
            },
            data: {
              type: 'booking_confirmed',
              booking_id: bookingId.toString()
            }
          });
        }
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: 'Booking accepted successfully.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Accept booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting booking.',
      error: error.message
    });
  }
};

// Reject booking
const rejectBooking = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required.'
      });
    }

    // Check if booking belongs to vendor
    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status 
       FROM bookings 
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
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
        message: 'Cannot reject completed booking.'
      });
    }

    // Update booking
    const result = await db.query(
        `UPDATE bookings 
       SET booking_status = 'cancelled',
           cancellation_reason = $1,
           cancelled_by = 'vendor',
           payment_status = CASE 
             WHEN payment_status = 'paid' THEN 'refunded'
             ELSE payment_status
           END,
           updated_at = NOW()
       WHERE booking_id = $2
       RETURNING *`,
        [rejection_reason, bookingId]
    );

    // Update vendor metrics
    await db.query(
        `UPDATE vendor_metrics 
       SET cancelled_bookings = COALESCE(cancelled_bookings, 0) + 1,
           updated_at = NOW()
       WHERE vendor_id = $1`,
        [vendorId]
    );

    // Send notification to customer
    if (booking.rows[0].customer_id) {
      try {
        const customerFCM = await db.query(
            'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
            [booking.rows[0].customer_id]
        );

        if (customerFCM.rows[0]?.fcm_token) {
          await admin.messaging().send({
            token: customerFCM.rows[0].fcm_token,
            notification: {
              title: 'Booking Cancelled',
              body: 'Your booking has been cancelled by the vendor'
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
    }

    res.json({
      success: true,
      message: 'Booking rejected successfully.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting booking.',
      error: error.message
    });
  }
};

// Complete booking
const completeBooking = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;
    const { customer_notes, actual_amount } = req.body;

    // Check if booking belongs to vendor
    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status, total_amount 
       FROM bookings 
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    if (booking.rows[0].booking_status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Can only complete confirmed bookings. Current status: ${booking.rows[0].booking_status}`
      });
    }

    // Update booking
    const finalAmount = actual_amount || booking.rows[0].total_amount;

    const result = await db.query(
        `UPDATE bookings 
       SET booking_status = 'completed',
           customer_notes = $1,
           total_amount = $2,
           payment_status = 'paid',
           updated_at = NOW()
       WHERE booking_id = $3
       RETURNING *`,
        [customer_notes, finalAmount, bookingId]
    );

    // Update vendor metrics
    await db.query(
        `UPDATE vendor_metrics 
       SET completed_bookings = COALESCE(completed_bookings, 0) + 1,
           total_revenue = COALESCE(total_revenue, 0) + $1,
           last_booking_date = CURRENT_DATE,
           updated_at = NOW()
       WHERE vendor_id = $2`,
        [finalAmount, vendorId]
    );

    // Send notification to customer
    if (booking.rows[0].customer_id) {
      try {
        const customerFCM = await db.query(
            'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
            [booking.rows[0].customer_id]
        );

        if (customerFCM.rows[0]?.fcm_token) {
          await admin.messaging().send({
            token: customerFCM.rows[0].fcm_token,
            notification: {
              title: 'Service Completed',
              body: 'Your service has been completed. Please rate your experience!'
            },
            data: {
              type: 'booking_completed',
              booking_id: bookingId.toString()
            }
          });
        }
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: 'Booking completed successfully.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking.',
      error: error.message
    });
  }
};

// Mark customer as no-show
const markNoShow = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;
    const { customer_notes } = req.body;

    // Check if booking belongs to vendor
    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status 
       FROM bookings 
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    if (booking.rows[0].booking_status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Can only mark confirmed bookings as no-show.'
      });
    }

    // Update booking
    const result = await db.query(
        `UPDATE bookings 
       SET booking_status = 'no_show',
           customer_notes = $1,
           updated_at = NOW()
       WHERE booking_id = $2
       RETURNING *`,
        [customer_notes, bookingId]
    );

    res.json({
      success: true,
      message: 'Booking marked as no-show.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Mark no-show error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking no-show.',
      error: error.message
    });
  }
};

// Create offline booking (walk-in customer)
const createOfflineBooking = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const vendorId = req.user.userId;
    const {
      offline_customer_name,
      offline_customer_phone,
      offline_customer_email,
      booking_date,
      booking_time,
      services,
      payment_method,
      customer_notes
    } = req.body;

    // Validation
    if (!offline_customer_name || !offline_customer_phone || !booking_date || !booking_time) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, date, and time are required.'
      });
    }

    if (!services || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one service is required.'
      });
    }

    await client.query('BEGIN');

    // Calculate total price and duration
    let totalPrice = 0;
    let totalDuration = 0;

    for (const service of services) {
      const serviceCheck = await client.query(
          `SELECT vs.price, sm.default_duration_minutes 
         FROM vendor_services vs
         INNER JOIN services_master sm ON vs.service_id = sm.service_id
         WHERE vs.vendor_service_id = $1 AND vs.vendor_id = $2 AND vs.status = 'active'`,
          [service.vendor_service_id, vendorId]
      );

      if (serviceCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Service ID ${service.vendor_service_id} not found.`
        });
      }

      totalPrice += parseFloat(serviceCheck.rows[0].price);
      totalDuration += parseInt(serviceCheck.rows[0].default_duration_minutes);
    }

    // Create booking
    const bookingResult = await client.query(
        `INSERT INTO bookings (
        vendor_id,
        offline_customer_name,
        offline_customer_phone,
        offline_customer_email,
        booking_date,
        booking_time,
        total_amount,
        total_duration_minutes,
        booking_status,
        payment_method,
        payment_status,
        customer_notes,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, 'paid', $10, NOW(), NOW())
      RETURNING booking_id, booking_date, booking_time, total_amount`,
        [
          vendorId,
          offline_customer_name,
          offline_customer_phone,
          offline_customer_email,
          booking_date,
          booking_time,
          totalPrice,
          totalDuration,
          payment_method || 'cash',
          customer_notes
        ]
    );

    const booking = bookingResult.rows[0];

    // Add booking services
    for (const service of services) {
      const serviceData = await client.query(
          `SELECT vs.price, sm.service_name, sm.default_duration_minutes
         FROM vendor_services vs
         INNER JOIN services_master sm ON vs.service_id = sm.service_id
         WHERE vs.vendor_service_id = $1`,
          [service.vendor_service_id]
      );

      await client.query(
          `INSERT INTO booking_services (
          booking_id,
          service_id,
          service_name,
          service_price,
          duration_minutes,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            booking.booking_id,
            service.vendor_service_id,
            serviceData.rows[0].service_name,
            serviceData.rows[0].price,
            serviceData.rows[0].default_duration_minutes
          ]
      );
    }

    // Update vendor metrics
    await client.query(
        `UPDATE vendor_metrics 
       SET total_bookings = COALESCE(total_bookings, 0) + 1,
           completed_bookings = COALESCE(completed_bookings, 0) + 1,
           total_revenue = COALESCE(total_revenue, 0) + $1,
           last_booking_date = CURRENT_DATE,
           updated_at = NOW()
       WHERE vendor_id = $2`,
        [totalPrice, vendorId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Offline booking created successfully.',
      data: booking
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create offline booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating offline booking.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// ============================================
// VENDOR DASHBOARD
// ============================================

const getDashboardStats = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    // Get basic stats
    const stats = await db.query(
        `SELECT 
        vm.total_bookings,
        vm.completed_bookings,
        vm.cancelled_bookings,
        vm.average_rating,
        vm.total_reviews,
        vm.total_revenue
      FROM vendor_metrics vm
      WHERE vm.vendor_id = $1`,
        [vendorId]
    );

    // Get today's bookings
    const todayBookings = await db.query(
        `SELECT 
        b.booking_id,
        b.booking_time,
        b.total_amount,
        b.booking_status,
        COALESCE(up.name) as customer_name,
        COALESCE(u.phone_number) as customer_phone
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.user_id
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       WHERE b.vendor_id = $1 
         AND b.booking_date = CURRENT_DATE
         AND b.status = 'active'
       ORDER BY b.booking_time ASC`,
        [vendorId]
    );

    // Get pending bookings count
    const pendingCount = await db.query(
        `SELECT COUNT(*) as count
       FROM bookings
       WHERE vendor_id = $1 
         AND booking_status = 'pending'
         AND status = 'active'`,
        [vendorId]
    );

    // Get this month's revenue
    const monthlyRevenue = await db.query(
        `SELECT COALESCE(SUM(total_amount), 0) as revenue
       FROM bookings
       WHERE vendor_id = $1
         AND booking_status = 'completed'
         AND EXTRACT(MONTH FROM booking_date) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(YEAR FROM booking_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND status = 'active'`,
        [vendorId]
    );

    // Get total services count
    const servicesCount = await db.query(
        `SELECT COUNT(*) as count
       FROM vendor_services
       WHERE vendor_id = $1 AND status = 'active'`,
        [vendorId]
    );

    // Get upcoming bookings
    const upcomingBookings = await db.query(
        `SELECT 
        b.booking_id,
        b.booking_date,
        b.booking_time,
        b.total_amount,
        b.booking_status,
        COALESCE(up.name) as customer_name,
        COALESCE(u.phone_number) as customer_phone
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE b.vendor_id = $1 
        AND b.booking_date >= CURRENT_DATE
        AND b.booking_status IN ('confirmed', 'pending')
        AND b.status = 'active'
      ORDER BY b.booking_date ASC, b.booking_time ASC
      LIMIT 10`,
        [vendorId]
    );

    const statsData = stats.rows[0] || {
      total_bookings: 0,
      completed_bookings: 0,
      cancelled_bookings: 0,
      average_rating: 0,
      total_reviews: 0,
      total_revenue: 0
    };

    res.json({
      success: true,
      message: 'Dashboard analytics loaded successfully.',
      data: {
        total_bookings: statsData.total_bookings || 0,
        completed_bookings: statsData.completed_bookings || 0,
        cancelled_bookings: statsData.cancelled_bookings || 0,
        pending_bookings: parseInt(pendingCount.rows[0].count),
        todays_bookings: todayBookings.rows,
        todays_bookings_count: todayBookings.rows.length,
        monthly_revenue: parseFloat(monthlyRevenue.rows[0].revenue),
        average_rating: parseFloat(statsData.average_rating) || 0,
        total_reviews: statsData.total_reviews || 0,
        total_services: parseInt(servicesCount.rows[0].count),
        upcoming_bookings: upcomingBookings.rows
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics.',
      error: error.message
    });
  }
};

// ============================================
// IMAGE UPLOAD CONFIGURATION
// ============================================

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/shops';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'shop-' + uniqueSuffix + ext);
  }
});

const fileFilter = function (req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images (JPEG, PNG, WEBP) are allowed!'));
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter
});

// Upload shop profile image
const uploadShopProfileImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      const vendorId = req.user.userId;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image provided.'
        });
      }

      const imageUrl = `/uploads/shops/${req.file.filename}`;

      // Deactivate old profile image
      await db.query(
          `UPDATE vendor_documents 
         SET status = 'inactive', deleted_at = NOW()
         WHERE vendor_id = $1 
           AND document_type = 'shop_profile_image' 
           AND status = 'active'`,
          [vendorId]
      );

      // Insert new profile image
      const result = await db.query(
          `INSERT INTO vendor_documents (
          vendor_id, document_url, document_type, is_primary,
          verification_status, created_at, updated_at
        ) VALUES ($1, $2, 'shop_profile_image', true, 'approved', NOW(), NOW())
        RETURNING *`,
          [vendorId, imageUrl]
      );

      res.json({
        success: true,
        message: 'Profile image uploaded successfully.',
        data: result.rows[0]
      });

    } catch (error) {
      console.error('Upload profile image error:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading image.',
        error: error.message
      });
    }
  }
];

// Upload shop gallery images
const uploadShopGalleryImages = [
  upload.array('images', 10),
  async (req, res) => {
    const client = await db.pool.connect();

    try {
      const vendorId = req.user.userId;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No images provided.'
        });
      }

      // Check current gallery images count
      const currentCount = await db.query(
          `SELECT COUNT(*) as count 
         FROM vendor_documents 
         WHERE vendor_id = $1 
           AND document_type = 'shop_gallery_image' 
           AND status = 'active'`,
          [vendorId]
      );

      const total = parseInt(currentCount.rows[0].count) + req.files.length;

      if (total > 10) {
        return res.status(400).json({
          success: false,
          message: `Maximum 10 gallery images allowed. Current: ${currentCount.rows[0].count}, Trying to add: ${req.files.length}`
        });
      }

      await client.query('BEGIN');

      const uploadedImages = [];

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const imageUrl = `/uploads/shops/${file.filename}`;
        const isPrimary = i === 0 && currentCount.rows[0].count === '0';

        const result = await client.query(
            `INSERT INTO vendor_documents (
            vendor_id, document_url, document_type, is_primary,
            verification_status, created_at, updated_at
          ) VALUES ($1, $2, 'shop_gallery_image', $3, 'approved', NOW(), NOW())
          RETURNING *`,
            [vendorId, imageUrl, isPrimary]
        );

        uploadedImages.push(result.rows[0]);
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `${uploadedImages.length} image(s) uploaded successfully.`,
        data: uploadedImages
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Upload gallery images error:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading images.',
        error: error.message
      });
    } finally {
      client.release();
    }
  }
];

// Get vendor images
const getVendorImages = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const result = await db.query(
        `SELECT document_id, document_url, document_type, is_primary, created_at
       FROM vendor_documents
       WHERE vendor_id = $1 
         AND document_type IN ('shop_profile_image', 'shop_gallery_image')
         AND status = 'active'
       ORDER BY is_primary DESC, created_at DESC`,
        [vendorId]
    );

    res.json({
      success: true,
      message: 'Vendor images loaded successfully.',
      data: result.rows
    });

  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching images.',
      error: error.message
    });
  }
};

// Delete vendor image
const deleteVendorImage = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { document_id } = req.params;

    // Get image details
    const image = await db.query(
        'SELECT document_url FROM vendor_documents WHERE document_id = $1 AND vendor_id = $2 AND status = $3',
        [image_id, vendorId, 'active']
    );

    if (image.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Image not found.'
      });
    }

    // Soft delete
    await db.query(
        `UPDATE vendor_documents 
       SET status = 'inactive', deleted_at = NOW()
       WHERE document_id = $1`,
        [image_id]
    );

    // Optional: Delete physical file
    const filePath = path.join(__dirname, '..', image.rows[0].document_url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      message: 'Image deleted successfully.'
    });

  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting image.',
      error: error.message
    });
  }
};

// Set primary gallery image
const setPrimaryImage = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { image_id } = req.params;

    // Check if image exists
    const image = await db.query(
        `SELECT document_id FROM vendor_documents 
       WHERE document_id = $1 
         AND vendor_id = $2 
         AND document_type = 'shop_gallery_image'
         AND status = 'active'`,
        [image_id, vendorId]
    );

    if (image.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Image not found.'
      });
    }

    // Remove primary flag from all gallery images
    await db.query(
        `UPDATE vendor_documents 
       SET is_primary = false
       WHERE vendor_id = $1 
         AND document_type = 'shop_gallery_image'`,
        [vendorId]
    );

    // Set new primary image
    await db.query(
        `UPDATE vendor_documents 
       SET is_primary = true
       WHERE document_id = $1`,
        [image_id]
    );

    res.json({
      success: true,
      message: 'Primary image updated successfully.'
    });

  } catch (error) {
    console.error('Set primary image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting primary image.',
      error: error.message
    });
  }
};

// ============================================
// VENDOR REVIEWS
// ============================================

// Get vendor reviews
const getVendorReviews = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const reviews = await db.query(
        `SELECT 
        r.review_id,
        r.rating,
        r.review_text,
        r.created_at,
        b.booking_id,
        b.booking_date,
        COALESCE(up.name) as customer_name,
        up.profile_picture as customer_photo
      FROM reviews r
      INNER JOIN bookings b ON r.booking_id = b.booking_id
      LEFT JOIN users u ON r.user_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      WHERE r.vendor_id = $1 AND r.status = 'active'
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
        [vendorId, limit, offset]
    );

    const total = await db.query(
        'SELECT COUNT(*) FROM reviews WHERE vendor_id = $1 AND status = $2',
        [vendorId, 'active']
    );

    res.json({
      success: true,
      message: 'Reviews retrieved successfully.',
      data: {
        reviews: reviews.rows,
        pagination: {
          total: parseInt(total.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(parseInt(total.rows[0].count) / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews.',
      error: error.message
    });
  }
};

module.exports = {
  // Profile Management
  getVendorProfile,
  updateVendorProfile,

  // Shop Management
  getVendorShop,
  createOrUpdateVendorShop,
  updateShopOperatingHours,
  updateShopCapacity,

  // Service Management
  getAllServicesMaster,
  getVendorServices,
  addVendorService,
  addMultipleVendorServices,
  updateVendorService,
  toggleServiceAvailability,
  deleteVendorService,

  // Booking Management
  getVendorBookings,
  getBookingDetails,
  acceptBooking,
  rejectBooking,
  completeBooking,
  markNoShow,
  createOfflineBooking,

  // Dashboard
  getDashboardStats,

  // Image Management
  uploadShopProfileImage,
  uploadShopGalleryImages,
  getVendorImages,
  deleteVendorImage,
  setPrimaryImage,

  // Reviews
  getVendorReviews
};