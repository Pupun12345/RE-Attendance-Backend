// routes/dataExport.js
const express = require('express');
const { exportAllData } = require('../controllers/dataExportController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes below are protected and admin-only
router.use(protect);
router.use(authorize('admin'));

// GET endpoint to export all production data in a single JSON response
router.get('/all', exportAllData);

module.exports = router;

