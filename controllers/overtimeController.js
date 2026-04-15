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
  const { date, hours, reason, workerId } = req.body;

  console.log('📝 Overtime Request Submission:');
  console.log('   User Role:', req.user.role);
  console.log('   User ID:', req.user.id);
  console.log('   Request Body:', { date, hours, reason, workerId });

  // Validation
  if (!date) {
    return res.status(400).json({ success: false, message: 'Date is required' });
  }
  if (!hours || hours <= 0) {
    return res.status(400).json({ success: false, message: 'Valid hours (greater than 0) is required' });
  }
  if (!reason || reason.trim() === '') {
    return res.status(400).json({ success: false, message: 'Reason is required' });
  }

  try {
    let targetUserId = req.user.id;

    // If workerId is provided and user is supervisor/management/admin, use workerId
    if (workerId && ['supervisor', 'management', 'admin'].includes(req.user.role)) {
      targetUserId = workerId;
      console.log('   Using workerId for target user:', targetUserId);
    } else {
      console.log('   Using authenticated user ID:', targetUserId);
    }

    // Parse date if it's a string
    let dateObj = date;
    if (typeof date === 'string') {
      dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date format' });
      }
    }

    const record = await Overtime.create({
      user: targetUserId,
      date: dateObj,
      hours: parseFloat(hours),
      reason: reason.trim(),
      status: 'pending' // Default status
    });

    console.log('   ✅ Overtime record created:', record._id);

    // Populate user info in response
    await record.populate('user', 'name userId role');
    
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error('   ❌ Error creating overtime record:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid user ID or date format' });
    }
    res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
};