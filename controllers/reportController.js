// controllers/reportController.js
const Attendance = require('../models/Attendance');
const Complaint = require('../models/Complaint');
const Overtime = require('../models/Overtime');

// @desc    Get Daily Attendance Report
// @route   GET /api/v1/reports/attendance/daily
exports.getDailyAttendance = async (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
  }

  // Set times to ensure full day coverage
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  try {
    // Build query: if supervisor, only show their own records; otherwise show all
    const query = {
      date: { $gte: start, $lte: end }
    };
    
    // If user is a supervisor, filter to only their own attendance records
    if (req.user.role === 'supervisor') {
      query.user = req.user._id;
    }
    
    // Get attendance records with user details
    const records = await Attendance.find(query)
      .populate('user', 'name userId designation role')
      .lean();
    
    // Get all overtime records for the same date range
    const overtimeRecords = await Overtime.find({
      date: { $gte: start, $lte: end },
      status: 'approved' // Only count approved overtime
    }).lean();
    
    // Create a map of user+date to overtime hours for quick lookup
    const overtimeMap = new Map();
    overtimeRecords.forEach(ot => {
      const key = `${ot.user.toString()}_${ot.date.toISOString().split('T')[0]}`;
      overtimeMap.set(key, ot.hours);
    });
    
    // Enrich attendance records with overtime data
    const enrichedRecords = records.map(record => {
      const recordDate = new Date(record.date).toISOString().split('T')[0];
      const overtimeKey = `${record.user._id.toString()}_${recordDate}`;
      const overtimeHours = overtimeMap.get(overtimeKey) || 0;
      
      return {
        ...record,
        ot: overtimeHours,
        overtime: overtimeHours,
        // Ensure checkInLocation is properly structured
        checkInLocation: record.checkInLocation || {
          longitude: null,
          latitude: null,
          address: null
        },
        // Ensure checkOutLocation is properly structured
        checkOutLocation: record.checkOutLocation || {
          longitude: null,
          latitude: null,
          address: null
        },
        // Add backward compatibility fields
        longitude: record.checkInLocation?.longitude || null,
        latitude: record.checkInLocation?.latitude || null,
        address: record.checkInLocation?.address || null,
      };
    });
    
    res.status(200).json({ success: true, count: enrichedRecords.length, data: enrichedRecords });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Get Monthly Attendance Summary (Now supports Date Range)
// @route   GET /api/v1/reports/attendance/monthly
exports.getMonthlySummary = async (req, res) => {
  // ✅ FIX: Accept startDate/endDate to match Flutter UI
  const { startDate, endDate } = req.query; 

  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
  }
  
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  try {
     const summary = await Attendance.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$user",
          presentDays: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
          absentDays: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
          leaveDays: { $sum: { $cond: [{ $eq: ["$status", "leave"] }, 1, 0] } },
          lateDays: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails'
        }
      },
      { $unwind: '$userDetails' },
      { 
        $project: {
          _id: 0,

          user:{
          userId: '$userDetails.userId',
          name: '$userDetails.name',
          role: '$userDetails.role',
          designation: '$userDetails.designation'
          },
          presentDays: 1,
          absentDays: 1,
          leaveDays: 1,
          lateDays: 1
        }
      }
    ]);

    res.status(200).json({ success: true, count: summary.length, data: summary });
    
  } catch (err) {
     console.error(err);
     res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ... keep getComplaintReport as is
exports.getComplaintReport = async (req, res) => {
  try {
    const complaints = await Complaint.find().populate('user', 'name userId');
    res.status(200).json({ success: true, count: complaints.length, data: complaints });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};