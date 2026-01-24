const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const admin = require('../config/firebase');

// ============================================
// GENERATE JWT TOKEN
// ============================================
const generateToken = (userId, userType) => {
  return jwt.sign(
      { userId, userType },
      process.env.JWT_SECRET || '4uBCAsrlj0PS/960LL1vvSvJx0XrJputuuKvGUQCcQRtwCqtt8rYDRl3T0Fa19ruYghYFftKYD81WUfJ6MUxfg==',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// ============================================
// OTP BASED AUTHENTICATION
// ============================================

// Send OTP
const sendOTP = async (req, res) => {
  try {
    const { phone_number } = req.body;

    // Validation
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required.'
      });
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\+[1-9]\d{1,14}$/; // E.164 format
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use E.164 format (e.g., +919876543210)'
      });
    }

    // Check if user exists
    const existingUser = await db.query(
        'SELECT user_id, user_type, status FROM users WHERE phone_number = $1',
        [phone_number]
    );

    let userExists = false;
    let userType = null;
    let userStatus = null;

    if (existingUser.rows.length > 0) {
      userExists = true;
      userType = existingUser.rows[0].user_type;
      userStatus = existingUser.rows[0].status;
    }

    // Note: Firebase handles OTP sending on client side
    // This endpoint just validates and returns user existence info
    res.json({
      success: true,
      message: 'OTP will be sent via Firebase on client side.',
      data: {
        phone_number,
        user_exists: userExists,
        user_type: userType,
        user_status: userStatus,
        note: 'Complete OTP verification on client and call /verify-otp endpoint'
      }
    });

  } catch (error) {
    console.error('❌ Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing OTP request.',
      error: error.message
    });
  }
};

