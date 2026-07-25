const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const admin = require('../config/firebase');

// ============================================
// VENDOR PROFILE MANAGEMENT
// ============================================
const normalizeTime = (t) => {
  if (!t) return t;
  const parts = t.split(':');
  return parts.length === 2 ? `${parts[0]}:${parts[1]}:00` : t;
};

const cleanError = (e) => {
  const s = e instanceof Error ? e.message : String(e);
  return s.startsWith('Exception: ') ? s.slice(11) : s;
};
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
        vs.pincode,
        vs.shop_description AS description,
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
        vs.verification_status AS approval_status,
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
        `SELECT document_id, document_url, document_type, is_primary,
              verification_status, admin_comments
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
      pincode,
      shop_description AS description,
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
      shop_name, shop_address, city, state, pincode, description,
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
    shop_name = $1, shop_address = $2, city = $3, state = $4,
    latitude = $5, longitude = $6, open_time = $7, close_time = $8,
    break_start_time = $9, break_end_time = $10, weekly_holiday = $11,
    no_of_seats = $12, no_of_workers = $13, business_license = $14,
    tax_number = $15, bank_account_number = $16, bank_ifsc_code = $17,
    pincode = $18, shop_description = $19,
    updated_at = NOW()
  WHERE user_id = $20
  RETURNING
    shop_id,
    user_id AS vendor_id,
    shop_name, shop_address, city, state,
    latitude, longitude, open_time, close_time,
    break_start_time, break_end_time, weekly_holiday,
    no_of_seats, no_of_workers,
    verification_status, admin_comments,
    business_license, tax_number, bank_account_number, bank_ifsc_code,
    pincode, shop_description AS description,
    status, created_at, updated_at`,
          [
            shop_name, shop_address, city, state,
            latitude || null, longitude || null, open_time, close_time,
            break_start_time || null, break_end_time || null, weekly_holiday || null,
            no_of_seats || 1, no_of_workers || 1, business_license || null,
            tax_number || null, bank_account_number || null, bank_ifsc_code || null,
            pincode || null, description || null,
            vendorId
          ]
      );
      // result = await db.query(
      //     `UPDATE vendor_shop_details SET
      //     shop_name = $1,
      //     shop_address = $2,
      //     city = $3,
      //     state = $4,
      //     latitude = $5,
      //     longitude = $6,
      //     open_time = $7,
      //     close_time = $8,
      //     break_start_time = $9,
      //     break_end_time = $10,
      //     weekly_holiday = $11,
      //     no_of_seats = $12,
      //     no_of_workers = $13,
      //     business_license = $14,
      //     tax_number = $15,
      //     bank_account_number = $16,
      //     bank_ifsc_code = $17,
      //     updated_at = NOW()
      //   WHERE user_id = $18
      //   RETURNING *`,
      //     [
      //       shop_name, shop_address, city, state,
      //       latitude, longitude, open_time, close_time,
      //       break_start_time, break_end_time, weekly_holiday,
      //       no_of_seats || 1, no_of_workers || 1, business_license,
      //       tax_number, bank_account_number, bank_ifsc_code,
      //       vendorId
      //     ]
      // );

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
          pincode, shop_description,
          verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'pending', NOW(), NOW())
        RETURNING *, shop_description AS description`,
          [
            vendorId, shop_name, shop_address, city, state,
            latitude, longitude, open_time, close_time,
            break_start_time, break_end_time, weekly_holiday,
            no_of_seats || 1, no_of_workers || 1, business_license,
            tax_number, bank_account_number, bank_ifsc_code,
            pincode || null, description || null
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
        service_description AS description,
        default_duration_minutes AS duration_minutes,
        service_type,
        status
      FROM services_master
      WHERE status = 'active'
        AND deleted_at IS NULL
      ORDER BY service_name`
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
        sm.image_url,
        vs.created_at
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


