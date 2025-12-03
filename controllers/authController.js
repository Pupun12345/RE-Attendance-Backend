// controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const path = require('path');


const getSignedUrl = async (profileImageUrl) => {
  if (!profileImageUrl) {
    return null;
  }

  return profileImageUrl;
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Please provide email and password' });
  }

  const user = await User.findOne({
    $or: [{ email: email }, { userId: email }],
  }).select('+password');

  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Invalid credentials' });
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    return res
      .status(401)
      .json({ success: false, message: 'Invalid credentials' });
  }

  if (!['admin', 'management', 'supervisor'].includes(user.role)) {
    return res
      .status(403)
      .json({ success: false, message: 'Login forbidden for this role' });
  }

  sendTokenResponse(user, 200, res);
};

// --- (You can keep your existing forgotPassword and resetPassword functions) ---
exports.forgotPassword = async (req, res) => {
  // ... (your code)
};
exports.resetPassword = async (req, res) => {
   // ... (your code)
};
// ---


const sendTokenResponse = async (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });

  const signedProfileUrl = user.profileImageUrl;

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      userId: user.userId,
      profileImageUrl: signedProfileUrl
    },
  });
};