// Verify OTP and Register/Login
const verifyOTP = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const {
      firebase_token,
      phone_number,
      name,
      email,
      user_type,
      city,
      state,
      gender
    } = req.body;

    console.log('🔐 Verify OTP request received:', {
      has_firebase_token: !!firebase_token,
      phone_number,
      user_type,
      has_name: !!name
    });

    // Validation
    if (!firebase_token || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Firebase token and phone number are required.'
      });
    }

    // ============================================
    // VERIFY FIREBASE TOKEN
    // ============================================
    let verifiedPhoneNumber;
    let firebaseUid;

    // Check if it's a bypass token (for development/testing)
    const isBypassToken = firebase_token.startsWith('BYPASS_TOKEN_') ||
        firebase_token.startsWith('dummy_firebase_token_');

    if (isBypassToken) {
      // ============================================
      // DEVELOPMENT/BYPASS MODE
      // ============================================
      console.log('🔥 Development mode: Bypassing Firebase verification');
      verifiedPhoneNumber = phone_number;
      firebaseUid = `bypass_${Date.now()}`;
    } else {
      // ============================================
      // PRODUCTION MODE - VERIFY WITH FIREBASE
      // ============================================
      try {
        if (!admin.apps.length) {
          throw new Error('Firebase Admin SDK not initialized. Please add serviceAccountKey.json');
        }

        console.log('🔍 Verifying Firebase token...');
        const decodedToken = await admin.auth().verifyIdToken(firebase_token);

        verifiedPhoneNumber = decodedToken.phone_number;
        firebaseUid = decodedToken.uid;

        console.log('✅ Firebase token verified successfully');
        console.log('   Phone from token:', verifiedPhoneNumber);
        console.log('   Firebase UID:', firebaseUid);

        // Verify phone number matches
        if (verifiedPhoneNumber !== phone_number) {
          return res.status(401).json({
            success: false,
            message: 'Phone number mismatch with Firebase token.'
          });
        }
      } catch (firebaseError) {
        console.error('❌ Firebase verification failed:', firebaseError.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired Firebase token.',
          error: firebaseError.message
        });
      }
    }

    await client.query('BEGIN');

    // Check if user exists
    const existingUser = await client.query(
        `SELECT u.user_id, u.user_type, u.status, u.phone_verified, u.email, u.created_at,
              up.name, up.city, up.state, up.gender, up.profile_picture
       FROM users u
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       WHERE u.phone_number = $1`,
        [phone_number]
    );

    let userId, finalUserType, token, responseData;

    if (existingUser.rows.length > 0) {
      // ============================================
      // EXISTING USER - LOGIN
      // ============================================
      console.log('👤 Existing user - logging in');
      const user = existingUser.rows[0];
      userId = user.user_id;
      finalUserType = user.user_type;

      // Check if user is active
      if (user.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(401).json({
          success: false,
          message: 'Account is inactive. Please contact support.'
        });
      }

      // Mark phone as verified if not already
      if (!user.phone_verified) {
        await client.query(
            'UPDATE users SET phone_verified = true WHERE user_id = $1',
            [userId]
        );
      }

      // Update last login
      await client.query(
          `UPDATE user_profiles 
         SET last_login_at = CURRENT_TIMESTAMP 
         WHERE user_id = $1 AND is_current = true`,
          [userId]
      );

      // Get complete user data
      const completeUserData = await client.query(
          `SELECT u.user_id, u.phone_number, u.email, u.user_type as role, u.status, 
                u.phone_verified, u.created_at,
                up.name, up.city, up.state, up.gender, up.profile_picture
         FROM users u
         LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
         WHERE u.user_id = $1`,
          [userId]
      );

      const userData = completeUserData.rows[0];

      await client.query('COMMIT');

      // Generate token
      token = generateToken(userId, finalUserType);

      console.log('✅ Login successful for user:', userId);

      // Response format for Flutter app
      responseData = {
        user: {
          user_id: userId,
          phone_number: userData.phone_number,
          email: userData.email,
          name: userData.name,
          city: userData.city,
          state: userData.state,
          gender: userData.gender,
          profile_picture: userData.profile_picture,
          role: finalUserType,
          created_at: userData.created_at
        },
        token
      };

      res.json({
        success: true,
        message: 'Login successful.',
        data: responseData
      });

    } else {
      // ============================================
      // NEW USER - REGISTRATION
      // ============================================
      console.log('✨ New user - registering');

      // Validation for new user
      if (!name || !user_type) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Name and user type are required for new user registration.'
        });
      }

      // Validate user_type
      const validUserTypes = ['CUSTOMER', 'VENDOR', 'ADMIN', 'SUPERADMIN'];
      finalUserType = validUserTypes.includes(user_type) ? user_type : 'CUSTOMER';

      // Check email uniqueness if provided
      if (email) {
        const emailCheck = await client.query(
            'SELECT user_id FROM users WHERE email = $1',
            [email]
        );

        if (emailCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Email already registered with another account.'
          });
        }
      }

      // Insert new user
      const userResult = await client.query(
          `INSERT INTO users (phone_number, email, user_type, status, phone_verified, created_at) 
         VALUES ($1, $2, $3, 'active', true, CURRENT_TIMESTAMP) 
         RETURNING user_id, user_type, created_at`,
          [phone_number, email, finalUserType]
      );

      userId = userResult.rows[0].user_id;
      const createdAt = userResult.rows[0].created_at;

      // Insert user profile
      await client.query(
          `INSERT INTO user_profiles (user_id, name, city, state, gender, is_current, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, name, city, state, gender]
      );

      await client.query('COMMIT');

      // Generate token
      token = generateToken(userId, finalUserType);

      console.log('✅ User registered successfully:', userId);

      // Response format for Flutter app
      responseData = {
        user: {
          user_id: userId,
          phone_number,
          email,
          name,
          city,
          state,
          gender,
          profile_picture: null,
          role: finalUserType,
          created_at: createdAt
        },
        token
      };

      res.status(201).json({
        success: true,
        message: 'User registered successfully.',
        data: responseData
      });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Register User (Password-based - Legacy)
const register = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { phone_number, email, password, name, user_type, city, state, gender } = req.body;

    // Validation
    if (!phone_number || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, password, and name are required.'
      });
    }

    // Validate user_type - should match DB enum values
    const validUserTypes = ['CUSTOMER', 'VENDOR', 'ADMIN', 'SUPERADMIN'];
    const finalUserType = validUserTypes.includes(user_type) ? user_type : 'CUSTOMER';

    await client.query('BEGIN');

    // Check if user already exists
    const existingUser = await client.query(
        'SELECT user_id FROM users WHERE phone_number = $1 OR email = $2',
        [phone_number, email]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'User with this phone number or email already exists.'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user
    const userResult = await client.query(
        `INSERT INTO users (phone_number, email, password_hash, user_type, status, created_at) 
       VALUES ($1, $2, $3, $4, 'active', CURRENT_TIMESTAMP) 
       RETURNING user_id, user_type`,
        [phone_number, email, password_hash, finalUserType]
    );

    const userId = userResult.rows[0].user_id;

    // Insert user profile
    await client.query(
        `INSERT INTO user_profiles (user_id, name, city, state, gender, is_current, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, name, city, state, gender]
    );

    await client.query('COMMIT');

    // Generate token
    const token = generateToken(userId, finalUserType);

    res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        user_id: userId,
        user_type: finalUserType,
        token
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering user.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Login User (Password-based - Legacy)
const login = async (req, res) => {
  try {
    const { phone_number, password } = req.body;

    // Validation
    if (!phone_number || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and password are required.'
      });
    }

    // Get user
    const result = await db.query(
        'SELECT user_id, password_hash, user_type, status FROM users WHERE phone_number = $1',
        [phone_number]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
      });
    }

    // Update last login
    await db.query(
        `UPDATE user_profiles 
       SET last_login_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND is_current = true`,
        [user.user_id]
    );

    // Generate token
    const token = generateToken(user.user_id, user.user_type);

    // Get user profile
    const profileResult = await db.query(
        'SELECT name, city, state, profile_picture FROM user_profiles WHERE user_id = $1 AND is_current = true',
        [user.user_id]
    );

    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        user_id: user.user_id,
        user_type: user.user_type,
        profile: profileResult.rows[0] || {},
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in.',
      error: error.message
    });
  }
};

// Get Current User Profile
const getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
        `SELECT u.user_id, u.phone_number, u.email, u.user_type as role, u.status, 
              u.phone_verified, u.created_at,
              up.name, up.city, up.state, up.gender, up.profile_picture, up.last_login_at
       FROM users u
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       WHERE u.user_id = $1`,
        [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    res.json({
      success: true,
      message: "Profile fetched",
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile.',
      error: error.message
    });
  }
};

// Update User Profile
const updateProfile = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const userId = req.user.userId;
    const { name, city, state, gender, profile_picture } = req.body;

    await client.query('BEGIN');

    // Mark current profile as not current
    await client.query(
        'UPDATE user_profiles SET is_current = false WHERE user_id = $1 AND is_current = true',
        [userId]
    );

    // Insert new profile version
    await client.query(
        `INSERT INTO user_profiles (user_id, name, city, state, gender, profile_picture, is_current, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, name, city, state, gender, profile_picture]
    );

    // Get updated user data
    const updatedUser = await client.query(
        `SELECT u.user_id, u.phone_number, u.email, u.user_type as role, u.status, 
              u.phone_verified, u.created_at,
              up.name, up.city, up.state, up.gender, up.profile_picture
       FROM users u
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       WHERE u.user_id = $1`,
        [userId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      data: updatedUser.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile.',
      error: error.message
    });
  } finally {
    client.release();
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  sendOTP,
  verifyOTP
};