// Add a custom service (not from master catalog)
const addCustomService = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const {
      service_name,
      price,
      description,
      is_available
    } = req.body;

    // Validation — duration is fixed at 30 minutes per business rules
    if (!service_name || !price) {
      return res.status(400).json({
        success: false,
        message: 'service_name and price are required.'
      });
    }

    if (isNaN(price) || parseFloat(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a positive number.'
      });
    }

    // Upsert into services_master — reuse existing entry if name already taken
    const masterResult = await db.query(
        `INSERT INTO services_master (
          service_name,
          service_description,
          default_duration_minutes,
          service_type,
          status,
          created_at,
          updated_at
        ) VALUES ($1, $2, 30, 'custom', 'active', NOW(), NOW())
        ON CONFLICT (service_name) DO UPDATE
          SET updated_at = NOW()
        RETURNING service_id`,
        [service_name.trim(), description || null]
    );

    const newServiceId = masterResult.rows[0].service_id;

    // Check if vendor already has this service linked
    const existing = await db.query(
        `SELECT vendor_service_id FROM vendor_services
         WHERE vendor_id = $1 AND service_id = $2`,
        [vendorId, newServiceId]
    );

    let vendorServiceId;
    if (existing.rows.length > 0) {
      // Already linked — update price & availability
      const updated = await db.query(
          `UPDATE vendor_services
           SET price = $1, is_available = $2, status = 'active', updated_at = NOW()
           WHERE vendor_id = $3 AND service_id = $4
           RETURNING vendor_service_id`,
          [parseFloat(price), is_available !== false, vendorId, newServiceId]
      );
      vendorServiceId = updated.rows[0].vendor_service_id;
    } else {
      // New link
      const inserted = await db.query(
          `INSERT INTO vendor_services (
            vendor_id, service_id, price, is_available, status, created_at
          ) VALUES ($1, $2, $3, $4, 'active', NOW())
          RETURNING vendor_service_id`,
          [vendorId, newServiceId, parseFloat(price), is_available !== false]
      );
      vendorServiceId = inserted.rows[0].vendor_service_id;
    }

    res.status(201).json({
      success: true,
      message: 'Custom service added successfully.',
      data: {
        vendor_service_id: vendorServiceId,
        service_id: newServiceId,
        service_name: service_name.trim(),
        price: parseFloat(price),
        duration_minutes: 30,
        is_available: is_available !== false
      }
    });

  } catch (error) {
    console.error('Add custom service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding custom service.',
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
      RETURNING vendor_service_id
    `;

    const result = await db.query(query, values);

    // Return full service data so Flutter can parse VendorService correctly
    const fullService = await db.query(
      `SELECT
         vs.vendor_service_id,
         vs.service_id,
         sm.service_name,
         sm.service_description  AS description,
         sm.category,
         vs.price,
         sm.default_duration_minutes AS duration_minutes,
         vs.is_available,
         sm.image_url,
         vs.created_at
       FROM vendor_services vs
       JOIN services_master sm ON sm.service_id = vs.service_id
       WHERE vs.vendor_service_id = $1`,
      [result.rows[0].vendor_service_id]
    );

    res.json({
      success: true,
      message: 'Service updated successfully.',
      data: fullService.rows[0]
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
      limit = 100
    } = req.query;

    const offset = (page - 1) * limit;

    let query = `
      SELECT
        b.*,
        COALESCE(up.name) as customer_name,
        COALESCE(u.phone_number) as customer_phone,
        COALESCE(u.email) as customer_email,
        (SELECT COUNT(*) FROM booking_services bs
         WHERE bs.booking_id = b.booking_id AND bs.status = 'active') as services_count,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'service_name', bs2.service_name,
            'price', bs2.service_price,
            'duration_minutes', bs2.duration_minutes
          ))
           FROM booking_services bs2
           WHERE bs2.booking_id = b.booking_id AND bs2.status = 'active'),
          '[]'::json
        ) as services
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
// ─────────────────────────────────────────────────────────────────────────────
// ACCEPT BOOKING
// ─────────────────────────────────────────────────────────────────────────────
const acceptBooking = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;

    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status
       FROM bookings
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
    );

    if (!booking.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    const { booking_status, user_id: customerId } = booking.rows[0];

    if (booking_status !== 'pending' && booking_status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking with status: ${booking_status}`,
      });
    }

    // FIX: removed vendor_notes — column does not exist in bookings table
    const result = await db.query(
        `UPDATE bookings
       SET booking_status = 'confirmed',
           updated_at = NOW()
       WHERE booking_id = $1
       RETURNING *`,
        [bookingId]
    );

    const shopRow = await db.query(
        `SELECT shop_name FROM vendor_shop_details WHERE user_id = $1`,
        [vendorId]
    );
    const shopName = shopRow.rows[0]?.shop_name;

    _notifyCustomerBookingUpdate({
      customerId,
      bookingId,
      status: 'confirmed',
      shopName,
    }).catch(err => console.error('⚠️ acceptBooking notify failed:', err.message));

    res.json({
      success: true,
      message: 'Booking accepted successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Accept booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting booking.',
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REJECT BOOKING
// ─────────────────────────────────────────────────────────────────────────────
const rejectBooking = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required.',
      });
    }

    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status
       FROM bookings
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
    );

    if (!booking.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    const { booking_status, user_id: customerId } = booking.rows[0];

    if (booking_status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Booking is already cancelled.' });
    }
    if (booking_status === 'completed') {
      return res.status(400).json({ success: false, message: 'Cannot reject completed booking.' });
    }

    // FIX: no vendor_notes column — only updating booking_status and cancellation fields
    const result = await db.query(
        `UPDATE bookings
       SET booking_status      = 'cancelled',
           cancellation_reason = $1,
           cancelled_by        = 'vendor',
           payment_status      = CASE
                                   WHEN payment_status = 'paid' THEN 'refunded'
                                   ELSE payment_status
                                 END,
           updated_at          = NOW()
       WHERE booking_id = $2
       RETURNING *`,
        [rejection_reason, bookingId]
    );

    await db.query(
        `UPDATE vendor_metrics
       SET cancelled_bookings = COALESCE(cancelled_bookings, 0) + 1,
           updated_at = NOW()
       WHERE vendor_id = $1`,
        [vendorId]
    );

    const shopRow = await db.query(
        `SELECT shop_name FROM vendor_shop_details WHERE user_id = $1`,
        [vendorId]
    );
    const shopName = shopRow.rows[0]?.shop_name;

    _notifyCustomerBookingUpdate({
      customerId,
      bookingId,
      status:     'rejected',
      vendorNotes: rejection_reason,
      shopName,
    }).catch(err => console.error('⚠️ rejectBooking notify failed:', err.message));

    res.json({
      success: true,
      message: 'Booking rejected successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting booking.',
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE BOOKING
// ─────────────────────────────────────────────────────────────────────────────
const completeBooking = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { bookingId } = req.params;
    const { actual_amount } = req.body;

    const booking = await db.query(
        `SELECT booking_id, user_id, booking_status, total_amount, booking_date, booking_time
       FROM bookings
       WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
        [bookingId, vendorId]
    );

    if (!booking.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    const { booking_status, user_id: customerId, total_amount, booking_date, booking_time } = booking.rows[0];

    if (booking_status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Can only complete confirmed bookings. Current status: ${booking_status}`,
      });
    }

    // BUG 30: Prevent completing booking before its start time
    const now = new Date();
    const bookingStart = new Date(
      (booking_date instanceof Date
        ? booking_date.toISOString().split('T')[0]
        : String(booking_date).split('T')[0])
      + 'T' + booking_time
    );
    if (now < bookingStart) {
      return res.status(400).json({
        success: false,
        message: 'Cannot complete booking before its start time.'
      });
    }

    const finalAmount = actual_amount || total_amount;

    // FIX: removed vendor_notes = $1 — column does not exist in bookings table
    const result = await db.query(
        `UPDATE bookings
       SET booking_status = 'completed',
           total_amount   = $1,
           payment_status = 'paid',
           updated_at     = NOW()
       WHERE booking_id = $2
       RETURNING *`,
        [finalAmount, bookingId]
    );

    await db.query(
        `UPDATE vendor_metrics
       SET completed_bookings = COALESCE(completed_bookings, 0) + 1,
           total_revenue      = COALESCE(total_revenue, 0) + $1,
           last_booking_date  = CURRENT_DATE,
           updated_at         = NOW()
       WHERE vendor_id = $2`,
        [finalAmount, vendorId]
    );

    // In-app notification for customer
    await db.query(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, is_read, created_at)
       VALUES ($1, $2, $3, 'booking_completed', false, NOW())`,
        [
          customerId,
          'Service Completed! 🎉',
          "Your service has been completed. We'd love your feedback!",
        ]
    ).catch(err =>
        console.warn('⚠️ completed notification insert failed:', err.message)
    );

    const shopRow = await db.query(
        `SELECT shop_name FROM vendor_shop_details WHERE user_id = $1`,
        [vendorId]
    );
    const shopName = shopRow.rows[0]?.shop_name;

    _notifyCustomerBookingUpdate({
      customerId,
      bookingId,
      status: 'completed',
      shopName,
    }).catch(err =>
        console.error('⚠️ completeBooking notify failed:', err.message)
    );

    res.json({
      success: true,
      message: 'Booking completed successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking.',
      error: error.message,
    });
  }
};

