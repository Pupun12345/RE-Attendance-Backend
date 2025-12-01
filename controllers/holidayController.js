// controllers/holidayController.js
const Holiday = require('../models/Holiday');

// @desc    Get all holidays
// @route   GET /api/v1/holidays
exports.getHolidays = async (req, res) => {
  try {
    const holidays = await Holiday.find().sort('date');
    res.status(200).json({ success: true, count: holidays.length, holidays });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Create a holiday
// @route   POST /api/v1/holidays
exports.createHoliday = async (req, res) => {
  const { name, date, type } = req.body;
  
  try {
    const holiday = await Holiday.create({ name, date, type });
    res.status(201).json({ success: true, holiday });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// @desc    Delete a holiday
// @route   DELETE /api/v1/holidays/:id
exports.deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }
    res.status(200).json({ success: true, message: 'Holiday deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};