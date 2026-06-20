const db = require('../config/database');

// ============================================
// SHOP MANAGEMENT
// ============================================

// Get all shops with filters
const getAllShops = async (req, res) => {
  try {
    const { status, city, search, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT vs.*, 
             u.phone_number, u.email, u.status as user_status,
             up.name as owner_name,
             vm.total_bookings, vm.average_rating, vm.total_reviews
      FROM vendor_shop_details vs
      LEFT JOIN users u ON vs.user_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
      LEFT JOIN vendor_metrics vm ON u.user_id = vm.vendor_id
      WHERE vs.deleted_at IS NULL
    `;
    
    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND vs.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (city) {
      query += ` AND vs.city = $${paramCount}`;
      params.push(city);
      paramCount++;
    }

    if (search) {
      query += ` AND (vs.shop_name ILIKE $${paramCount} OR up.name ILIKE $${paramCount} OR u.phone_number ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${query}) as total_count`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    query += ` ORDER BY vs.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
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

// Get shop by ID
const getShopById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT vs.*, 
              u.phone_number, u.email, u.status as user_status,
              up.name as owner_name, up.city as owner_city, up.state as owner_state,
              vm.total_bookings, vm.completed_bookings, vm.average_rating, vm.total_reviews, vm.total_revenue
       FROM vendor_shop_details vs
       LEFT JOIN users u ON vs.user_id = u.user_id
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       LEFT JOIN vendor_metrics vm ON u.user_id = vm.vendor_id
       WHERE vs.shop_id = $1 AND vs.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found.'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching shop.',
      error: error.message
    });
  }
};

// Create new shop
const createShop = async (req, res) => {
  const client = await db.pool.connect();
  
  try {
    const {
      user_id, shop_name, shop_address, city, state,
      latitude, longitude, open_time, close_time,
      break_start_time, break_end_time, weekly_holiday,
      no_of_seats, no_of_workers, business_license,
      tax_number, bank_account_number, bank_ifsc_code
    } = req.body;

    // Validation
    if (!user_id || !shop_name || !shop_address || !city || !state || !open_time || !close_time) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: user_id, shop_name, shop_address, city, state, open_time, close_time'
      });
    }

    await client.query('BEGIN');

    // Check if user exists and is VENDOR
    const userCheck = await client.query(
      'SELECT user_type FROM users WHERE user_id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    if (userCheck.rows[0].user_type !== 'VENDOR') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'User must be a VENDOR to create a shop.'
      });
    }

    // Check if shop already exists for this user
    const existingShop = await client.query(
      'SELECT shop_id FROM vendor_shop_details WHERE user_id = $1 AND deleted_at IS NULL',
      [user_id]
    );

    if (existingShop.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Shop already exists for this vendor.'
      });
    }

    // Insert shop
    const result = await client.query(
      `INSERT INTO vendor_shop_details (
        user_id, shop_name, shop_address, city, state,
        latitude, longitude, open_time, close_time,
        break_start_time, break_end_time, weekly_holiday,
        no_of_seats, no_of_workers, business_license,
        tax_number, bank_account_number, bank_ifsc_code,
        status, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pending', 'active')
      RETURNING shop_id`,
      [
        user_id, shop_name, shop_address, city, state,
        latitude, longitude, open_time, close_time,
        break_start_time, break_end_time, weekly_holiday,
        no_of_seats || 1, no_of_workers || 1, business_license,
        tax_number, bank_account_number, bank_ifsc_code
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Shop created successfully.',
      data: {
        shop_id: result.rows[0].shop_id
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating shop.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Update shop
const updateShop = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      shop_name, shop_address, city, state,
      latitude, longitude, open_time, close_time,
      break_start_time, break_end_time, weekly_holiday,
      no_of_seats, no_of_workers, business_license,
      tax_number, bank_account_number, bank_ifsc_code
    } = req.body;

    // Check if shop exists
    const shopCheck = await db.query(
      'SELECT shop_id FROM vendor_shop_details WHERE shop_id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (shopCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found.'
      });
    }

    // Update shop
    await db.query(
      `UPDATE vendor_shop_details SET
        shop_name = COALESCE($1, shop_name),
        shop_address = COALESCE($2, shop_address),
        city = COALESCE($3, city),
        state = COALESCE($4, state),
        latitude = COALESCE($5, latitude),
        longitude = COALESCE($6, longitude),
        open_time = COALESCE($7, open_time),
        close_time = COALESCE($8, close_time),
        break_start_time = COALESCE($9, break_start_time),
        break_end_time = COALESCE($10, break_end_time),
        weekly_holiday = COALESCE($11, weekly_holiday),
        no_of_seats = COALESCE($12, no_of_seats),
        no_of_workers = COALESCE($13, no_of_workers),
        business_license = COALESCE($14, business_license),
        tax_number = COALESCE($15, tax_number),
        bank_account_number = COALESCE($16, bank_account_number),
        bank_ifsc_code = COALESCE($17, bank_ifsc_code),
        updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = $18`,
      [
        shop_name, shop_address, city, state,
        latitude, longitude, open_time, close_time,
        break_start_time, break_end_time, weekly_holiday,
        no_of_seats, no_of_workers, business_license,
        tax_number, bank_account_number, bank_ifsc_code,
        id
      ]
    );

    res.json({
      success: true,
      message: 'Shop updated successfully.'
    });

  } catch (error) {
    console.error('Update shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating shop.',
      error: error.message
    });
  }
};

// Delete shop (soft delete)
const deleteShop = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if shop exists
    const shopCheck = await db.query(
      'SELECT shop_id FROM vendor_shop_details WHERE shop_id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (shopCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found.'
      });
    }

    // Soft delete
    await db.query(
      'UPDATE vendor_shop_details SET deleted_at = CURRENT_TIMESTAMP WHERE shop_id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Shop deleted successfully.'
    });

  } catch (error) {
    console.error('Delete shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting shop.',
      error: error.message
    });
  }
};

// Update shop verification status
const updateShopVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_comments } = req.body;
    const verifiedBy = req.user.userId;

    console.log('Updating shop verification:', { id, status, admin_comments, verifiedBy });

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification status. Must be pending, approved, or rejected.'
      });
    }

    // Check if shop exists
    const shopCheck = await db.query(
      'SELECT shop_id, user_id FROM vendor_shop_details WHERE shop_id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (shopCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found.'
      });
    }

    // Update verification
    const result = await db.query(
      `UPDATE vendor_shop_details 
       SET status = $1, 
           admin_comments = $2, 
           verified_by = $3, 
           verification_status = $1,
           verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE shop_id = $4
       RETURNING *`,
      [status, admin_comments, verifiedBy, id]
    );

    console.log('Shop verification updated:', result.rows[0]);

    res.json({
      success: true,
      message: `Shop ${status} successfully.`,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update shop verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating shop verification.',
      error: error.message
    });
  }
};

module.exports = {
  getAllShops,
  getShopById,
  createShop,
  updateShop,
  deleteShop,
  updateShopVerification
};