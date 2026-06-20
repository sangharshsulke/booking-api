const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const admin = require('../config/firebase');

const JWT_SECRET = process.env.JWT_SECRET || '4uBCAsrlj0PS/960LL1vvSvJx0XrJputuuKvGUQCcQRtwCqtt8rYDRl3T0Fa19ruYghYFftKYD81WUfJ6MUxfg==';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '70d';

// ============================================
// GENERATE JWT TOKEN
// B15: device_id is embedded in the token so the auth
// middleware can compare it against the stored value on
// every request — mismatch = 401 SESSION_EXPIRED.
// ============================================
const generateToken = (userId, userType, deviceId) => {
  return jwt.sign(
      { userId, userType, deviceId: deviceId || null },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRE }
  );
};

// ============================================
// HELPER: send force-logout FCM push to old device
// ============================================
const sendForceLogoutPush = async (oldFcmToken) => {
  if (!oldFcmToken) return;
  try {
    await admin.messaging().send({
      token: oldFcmToken,
      data: {
        type: 'FORCE_LOGOUT',
        message: 'Your account was signed in on another device.',
      },
      android: { priority: 'high' },
      apns: { payload: { aps: { contentAvailable: true } } },
    });
    console.log('📲 Force-logout FCM push sent to old device');
  } catch (err) {
    // Non-fatal — old device may have uninstalled the app
    console.warn('⚠️ Could not send force-logout push:', err.message);
  }
};

// ============================================
// SEND OTP
// ============================================
const sendOTP = async (req, res) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use E.164 format (e.g., +919876543210)',
      });
    }

    const stripped_p = phone_number.replace(/^\+91/, '');
    const e164_p = '+91' + stripped_p;
    const existingUser = await db.query(
        'SELECT user_id, user_type, status FROM users WHERE phone_number = $1 OR phone_number = $2',
        [phone_number, stripped_p === phone_number ? e164_p : stripped_p]
    );

    let userExists = false, userType = null, userStatus = null;
    if (existingUser.rows.length > 0) {
      userExists = true;
      userType = existingUser.rows[0].user_type;
      userStatus = existingUser.rows[0].status;
    }

    res.json({
      success: true,
      message: 'OTP will be sent via Firebase on client side.',
      data: { phone_number, user_exists: userExists, user_type: userType, user_status: userStatus },
    });
  } catch (error) {
    console.error('❌ Send OTP error:', error);
    res.status(500).json({ success: false, message: 'Error processing OTP request.', error: error.message });
  }
};

