// controllers/overtimeController.js
const Overtime = require('../models/Overtime');

// @desc    Get all overtime records (can filter by status)
// @route   GET /api/v1/overtime
// @access  Admin/Management
exports.getOvertimeRequests = async (req, res) => {
  let query = {};
  if (req.query.status) {
    query.status = req.query.status;
  }

  try {
    const records = await Overtime.find(query)
      .populate('user', 'name userId role'); // We need 'role' to filter on the frontend

    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Approve an overtime request
// @route   PUT /api/v1/overtime/:id/approve
// @access  Admin/Management
exports.approveOvertime = async (req, res) => {
  try {
    const record = await Overtime.findByIdAndUpdate(
      req.params.id, 
      { status: 'approved' }, 
      { new: true }
    );
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Reject an overtime request
// @route   PUT /api/v1/overtime/:id/reject
// @access  Admin/Management
exports.rejectOvertime = async (req, res) => {
  try {
    const record = await Overtime.findByIdAndUpdate(
      req.params.id, 
      { status: 'rejected' }, 
      { new: true }
    );
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Create an overtime request
// @route   POST /api/v1/overtime
// @access  Protected (All users)
exports.createOvertimeRequest = async (req, res) => {
  const { date, hours, reason } = req.body;

  try {
    const record = await Overtime.create({
      user: req.user.id, // Comes from 'protect' middleware
      date,
      hours,
      reason,
      status: 'pending' // Default status
    });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};