// routes/setup.js
const express = require('express');
const User = require('../models/User');
const router = express.Router();

// One-time bootstrap route. Requires SETUP_SECRET to match and refuses to run
// if any admin user already exists, so it cannot be used to hijack a live admin account.
router.get('/admin', async (req, res) => {
    try {
        if (!process.env.SETUP_SECRET) {
            return res.status(503).json({ success: false, message: 'Setup route disabled: SETUP_SECRET not configured' });
        }

        if (req.query.secret !== process.env.SETUP_SECRET) {
            return res.status(401).json({ success: false, message: 'Invalid setup secret' });
        }

        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) {
            return res.status(409).json({ success: false, message: 'An admin user already exists' });
        }

        const admin = await User.create({
            name: 'Admin User',
            userId: 'admin',
            phone: '9876543210',
            email: 'admin@example.com',
            password: 'password123', // Your User.js will hash this
            role: 'admin',
            isActive: true,
        });
        res.status(201).json({ success: true, message: 'Admin created! Please log in and change the password immediately.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
module.exports = router;