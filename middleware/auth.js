const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET =
    process.env.JWT_SECRET ||
    '4uBCAsrlj0PS/960LL1vvSvJx0XrJputuuKvGUQCcQRtwCqtt8rYDRl3T0Fa19ruYghYFftKYD81WUfJ6MUxfg==';

// ============================================
// VERIFY TOKEN
// B15: checks device_id embedded in JWT against stored value.
// ============================================
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'NO_TOKEN',
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Session expired. Please log in again.',
        });
      }
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Invalid token.',
      });
    }

    // B15: device_id check — skip if token pre-dates this feature
    if (decoded.deviceId) {
      const profileResult = await db.query(
          'SELECT device_id FROM user_profiles WHERE user_id = $1 AND is_current = true',
          [decoded.userId]
      );
      const storedDeviceId = profileResult.rows[0]?.device_id;
      if (storedDeviceId && storedDeviceId !== decoded.deviceId) {
        console.log(`🔒 B15: Device mismatch for user ${decoded.userId}`);
        return res.status(401).json({
          success: false,
          code: 'SESSION_EXPIRED',
          message: 'Your account has been signed in on another device. Please log in again.',
        });
      }
    }

    req.user = {
      userId: decoded.userId,
      userType: decoded.userType,
      deviceId: decoded.deviceId,
    };

    next();
  } catch (error) {
    console.error('❌ Token verification error:', error);
    res.status(500).json({ success: false, message: 'Error verifying token.', error: error.message });
  }
};

// ============================================
// ROLE GUARDS
// ============================================

const isAdmin = (req, res, next) => {
  if (req.user.userType !== 'ADMIN' && req.user.userType !== 'SUPERADMIN') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
};

// FIX: isSuperAdmin was missing from module.exports.
// adminRoutes.js line 20: router.post('/users/admin', isSuperAdmin, ...)
// Express received undefined for the callback → crash on startup.
const isSuperAdmin = (req, res, next) => {
  if (req.user.userType !== 'SUPERADMIN') {
    return res.status(403).json({ success: false, message: 'SuperAdmin access required.' });
  }
  next();
};

const isVendor = (req, res, next) => {
  if (req.user.userType !== 'VENDOR') {
    return res.status(403).json({ success: false, message: 'Vendor access required.' });
  }
  next();
};

const isCustomer = (req, res, next) => {
  if (req.user.userType !== 'CUSTOMER') {
    return res.status(403).json({ success: false, message: 'Customer access required.' });
  }
  next();
};

// FIX: now exports isSuperAdmin so adminRoutes.js destructuring works
module.exports = { verifyToken, isAdmin, isSuperAdmin, isVendor, isCustomer };