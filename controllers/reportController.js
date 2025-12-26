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

  // Set times to ensure full day coverage (UTC)
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T23:59:59.999Z');

  try {
    // Build query - supervisors can only see their own records
    const query = {
      date: { $gte: start, $lte: end }
    };

    // If user is a supervisor, filter to only their own records
    if (req.user.role === 'supervisor') {
      query.user = req.user._id;
    }

    const records = await Attendance.find(query)
      .populate('user', 'name userId role')
      .sort({ date: -1, user: 1 })
      .lean();

    // Fetch approved overtime records for the date range
    const overtimeRecords = await Overtime.find({
      date: { $gte: start, $lte: end },
      status: 'approved'
    }).lean();

    // Create a map of user+date -> overtime hours for quick lookup
    const overtimeMap = new Map();
    overtimeRecords.forEach(ot => {
      const userId = ot.user?.toString() || ot.user;
      const dateStr = new Date(ot.date).toISOString().split('T')[0];
      const dateKey = `${userId}_${dateStr}`;
      overtimeMap.set(dateKey, ot.hours);
    });

    // Map records to include designation and overtime hours
    const mappedRecords = records.map(record => {
      const userId = record.user?._id?.toString() || record.user?.toString() || record.user;
      const dateStr = new Date(record.date).toISOString().split('T')[0];
      const dateKey = `${userId}_${dateStr}`;
      const overtimeHours = overtimeMap.get(dateKey) || 0;
      
      return {
        ...record,
        user: {
          ...record.user,
          designation: record.user?.role || null
        },
        ot: overtimeHours,
        overtime: overtimeHours,
        overtimeHours: overtimeHours
      };
    });
    
    res.status(200).json({ success: true, count: mappedRecords.length, data: mappedRecords });

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