// ============================================
// VERIFY OTP  (Login + Register)
// B15 changes:
//   1. Accept device_id from request body
//   2. On login: if device_id differs from stored one → send force-logout
//      FCM push to the OLD device, then overwrite with new device_id
//   3. Store device_id in user_profiles
//   4. Embed device_id in JWT
// ============================================
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
      gender,
      device_id,  // B15
    } = req.body;

    console.log('🔐 Verify OTP request:', {
      has_firebase_token: !!firebase_token,
      phone_number,
      user_type,
      has_name: !!name,
      device_id: device_id || '(none)',
    });

    if (!firebase_token || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Firebase token and phone number are required.',
      });
    }

    // ── Firebase verification ──────────────────────────────────────────
    let verifiedPhoneNumber, firebaseUid;
    const isBypassToken =
        firebase_token.startsWith('BYPASS_TOKEN_') ||
        firebase_token.startsWith('dummy_firebase_token_');

    if (isBypassToken) {
      console.log('🔥 Bypass mode: skipping Firebase verification');
      verifiedPhoneNumber = phone_number;
      firebaseUid = `bypass_${Date.now()}`;
    } else {
      try {
        if (!admin.apps.length) throw new Error('Firebase Admin SDK not initialized');
        const decodedToken = await admin.auth().verifyIdToken(firebase_token);
        verifiedPhoneNumber = decodedToken.phone_number;
        firebaseUid = decodedToken.uid;
        if (verifiedPhoneNumber !== phone_number) {
          return res.status(401).json({ success: false, message: 'Phone number mismatch with Firebase token.' });
        }
      } catch (firebaseError) {
        console.error('❌ Firebase verification failed:', firebaseError.message);
        return res.status(401).json({ success: false, message: 'Invalid or expired Firebase token.', error: firebaseError.message });
      }
    }

    await client.query('BEGIN');

    const existingUser = await client.query(
        `SELECT u.user_id, u.user_type, u.status, u.phone_verified,
              up.name, up.city, up.state, up.gender, up.profile_picture,
              up.fcm_token, up.device_id as stored_device_id
       FROM users u
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       WHERE u.phone_number = $1`,
        [phone_number]
    );

    let userId, finalUserType, token, responseData;

    if (existingUser.rows.length > 0) {
      // ── EXISTING USER: LOGIN ─────────────────────────────────────────
      console.log('👤 Existing user — logging in');
      const user = existingUser.rows[0];
      userId = user.user_id;
      finalUserType = user.user_type;

      if (user.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(401).json({ success: false, message: 'Account is inactive. Please contact support.' });
      }

      if (!user.phone_verified) {
        await client.query('UPDATE users SET phone_verified = true WHERE user_id = $1', [userId]);
      }

      // B15: If a different device_id is logging in, force-logout the old device
      const storedDeviceId = user.stored_device_id;
      if (device_id && storedDeviceId && storedDeviceId !== device_id) {
        console.log(`⚠️ B15: New device login detected (old: ${storedDeviceId}, new: ${device_id})`);
        // Fire-and-forget FCM push to old device — do NOT await so login isn't blocked
        sendForceLogoutPush(user.fcm_token);
      }

      // B15: Update device_id and last_login_at in user_profiles
      await client.query(
          `UPDATE user_profiles
         SET last_login_at = CURRENT_TIMESTAMP,
             device_id     = $1
         WHERE user_id = $2 AND is_current = true`,
          [device_id || storedDeviceId, userId]
      );

      const completedUser = await client.query(
          `SELECT u.user_id, u.phone_number, u.email, u.user_type as role, u.status,
                u.phone_verified, u.created_at,
                up.name, up.city, up.state, up.gender, up.profile_picture
         FROM users u
         LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
         WHERE u.user_id = $1`,
          [userId]
      );

      await client.query('COMMIT');

      // B15: embed device_id in JWT
      token = generateToken(userId, finalUserType, device_id);

      const userData = completedUser.rows[0];
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
          created_at: userData.created_at,
        },
        token,
      };

      return res.json({ success: true, message: 'Login successful.', data: responseData });

    } else {
      // ── NEW USER: REGISTRATION ───────────────────────────────────────
      console.log('✨ New user — registering');

      if (!name || !user_type) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Name and user type are required for new user registration.',
        });
      }

      const validUserTypes = ['CUSTOMER', 'VENDOR', 'ADMIN', 'SUPERADMIN'];
      finalUserType = validUserTypes.includes(user_type) ? user_type : 'CUSTOMER';

      if (email) {
        const emailCheck = await client.query('SELECT user_id FROM users WHERE email = $1', [email]);
        if (emailCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'Email already registered with another account.' });
        }
      }

      const userResult = await client.query(
          `INSERT INTO users (phone_number, email, user_type, status, phone_verified, created_at)
         VALUES ($1, $2, $3, 'active', true, CURRENT_TIMESTAMP)
         RETURNING user_id, user_type, created_at`,
          [phone_number, email, finalUserType]
      );

      userId = userResult.rows[0].user_id;
      const createdAt = userResult.rows[0].created_at;

      // B15: store device_id from first registration
      await client.query(
          `INSERT INTO user_profiles
           (user_id, name, city, state, gender, device_id, is_current, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, name, city, state, gender, device_id || null]
      );

      await client.query('COMMIT');

      // B15: embed device_id in JWT
      token = generateToken(userId, finalUserType, device_id);

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
          created_at: createdAt,
        },
        token,
      };

      return res.status(201).json({ success: true, message: 'User registered successfully.', data: responseData });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Error verifying OTP.', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// LOGOUT  (B15: clears device_id from user_profiles)
// ============================================
const logout = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Clear device_id so the old token can no longer pass device checks
    await db.query(
        `UPDATE user_profiles
       SET device_id = NULL, fcm_token = NULL
       WHERE user_id = $1 AND is_current = true`,
        [userId]
    );

    console.log(`✅ Logout: cleared device_id for user ${userId}`);
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({ success: false, message: 'Error logging out.', error: error.message });
  }
};

// ============================================
// GET PROFILE
// ============================================
const getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
        `SELECT u.user_id, u.phone_number, u.email, u.user_type as role, u.status,
              u.phone_verified, u.created_at,
              up.name, up.city, up.state, up.gender, up.profile_picture, up.last_login_at,
              vsd.shop_id
       FROM users u
       LEFT JOIN user_profiles up ON u.user_id = up.user_id AND up.is_current = true
       LEFT JOIN vendor_shop_details vsd ON u.user_id = vsd.user_id
       WHERE u.user_id = $1`,
        [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, message: 'Profile fetched', data: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile.', error: error.message });
  }
};

// ============================================
// UPDATE PROFILE
// ============================================
const updateProfile = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const userId = req.user.userId;
    const { name, email, city, state, gender, profile_picture } = req.body;

    // ── Server-side email validation ─────────────────────────────────
    if (email !== undefined && email !== null && String(email).trim() !== '') {
      const emailRegex = /^[\w\-.]+@([\w-]+\.)+[\w-]{2,}$/;
      if (!emailRegex.test(String(email).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email address format.',
        });
      }
    }

    await client.query('BEGIN');

    // ── Update email on users table (source of truth) ────────────────
    if (email !== undefined && email !== null && String(email).trim() !== '') {
      await client.query(
          `UPDATE users SET email = $1, updated_at = NOW() WHERE user_id = $2`,
          [String(email).trim().toLowerCase(), userId]
      );
    }

    // ── Soft-rotate user_profiles row ────────────────────────────────
    await client.query(
        `UPDATE user_profiles SET is_current = false WHERE user_id = $1 AND is_current = true`,
        [userId]
    );

    // ── INSERT new current profile row (fixed: comma before true, all params passed) ──
    await client.query(
        `INSERT INTO user_profiles
         (user_id, name, city, state, gender, profile_picture, is_current, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, name ?? null, city ?? null, state ?? null, gender ?? null, profile_picture ?? null]
    );

    // ── Fetch updated user (email now comes from users table) ─────────
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
      data: updatedUser.rows[0],
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile.',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// ============================================
// LEGACY PASSWORD-BASED (unchanged)
// ============================================
const register = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { phone_number, email, password, name, user_type, city, state, gender } = req.body;
    if (!phone_number || !password || !name) {
      return res.status(400).json({ success: false, message: 'Phone number, password, and name are required.' });
    }
    const validUserTypes = ['CUSTOMER', 'VENDOR', 'ADMIN', 'SUPERADMIN'];
    const finalUserType = validUserTypes.includes(user_type) ? user_type : 'CUSTOMER';
    await client.query('BEGIN');
    const existingUser = await client.query(
        'SELECT user_id FROM users WHERE phone_number = $1 OR email = $2',
        [phone_number, email]
    );
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'User with this phone number or email already exists.' });
    }
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const userResult = await client.query(
        `INSERT INTO users (phone_number, email, password_hash, user_type, status, created_at)
       VALUES ($1, $2, $3, $4, 'active', CURRENT_TIMESTAMP)
       RETURNING user_id, user_type`,
        [phone_number, email, password_hash, finalUserType]
    );
    const userId = userResult.rows[0].user_id;
    await client.query(
        `INSERT INTO user_profiles (user_id, name, city, state, gender, is_current, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, name, city, state, gender]
    );
    await client.query('COMMIT');
    const token = generateToken(userId, finalUserType, null);
    res.status(201).json({ success: true, message: 'User registered successfully.', data: { user_id: userId, user_type: finalUserType, token } });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Error registering user.', error: error.message });
  } finally {
    client.release();
  }
};

const login = async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ success: false, message: 'Phone number and password are required.' });
    }
    const result = await db.query(
        'SELECT user_id, password_hash, user_type, status FROM users WHERE phone_number = $1',
        [phone_number]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const user = result.rows[0];
    if (user.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Account is inactive. Please contact support.' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    await db.query(
        'UPDATE user_profiles SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_current = true',
        [user.user_id]
    );
    const token = generateToken(user.user_id, user.user_type, null);
    const profileResult = await db.query(
        'SELECT name, city, state, profile_picture FROM user_profiles WHERE user_id = $1 AND is_current = true',
        [user.user_id]
    );
    res.json({ success: true, message: 'Login successful.', data: { user_id: user.user_id, user_type: user.user_type, profile: profileResult.rows[0] || {}, token } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error logging in.', error: error.message });
  }
};
// ============================================
// CHECK USER (pre-login validation)
// POST /auth/check-user
// ============================================
const checkUser = async (req, res) => {
  try {
    const { phone_number, role } = req.body;

    if (!phone_number || !role) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and role are required.',
      });
    }

    // Normalize: handle both +91XXXXXXXXXX and XXXXXXXXXX formats
    const stripped = phone_number.replace(/^\+91/, '');      // 9876543211
    const e164    = '+91' + stripped;                        // +919876543211

    const result = await db.query(
        'SELECT user_id, user_type, status FROM users WHERE phone_number = $1 OR phone_number = $2',
        [phone_number, stripped === phone_number ? e164 : stripped]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        exists: false,
        message: 'USER NOT FOUND. Please register first.',
      });
    }

    const user = result.rows[0];
    const dbRole = user.user_type?.toUpperCase();
    const requestedRole = role?.toUpperCase();

    if (dbRole !== requestedRole) {
      return res.status(403).json({
        success: false,
        exists: true,
        message: `This number is not registered as ${role}.`,
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        exists: true,
        message: 'Account is inactive. Please contact support.',
      });
    }

    return res.json({
      success: true,
      exists: true,
      message: 'User found.',
    });
  } catch (error) {
    console.error('❌ Check user error:', error);
    res.status(500).json({ success: false, message: 'Server error.', error: error.message });
  }
};


module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  sendOTP,
  verifyOTP,
  logout,
  checkUser,
};