// // Accept booking
// const acceptBooking = async (req, res) => {
//   try {
//     const vendorId = req.user.userId;
//     const { bookingId } = req.params;
//     const { customer_notes } = req.body;
//
//     // Check if booking belongs to vendor and is pending
//     const booking = await db.query(
//         `SELECT booking_id, user_id, booking_status
//        FROM bookings
//        WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
//         [bookingId, vendorId]
//     );
//
//     if (booking.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Booking not found.'
//       });
//     }
//
//     if (booking.rows[0].booking_status !== 'pending' && booking.rows[0].booking_status !== 'confirmed') {
//       return res.status(400).json({
//         success: false,
//         message: `Cannot accept booking with status: ${booking.rows[0].booking_status}`
//       });
//     }
//
//     // Update booking status
//     const result = await db.query(
//         `UPDATE bookings
//        SET booking_status = 'confirmed',
//            customer_notes = $1,
//            updated_at = NOW()
//        WHERE booking_id = $2
//        RETURNING *`,
//         [customer_notes, bookingId]
//     );
//
//     // Send notification to customer
//     if (booking.rows[0].customer_id) {
//       try {
//         const customerFCM = await db.query(
//             'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
//             [booking.rows[0].customer_id]
//         );
//
//         if (customerFCM.rows[0]?.fcm_token) {
//           await admin.messaging().send({
//             token: customerFCM.rows[0].fcm_token,
//             notification: {
//               title: 'Booking Confirmed',
//               body: 'Your booking has been confirmed by the vendor'
//             },
//             data: {
//               type: 'booking_confirmed',
//               booking_id: bookingId.toString()
//             }
//           });
//
//             _notifyCustomerBookingUpdate({
//     customerId: bookingRow.rows[0].user_id,
//     bookingId:  bookingId,
//     status:     'confirmed',
//     vendorNotes: vendorNotes,
//     shopName:   shopRow.rows[0]?.shop_name,
//   }).catch(err => console.error('Notify failed:', err.message));
//         }
//       } catch (notifError) {
//         console.error('Notification error:', notifError);
//       }
//     }
//
//     res.json({
//       success: true,
//       message: 'Booking accepted successfully.',
//       data: result.rows[0]
//     });
//
//   } catch (error) {
//     console.error('Accept booking error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error accepting booking.',
//       error: error.message
//     });
//   }
// };
//
// // Reject booking
// const rejectBooking = async (req, res) => {
//   try {
//     const vendorId = req.user.userId;
//     const { bookingId } = req.params;
//     const { rejection_reason } = req.body;
//
//     if (!rejection_reason) {
//       return res.status(400).json({
//         success: false,
//         message: 'Rejection reason is required.'
//       });
//     }
//
//     // Check if booking belongs to vendor
//     const booking = await db.query(
//         `SELECT booking_id, user_id, booking_status
//        FROM bookings
//        WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
//         [bookingId, vendorId]
//     );
//
//     if (booking.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Booking not found.'
//       });
//     }
//
//     if (booking.rows[0].booking_status === 'cancelled') {
//       return res.status(400).json({
//         success: false,
//         message: 'Booking is already cancelled.'
//       });
//     }
//
//     if (booking.rows[0].booking_status === 'completed') {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot reject completed booking.'
//       });
//     }
//
//     // Update booking
//     const result = await db.query(
//         `UPDATE bookings
//        SET booking_status = 'cancelled',
//            cancellation_reason = $1,
//            cancelled_by = 'vendor',
//            payment_status = CASE
//              WHEN payment_status = 'paid' THEN 'refunded'
//              ELSE payment_status
//            END,
//            updated_at = NOW()
//        WHERE booking_id = $2
//        RETURNING *`,
//         [rejection_reason, bookingId]
//     );
//
//     // Update vendor metrics
//     await db.query(
//         `UPDATE vendor_metrics
//        SET cancelled_bookings = COALESCE(cancelled_bookings, 0) + 1,
//            updated_at = NOW()
//        WHERE vendor_id = $1`,
//         [vendorId]
//     );
//
//     // Send notification to customer
//     if (booking.rows[0].customer_id) {
//       try {
//         const customerFCM = await db.query(
//             'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
//             [booking.rows[0].customer_id]
//         );
//
//         if (customerFCM.rows[0]?.fcm_token) {
//           await admin.messaging().send({
//             token: customerFCM.rows[0].fcm_token,
//             notification: {
//               title: 'Booking Cancelled',
//               body: 'Your booking has been cancelled by the vendor'
//             },
//             data: {
//               type: 'booking_cancelled',
//               booking_id: bookingId.toString()
//             }
//           });
//         }
//       } catch (notifError) {
//         console.error('Notification error:', notifError);
//       }
//     }
//       _notifyCustomerBookingUpdate({
//     customerId: bookingRow.rows[0].user_id,
//     bookingId:  bookingId,
//     status:     'rejected',
//     vendorNotes: rejectionReason,
//     shopName:   shopRow.rows[0]?.shop_name,
//   }).catch(err => console.error('Notify failed:', err.message));
//
//     res.json({
//       success: true,
//       message: 'Booking rejected successfully.',
//       data: result.rows[0]
//     });
//
//   } catch (error) {
//     console.error('Reject booking error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error rejecting booking.',
//       error: error.message
//     });
//   }
// };
//
// // Complete booking
// const completeBooking = async (req, res) => {
//   try {
//     const vendorId = req.user.userId;
//     const { bookingId } = req.params;
//     const { customer_notes, actual_amount } = req.body;
//
//     // Check if booking belongs to vendor
//     const booking = await db.query(
//         `SELECT booking_id, user_id, booking_status, total_amount
//        FROM bookings
//        WHERE booking_id = $1 AND vendor_id = $2 AND status = 'active'`,
//         [bookingId, vendorId]
//     );
//
//     if (booking.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Booking not found.'
//       });
//     }
//
//     if (booking.rows[0].booking_status !== 'confirmed') {
//       return res.status(400).json({
//         success: false,
//         message: `Can only complete confirmed bookings. Current status: ${booking.rows[0].booking_status}`
//       });
//     }
//
//     // Update booking
//     const finalAmount = actual_amount || booking.rows[0].total_amount;
//
//     const result = await db.query(
//         `UPDATE bookings
//        SET booking_status = 'completed',
//            customer_notes = $1,
//            total_amount = $2,
//            payment_status = 'paid',
//            updated_at = NOW()
//        WHERE booking_id = $3
//        RETURNING *`,
//         [customer_notes, finalAmount, bookingId]
//     );
//
//     // Update vendor metrics
//     await db.query(
//         `UPDATE vendor_metrics
//        SET completed_bookings = COALESCE(completed_bookings, 0) + 1,
//            total_revenue = COALESCE(total_revenue, 0) + $1,
//            last_booking_date = CURRENT_DATE,
//            updated_at = NOW()
//        WHERE vendor_id = $2`,
//         [finalAmount, vendorId]
//     );
//
//     // Send notification to customer
//     // Insert in-app notification for customer
//     try {
//       // Get customer user_id from booking
//       const customerRow = await db.query(
//           'SELECT user_id FROM bookings WHERE booking_id = $1',
//           [bookingId]
//       );
//       const customerId = customerRow.rows[0]?.user_id;
//
//       if (customerId) {
//         // Insert into notifications table
//         await db.query(
//             `INSERT INTO notifications (user_id, title, message, notification_type, is_read, created_at)
//        VALUES ($1, $2, $3, 'booking_completed', false, NOW())`,
//             [
//               customerId,
//               'Service Completed! 🎉',
//               `Your service has been completed. We'd love to hear your feedback! Tap to rate your experience.`
//             ]
//         );
//
//         // Send FCM push notification
//         const customerFCM = await db.query(
//             'SELECT fcm_token FROM user_profiles WHERE user_id = $1 AND is_current = true',
//             [customerId]
//         );
//
//         if (customerFCM.rows[0]?.fcm_token) {
//           await admin.messaging().send({
//             token: customerFCM.rows[0].fcm_token,
//             notification: {
//               title: 'Service Completed! 🎉',
//               body: `Your service is done. Tap to leave feedback!`
//             },
//             data: {
//               type: 'booking_completed',
//               booking_id: bookingId.toString()
//             }
//           });
//         }
//           _notifyCustomerBookingUpdate({
//     customerId: bookingRow.rows[0].user_id,
//     bookingId:  bookingId,
//     status:     'completed',
//     shopName:   shopRow.rows[0]?.shop_name,
//   }).catch(err => console.error('Notify failed:', err.message));
//       }
//     } catch (notifError) {
//       console.error('Notification error:', notifError);
//     }
//
//     res.json({
//       success: true,
//       message: 'Booking completed successfully.',
//       data: result.rows[0]
//     });
//
//   } catch (error) {
//     console.error('Complete booking error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error completing booking.',
//       error: error.message
//     });
//   }
// };

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
      customer_name,
      customer_phone,
      booking_date,
      booking_time,
      services,
      payment_method,
      customer_notes,
    } = req.body;

    // Validation
    if (!customer_name || !customer_phone || !booking_date || !booking_time) {
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

    // Build customer_notes JSON — stores walk-in customer info
    // since the bookings table has no offline_customer_name/phone columns.
    // Format: "Walk-in: <name> | <phone> | <notes>"
    const walkinInfo = [
      `Walk-in: ${customer_name}`,
      `Phone: ${customer_phone}`,
      customer_notes ? `Note: ${customer_notes}` : null,
    ]
        .filter(Boolean)
        .join(' | ');

    // Create booking — fixed parameter numbers ($1 through $7)
    const bookingResult = await client.query(
        `INSERT INTO bookings (
        vendor_id,
        user_id,
        booking_date,
        booking_time,
        total_amount,
        booking_status,
        payment_method,
        payment_status,
        customer_notes,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'completed', $6, 'paid', $7, NOW(), NOW())
      RETURNING booking_id, vendor_id, booking_date, booking_time, total_amount, payment_method, payment_status`,
        [
          vendorId,   // $1
          vendorId,       // $2
          booking_date,      // $3
          booking_time,      // $4
          totalPrice,        // $5
          payment_method || 'cash',  // $6
          [walkinInfo],        // $7 — customer name + phone stored here
        ]
    );


    const booking = bookingResult.rows[0];

    // Add booking services
    // Normalise booking_time to HH:MM:SS before the loop
    const normalizeTime = (t) => {
      if (!t) return t;
      const parts = t.split(':');
      if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
      return t;
    };
    const normalizedTime = normalizeTime(booking_time);

// Add booking services
    for (const service of services) {
      const serviceData = await client.query(
          `SELECT vs.price, sm.service_name, sm.default_duration_minutes
     FROM vendor_services vs
     INNER JOIN services_master sm ON vs.service_id = sm.service_id
     WHERE vs.vendor_service_id = $1`,
          [service.vendor_service_id]
      );

      if (serviceData.rows.length === 0) continue;

      await client.query(
          `INSERT INTO booking_services (
      booking_id,
      service_id,
      service_name,
      service_price,
      duration_minutes,
      start_time,
      end_time,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            booking.booking_id,                               // $1
            service.vendor_service_id,                        // $2
            serviceData.rows[0].service_name,                 // $3
            serviceData.rows[0].price,                        // $4
            serviceData.rows[0].default_duration_minutes,     // $5
            normalizedTime,                                   // $6 start_time
            normalizedTime,                                   // $7 end_time
          ]
      );
    }

    // Update vendor metrics
    await client.query(
        `UPDATE vendor_metrics 
       SET total_bookings    = COALESCE(total_bookings, 0)    + 1,
           completed_bookings = COALESCE(completed_bookings, 0) + 1,
           total_revenue     = COALESCE(total_revenue, 0)     + $1,
           last_booking_date = CURRENT_DATE,
           updated_at        = NOW()
       WHERE vendor_id = $2`,
        [totalPrice, vendorId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Offline booking created successfully.',
      data: {
        ...booking,
        customer_name,
        customer_phone,
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create offline booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating offline booking.'+req.user.userId,
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

    // Get live stats directly from bookings + reviews tables (source of truth)
    const stats = await db.query(
        `SELECT
        COUNT(b.booking_id)                                                         AS total_bookings,
        COUNT(b.booking_id) FILTER (WHERE b.booking_status = 'completed')          AS completed_bookings,
        COUNT(b.booking_id) FILTER (WHERE b.booking_status IN ('rejected','cancelled')) AS cancelled_bookings,
        COALESCE(SUM(b.total_amount) FILTER (WHERE b.booking_status = 'completed'), 0) AS total_revenue,
        COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.vendor_id = $1), 0)  AS average_rating,
        COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.vendor_id = $1), 0)       AS total_reviews
      FROM bookings b
      WHERE b.vendor_id = $1 AND b.status = 'active'`,
        [vendorId]
    );

    // Keep vendor_metrics in sync
    if (stats.rows.length > 0) {
      const s = stats.rows[0];
      db.query(
          `INSERT INTO vendor_metrics (vendor_id, total_bookings, completed_bookings, cancelled_bookings, total_revenue, average_rating, total_reviews, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (vendor_id) DO UPDATE SET
             total_bookings    = EXCLUDED.total_bookings,
             completed_bookings= EXCLUDED.completed_bookings,
             cancelled_bookings= EXCLUDED.cancelled_bookings,
             total_revenue     = EXCLUDED.total_revenue,
             average_rating    = EXCLUDED.average_rating,
             total_reviews     = EXCLUDED.total_reviews,
             updated_at        = NOW()`,
          [vendorId, s.total_bookings, s.completed_bookings, s.cancelled_bookings,
            s.total_revenue, s.average_rating, s.total_reviews]
      ).catch(e => console.warn('vendor_metrics sync warning:', e.message));
    }

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
        AND (
          b.booking_date > CURRENT_DATE
          OR (b.booking_date = CURRENT_DATE AND b.booking_time > CURRENT_TIME)
        )
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
        total_bookings: parseInt(statsData.total_bookings) || 0,
        completed_bookings: parseInt(statsData.completed_bookings) || 0,
        cancelled_bookings: parseInt(statsData.cancelled_bookings) || 0,
        pending_bookings: parseInt(pendingCount.rows[0].count),
        todays_bookings: todayBookings.rows,
        todays_bookings_count: todayBookings.rows.length,
        monthly_revenue: parseFloat(monthlyRevenue.rows[0].revenue),
        average_rating: parseFloat(statsData.average_rating) || 0,
        total_reviews: parseInt(statsData.total_reviews) || 0,
        total_revenue: parseFloat(statsData.total_revenue) || 0,
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
  const allowedTypes = /jpeg|jpg|png|webp|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images (JPEG, PNG, PDF, WEBP) are allowed!'));
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

      // Insert new profile image — starts as 'pending' until admin approves
      const result = await db.query(
          `INSERT INTO vendor_documents (
          vendor_id, document_url, document_type, is_primary,
          verification_status, created_at, updated_at
        ) VALUES ($1, $2, 'shop_profile_image', true, 'pending', NOW(), NOW())
        RETURNING *`,
          [vendorId, imageUrl]
      );

      res.json({
        success: true,
        message: 'Profile image uploaded successfully. It will be visible to customers after admin approval.',
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

      const { document_type } = req.body; // 'shop' or 'portfolio'

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

        // Gallery images start as 'pending' until admin approves
        const result = await client.query(
            `INSERT INTO vendor_documents (
            vendor_id, document_url, document_type, is_primary,
            verification_status, created_at, updated_at
          ) VALUES ($1, $2, 'shop_gallery_image', $3, 'pending', NOW(), NOW())
          RETURNING *`,
            [vendorId, imageUrl, isPrimary]
        );

        uploadedImages.push(result.rows[0]);
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `${uploadedImages.length} image(s) uploaded successfully. They will be visible to customers after admin approval.`,
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
        `SELECT document_id, document_url, document_type, is_primary,
              verification_status, admin_comments, created_at
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
        [document_id, vendorId, 'active']
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
        [document_id]
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
         AND vendor_id = $2`,
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

// Upload vendor document (business_license, tax_doc, etc.)
// Upload vendor document (business_license, tax_doc, etc.)
const uploadVendorDocument = [
  upload.single('document'),   // ← matches Flutter's field name
  async (req, res) => {
    try {
      const vendorId = req.user.userId;
      const { document_type } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No document provided.'
        });
      }

      if (!document_type) {
        return res.status(400).json({
          success: false,
          message: 'document_type is required.'
        });
      }

      const documentUrl = `/uploads/shops/${req.file.filename}`;

      // Deactivate existing document of same type
      await db.query(
          `UPDATE vendor_documents 
         SET status = 'inactive', deleted_at = NOW()
         WHERE vendor_id = $1 AND document_type = $2 AND status = 'active'`,
          [vendorId, document_type]
      );

      // Insert new document
      const result = await db.query(
          `INSERT INTO vendor_documents (
          vendor_id, document_url, document_type, is_primary,
          verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, false, 'pending', NOW(), NOW())
        RETURNING *`,
          [vendorId, documentUrl, document_type]
      );

      res.json({
        success: true,
        message: 'Document uploaded successfully.',
        data: result.rows[0]
      });

    } catch (error) {
      console.error('Upload document error:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading document.',
        error: error.message
      });
    }
  }
];

// Get vendor business documents (not images)
const getVendorDocuments = async (req, res) => {
  try {
    const vendorId = req.user.userId;

    const result = await db.query(
        `SELECT document_id, document_url, document_type, is_primary, 
              verification_status, admin_comments, created_at
       FROM vendor_documents
       WHERE vendor_id = $1 
         AND document_type NOT IN ('shop_profile_image', 'shop_gallery_image')
         AND status = 'active'
       ORDER BY created_at DESC`,
        [vendorId]
    );

    res.json({
      success: true,
      message: 'Vendor documents loaded successfully.',
      data: result.rows
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching documents.',
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

const _notifyCustomerBookingUpdate = async ({
                                              customerId,
                                              bookingId,
                                              status,         // 'confirmed' | 'rejected' | 'completed'
                                              vendorNotes,
                                              shopName,
                                            }) => {
  try {
    // 1. Get customer FCM token
    const customerRow = await db.query(
        `SELECT up.fcm_token, up.name
       FROM user_profiles up
       WHERE up.user_id = $1 AND up.is_current = true`,
        [customerId]
    );
    if (!customerRow.rows.length) return;

    const fcmToken    = customerRow.rows[0].fcm_token;
    const customerName = customerRow.rows[0].name || 'Customer';

    // 2. Compose title + body based on status
    let title, body;
    switch (status) {
      case 'confirmed':
        title = '✅ Booking Confirmed!';
        body  = shopName
            ? `Your booking at ${shopName} has been confirmed.`
            : 'Your booking has been confirmed by the salon.';
        if (vendorNotes) body += ` Note: ${vendorNotes}`;
        break;
      case 'rejected':
        title = '❌ Booking Rejected';
        body  = shopName
            ? `Your booking at ${shopName} was not accepted.`
            : 'Your booking was rejected by the salon.';
        if (vendorNotes) body += ` Reason: ${vendorNotes}`;
        break;
      case 'completed':
        title = '🎉 Service Completed';
        body  = shopName
            ? `Thank you for visiting ${shopName}! We hope you enjoyed your service.`
            : 'Your service has been completed. Thank you!';
        break;
      default:
        title = 'Booking Update';
        body  = `Your booking #${bookingId} status is now ${status}.`;
    }

    // 3. Insert in-app notification for customer
    await db.query(
        `INSERT INTO notifications
         (user_id, title, message, notification_type, is_read, created_at)
       VALUES ($1, $2, $3, $4, false, NOW())
       ON CONFLICT DO NOTHING`,
        [customerId, title, body, `booking_${status}`]
    ).catch(dbErr =>
        console.warn('⚠️ Customer notification insert failed:', dbErr.message)
    );

    // 4. Send FCM push to customer device
    if (!fcmToken || !admin.apps.length) return;

    await admin.messaging().send({
      token: fcmToken,
      data: {
        type:       `BOOKING_${status.toUpperCase()}`,
        booking_id: String(bookingId),
        title,
        body,
      },
      android: {
        priority: 'high',
        notification: {
          title,
          body,
          channelId: 'general_notifications',
          sound:     'default',
          priority:  'high',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    console.log(`✅ Customer notification sent: booking #${bookingId} → ${status}`);
  } catch (err) {
    console.error('❌ _notifyCustomerBookingUpdate error:', err.message);
  }
};
const getServiceMasters = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        sm.service_id,
        sm.service_name,
        sm.service_description,
        sm.default_duration_minutes,
        sm.base_price,
        sm.category,
        sm.is_available,
        sm.image_url,
        sm.service_type
      FROM services_master sm
      WHERE sm.status = 'active'
        AND sm.is_available = true
      ORDER BY sm.category, sm.service_name
    `);

    res.json({
      success: true,
      message: 'Services fetched successfully.',
      data: {
        services: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Get service masters error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching services.',
      error: error.message
    });
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// BLOCK TIME  (vendor_early_closures for partial day, vendor_holidays for full day)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /vendor/block-time
 * Body: { date, start_time, end_time, block_full_day }
 *
 * Full day → inserts into vendor_holidays (holiday_date = date)
 * Partial  → inserts into vendor_early_closures (closure_date, early_close_time = end_time)
 *            The "start_time" is stored in reason as metadata since the table only
 *            has early_close_time.  A future migration can add a start_time column.
 *
 * Returns: { success, data: { block_id, conflicting_bookings } }
 */
const blockTime = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const vendorId = req.user.userId;
    const { date, start_time, end_time, block_full_day } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required.' });
    }

    // Validate date is within next 8 days
    const inputDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 7);

    if (inputDate < today || inputDate > maxDate) {
      return res.status(400).json({
        success: false,
        message: 'Date must be between today and the next 7 days.',
      });
    }

    if (!block_full_day && (!start_time || !end_time)) {
      return res.status(400).json({
        success: false,
        message: 'start_time and end_time are required when block_full_day is false.',
      });
    }

    await client.query('BEGIN');

    // ── STEP 1: Count conflicting bookings BEFORE inserting ──────────────
    let conflictingBookings = 0;

    if (block_full_day) {
      const conflictResult = await client.query(
          `SELECT COUNT(*) AS cnt
         FROM bookings
         WHERE vendor_id = $1
           AND booking_date = $2
           AND booking_status IN ('confirmed', 'pending')
           AND status = 'active'`,
          [vendorId, date]
      );
      conflictingBookings = parseInt(conflictResult.rows[0].cnt, 10);
    } else {
      const conflictResult = await client.query(
          `SELECT COUNT(*) AS cnt
         FROM bookings b
         WHERE b.vendor_id = $1
           AND b.booking_date = $2
           AND b.booking_status IN ('confirmed', 'pending')
           AND b.status = 'active'
           AND b.booking_time < $4::time
           AND (
             SELECT COALESCE(MAX(bs.end_time), b.booking_time)
             FROM booking_services bs
             WHERE bs.booking_id = b.booking_id AND bs.status = 'active'
           ) > $3::time`,
          [vendorId, date, start_time, end_time]
      );
      conflictingBookings = parseInt(conflictResult.rows[0].cnt, 10);
    }

    // ── STEP 2: Insert the block ─────────────────────────────────────────
    let blockId;
    let blockType;

    if (block_full_day) {
      const holidayResult = await client.query(
          `INSERT INTO vendor_holidays
           (vendor_id, holiday_date, holiday_reason, status, created_at)
         VALUES ($1, $2, 'Full day blocked', 'active', NOW())
         ON CONFLICT (vendor_id, holiday_date)
         DO UPDATE SET
           status = 'active',
           holiday_reason = 'Full day blocked',
           updated_at = NOW()
         RETURNING holiday_id`,
          [vendorId, date]
      );
      blockId   = holidayResult.rows[0].holiday_id;
      blockType = 'holiday';
    } else {
      const reason = `Block: ${start_time} - ${end_time}`;
      const closureResult = await client.query(
          `INSERT INTO vendor_early_closures
(vendor_id, closure_date, early_close_time, reason, status, created_at)
VALUES ($1, $2, $3, $4, 'active', NOW())
ON CONFLICT (vendor_id, closure_date)
DO UPDATE SET
  early_close_time = EXCLUDED.early_close_time,
  reason = EXCLUDED.reason,
  status = 'active',
  updated_at = NOW()
RETURNING closure_id;`,
          [vendorId, date, normalizeTime(end_time), reason]
      );
      blockId   = closureResult.rows[0].closure_id;
      blockType = 'closure';
    }

    // ── STEP 3: Auto-cancel conflicting bookings ─────────────────────────
    if (conflictingBookings > 0) {
      let fetchQuery;
      let fetchParams;

      if (block_full_day) {
        fetchQuery = `
          SELECT b.booking_id, b.user_id AS customer_id
          FROM bookings b
          WHERE b.vendor_id = $1
            AND b.booking_date = $2
            AND b.booking_status IN ('confirmed', 'pending')
            AND b.status = 'active'`;
        fetchParams = [vendorId, date];
      } else {
        fetchQuery = `
          SELECT b.booking_id, b.user_id AS customer_id
          FROM bookings b
          WHERE b.vendor_id = $1
            AND b.booking_date = $2
            AND b.booking_status IN ('confirmed', 'pending')
            AND b.status = 'active'
            AND b.booking_time < $4::time
            AND (
              SELECT COALESCE(MAX(bs.end_time), b.booking_time)
              FROM booking_services bs
              WHERE bs.booking_id = b.booking_id AND bs.status = 'active'
            ) > $3::time`;
        fetchParams = [vendorId, date, start_time, end_time];
      }

      const conflictRows = await client.query(fetchQuery, fetchParams);

      const shopRow = await db.query(
          `SELECT shop_name FROM vendor_shop_details WHERE user_id = $1`,
          [vendorId]
      );
      const shopName = shopRow.rows[0]?.shop_name;

      for (const row of conflictRows.rows) {
        await client.query(
            `UPDATE bookings
           SET booking_status      = 'cancelled',
               cancellation_reason = $1,
               cancelled_by        = 'vendor',
               payment_status      = CASE
                                       WHEN payment_status = 'paid' THEN 'refunded'
                                       ELSE payment_status
                                     END,
               updated_at          = NOW()
           WHERE booking_id = $2`,
            [
              block_full_day
                  ? 'Vendor marked this day as a holiday.'
                  : `Vendor blocked ${start_time}–${end_time} on this date.`,
              row.booking_id,
            ]
        );

        // Notify customer — fire-and-forget, don't block commit
        _notifyCustomerBookingUpdate({
          customerId:  row.customer_id,
          bookingId:   row.booking_id,
          status:      'rejected',
          vendorNotes: block_full_day
              ? `${shopName} has marked this day as a holiday.`
              : `${shopName} has blocked ${start_time}–${end_time}. Your booking has been cancelled.`,
          shopName,
        }).catch(err => console.error('⚠️ blockTime notify failed:', err.message));
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: block_full_day
          ? 'Full day blocked successfully.'
          : 'Time block saved successfully.',
      data: {
        block_id:              blockId,
        block_type:            blockType,
        date,
        start_time:            block_full_day ? '00:00' : start_time,
        end_time:              block_full_day ? '23:59' : end_time,
        block_full_day:        !!block_full_day,
        conflicting_bookings:  conflictingBookings,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('blockTime error:', err);
    res.status(500).json({
      success: false,
      message: 'Error blocking time.',
      error: cleanError(err),
    });
  } finally {
    client.release();
  }
};

/**
 * GET /vendor/block-time?date=YYYY-MM-DD
 * Returns all blocks (closures + holidays) for the vendor.
 */
const getBlockedTimes = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { date } = req.query;

    const today   = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 7);

    // Partial-day blocks
    const closures = await db.query(
        `SELECT
         closure_id AS block_id,
         'closure'  AS block_type,
         closure_date   AS date,
         early_close_time AS end_time,
         reason,
         created_at
       FROM vendor_early_closures
       WHERE vendor_id = $1
         AND status = 'active'
         AND closure_date >= $2
         AND closure_date <= $3
         ${date ? 'AND closure_date = $4' : ''}
       ORDER BY closure_date ASC, early_close_time ASC`,
        date ? [vendorId, today, maxDate, date] : [vendorId, today, maxDate]
    );

    // Full-day blocks
    const holidays = await db.query(
        `SELECT
         holiday_id  AS block_id,
         'holiday'   AS block_type,
         holiday_date AS date,
         holiday_reason AS reason,
         created_at
       FROM vendor_holidays
       WHERE vendor_id = $1
         AND status = 'active'
         AND holiday_date >= $2
         AND holiday_date <= $3
         ${date ? 'AND holiday_date = $4' : ''}
       ORDER BY holiday_date ASC`,
        date ? [vendorId, today, maxDate, date] : [vendorId, today, maxDate]
    );

    const blocks = [
      ...closures.rows.map(r => ({ ...r, block_full_day: false })),
      ...holidays.rows.map(r => ({ ...r, block_full_day: true })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ success: true, message: 'Blocked times retrieved.', data: blocks });
  } catch (err) {
    console.error('getBlockedTimes error:', err);
    res.status(500).json({ success: false, message: 'Error fetching blocked times.', error: cleanError(err) });
  }
};

/**
 * DELETE /vendor/block-time/:blockId?type=closure|holiday
 */
const deleteBlockedTime = async (req, res) => {
  try {
    const vendorId = req.user.userId;
    const { blockId } = req.params;
    const { type } = req.query; // 'closure' | 'holiday'

    if (!type || !['closure', 'holiday'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Query param type must be "closure" or "holiday".' });
    }

    let result;
    if (type === 'closure') {
      result = await db.query(
          `UPDATE vendor_early_closures
         SET status = 'inactive', deleted_at = NOW()
         WHERE closure_id = $1 AND vendor_id = $2 AND status = 'active'`,
          [blockId, vendorId]
      );
    } else {
      result = await db.query(
          `UPDATE vendor_holidays
         SET status = 'inactive', deleted_at = NOW()
         WHERE holiday_id = $1 AND vendor_id = $2 AND status = 'active'`,
          [blockId, vendorId]
      );
    }

    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: 'Block not found.' });
    }

    res.json({ success: true, message: 'Block removed successfully.' });
  } catch (err) {
    console.error('deleteBlockedTime error:', err);
    res.status(500).json({ success: false, message: 'Error removing block.', error: cleanError(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AVAILABLE SLOTS  (customer-facing, but vendor also uses it for offline booking)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /customer/shops/:shopId/available-slots?date=YYYY-MM-DD
 *
 * Generates 30-minute slots between open_time and close_time,
 * marks each slot with:
 *   is_available   → true if at least 1 seat is free
 *   available_seats → number of free seats
 *   is_break       → true if slot falls inside break window
 *   reason         → 'booked' | 'blocked' | 'holiday' | 'break' | null
 */
const getAvailableSlots = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { date }   = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date query param is required.' });
    }

    // 1. Get shop details
    const shopRow = await db.query(
        `SELECT
         shop_id, user_id AS vendor_id,
         open_time, close_time,
         break_start_time, break_end_time,
         weekly_holiday, no_of_seats,
         verification_status
       FROM vendor_shop_details
       WHERE shop_id = $1 AND status = 'active'`,
        [shopId]
    );

    if (!shopRow.rows.length) {
      return res.status(404).json({ success: false, message: 'Shop not found.' });
    }

    const shop = shopRow.rows[0];

    // 2. Check if verified
    if (shop.verification_status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Shop is not yet approved.' });
    }

    // 3. Check weekly holiday
    const inputDate  = new Date(`${date}T00:00:00`);
    const dayNames   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayName    = dayNames[inputDate.getDay()];

    if (shop.weekly_holiday && shop.weekly_holiday.toLowerCase() === dayName.toLowerCase()) {
      return res.json({
        success: true,
        message: 'Shop is closed on this day.',
        data: {
          is_closed: true,
          date,
          open_time:  shop.open_time,
          close_time: shop.close_time,
          available_slots: [],
        },
      });
    }

    // 4. Check full-day holiday
    const holidayRow = await db.query(
        `SELECT holiday_id FROM vendor_holidays
       WHERE vendor_id = $1 AND holiday_date = $2 AND status = 'active'`,
        [shop.vendor_id, date]
    );

    if (holidayRow.rows.length) {
      return res.json({
        success: true,
        message: 'Shop is closed on this date.',
        data: {
          is_closed: true,
          date,
          open_time:  shop.open_time,
          close_time: shop.close_time,
          available_slots: [],
        },
      });
    }

    // 5. Get partial-day blocks for this date
    const closures = await db.query(
        `SELECT early_close_time, reason
       FROM vendor_early_closures
       WHERE vendor_id = $1 AND closure_date = $2 AND status = 'active'`,
        [shop.vendor_id, date]
    );

    // Parse block ranges from reason field ("Block: HH:MM - HH:MM")
    const blockedRanges = closures.rows.map(r => {
      const match = (r.reason || '').match(/Block:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (match) return { start: match[1], end: match[2] };
      return null;
    }).filter(Boolean);

    // 6. Get booked slots for this date
    const bookedSlots = await db.query(
        `SELECT b.booking_time, b.booking_id,
              COALESCE(MAX(bs.end_time)::text, b.booking_time::text) AS booking_end_time
       FROM bookings b
       LEFT JOIN booking_services bs
              ON b.booking_id = bs.booking_id AND bs.status = 'active'
       WHERE b.vendor_id = $1
         AND b.booking_date = $2
         AND b.booking_status IN ('confirmed', 'pending')
         AND b.status = 'active'
       GROUP BY b.booking_id, b.booking_time`,
        [shop.vendor_id, date]
    );

    // 7. Build slot list (30-minute intervals)
    const toMinutes = (timeStr) => {
      const [h, m] = String(timeStr).split(':').map(Number);
      return h * 60 + m;
    };

    const openMin  = toMinutes(shop.open_time);
    const closeMin = toMinutes(shop.close_time);
    const breakStartMin = shop.break_start_time ? toMinutes(shop.break_start_time) : null;
    const breakEndMin   = shop.break_end_time   ? toMinutes(shop.break_end_time)   : null;

    const slots = [];
    const noOfSeats = shop.no_of_seats || 1;

    for (let m = openMin; m < closeMin; m += 30) {
      const hh   = String(Math.floor(m / 60)).padStart(2, '0');
      const mm   = String(m % 60).padStart(2, '0');
      const slotTime  = `${hh}:${mm}`;
      const slotEndMin = m + 30;

      // Break window check
      const isBreak = breakStartMin !== null
          && m >= breakStartMin
          && m < breakEndMin;

      // Blocked range check
      const isBlocked = blockedRanges.some(range => {
        const blockStart = toMinutes(range.start);
        const blockEnd   = toMinutes(range.end);
        return m >= blockStart && m < blockEnd;
      });

      // Count how many confirmed bookings overlap this 30-min slot
      const overlapping = bookedSlots.rows.filter(b => {
        const bStart = toMinutes(b.booking_time);
        const bEnd   = toMinutes(b.booking_end_time);
        return bStart < slotEndMin && bEnd > m;
      });

      const seatsUsed      = overlapping.length;
      const availableSeats = noOfSeats - seatsUsed;
      const isAvailable    = !isBreak && !isBlocked && availableSeats > 0;

      let reason = null;
      if (isBreak)        reason = 'break';
      else if (isBlocked) reason = 'blocked';
      else if (availableSeats <= 0) reason = 'booked';

      slots.push({
        time:            slotTime,
        is_available:    isAvailable,
        is_break:        isBreak,
        available_seats: Math.max(0, availableSeats),
        reason,
      });
    }

    res.json({
      success: true,
      message: 'Available slots loaded.',
      data: {
        is_closed:       false,
        date,
        open_time:       shop.open_time,
        close_time:      shop.close_time,
        break_start_time: shop.break_start_time || null,
        break_end_time:   shop.break_end_time   || null,
        available_slots:  slots,
      },
    });
  } catch (err) {
    console.error('getAvailableSlots error:', err);
    res.status(500).json({ success: false, message: 'Error fetching available slots.', error: cleanError(err) });
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
  addCustomService,
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
  uploadVendorDocument,
  getVendorDocuments,
  // Reviews
  getVendorReviews,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  updateFCMToken,
  _notifyCustomerBookingUpdate,
  getServiceMasters,
  // Block Time
  blockTime,
  getBlockedTimes,
  deleteBlockedTime,
  getAvailableSlots,
};
