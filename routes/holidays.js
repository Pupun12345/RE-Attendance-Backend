// routes/holidays.js
const express = require('express');
const { 
  getHolidays, 
  createHoliday, 
  deleteHoliday 
} = require('../controllers/holidayController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// CHANGED: Supervisors and Management can GET holidays
router.route('/')
  .get(authorize('admin', 'management', 'supervisor'), getHolidays)
  .post(authorize('admin', 'management'), createHoliday);

// Only admin/management can delete
router.route('/:id')
  .delete(authorize('admin', 'management'), deleteHoliday);

module.exports = router;