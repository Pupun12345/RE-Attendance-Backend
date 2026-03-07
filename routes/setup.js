// routes/setup.js
const express = require('express');
const User = require('../models/User');
const router = express.Router();

router.get('/admin', async (req, res) => {
    try {
        // Delete any broken admin@example.com users
        await User.deleteOne({ email: 'admin@example.com' });

        // Create a new, correct admin user
        const admin = await User.create({
            name: 'Admin User',
            userId: 'admin',
            phone: '9876543210',
            email: 'admin@example.com',
            password: 'password123', // Your User.js will hash this
            role: 'admin',
            isActive: true,
        });
        res.status(201).json({ success: true, message: 'Admin created!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
module.exports = router;