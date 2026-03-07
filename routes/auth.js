// routes/auth.js
const express = require('express');
const { login, forgotPassword, resetPassword } = require('../controllers/authController');
const router = express.Router();

router.post('/login', login);
router.post('/forgotpassword', forgotPassword);
router.post('/resetpassword/:token', resetPassword);

module.exports = router;