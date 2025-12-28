// controllers/reportController.js
const Attendance = require('../models/Attendance');
const Complaint = require('../models/Complaint');
const Overtime = require('../models/Overtime');
const User = require('../models/User');

// @desc    Get Daily Attendance Report
// @route   GET /api/v1/reports/attendance/daily
exports.getDailyAttendance = async (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
  }

  // Parse dates in IST (UTC+5:30) to match how attendance dates are stored
  // When user selects Dec 28, they mean Dec 28 IST, which is Dec 27 18:30 UTC
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  
  // Parse dates as IST - JavaScript automatically converts to UTC internally
  // Dec 28 00:00 IST becomes Dec 27 18:30 UTC internally
  const startIST = new Date(startDate + 'T00:00:00.000+05:30');
  const endIST = new Date(endDate + 'T23:59:59.999+05:30');
  
  // Use directly for MongoDB query (already in UTC internally)
  const start = startIST;
  const end = endIST;

  try {
    // Get all active users (workers, supervisors, management)
    const userQuery = { isActive: true };
    if (req.user.role === 'supervisor') {
      // Supervisors can only see their own records
      userQuery._id = req.user._id;
    } else {
      // Admin/Management can see all roles
      userQuery.role = { $in: ['worker', 'supervisor', 'management'] };
    }
    
    const allUsers = await User.find(userQuery, 'name userId role').lean();

    // Build query for attendance records
    const attendanceQuery = {
      date: { $gte: start, $lte: end }
    };

    // If user is a supervisor, filter to only their own records
    if (req.user.role === 'supervisor') {
      attendanceQuery.user = req.user._id;
    }

    const attendanceRecords = await Attendance.find(attendanceQuery)
      .populate('user', 'name userId role')
      .sort({ date: -1, user: 1 })
      .lean();

    // Fetch approved overtime records for the date range
    const overtimeRecords = await Overtime.find({
      date: { $gte: start, $lte: end },
      status: 'approved'
    }).lean();

    // Create a map of user+date -> overtime hours for quick lookup
    // Normalize dates to IST for matching
    const overtimeMap = new Map();
    overtimeRecords.forEach(ot => {
      const userId = ot.user?.toString() || ot.user;
      // Convert UTC date to IST for matching
      const otDateIST = new Date(ot.date.getTime() + IST_OFFSET_MS);
      const dateStr = otDateIST.toISOString().split('T')[0];
      const dateKey = `${userId}_${dateStr}`;
      overtimeMap.set(dateKey, ot.hours);
    });

    // Create a map of user+date -> attendance record for quick lookup
    // Normalize dates to IST for matching
    const attendanceMap = new Map();
    attendanceRecords.forEach(record => {
      const userId = record.user?._id?.toString() || record.user?.toString() || record.user;
      // Convert UTC date to IST for matching
      const recordDateIST = new Date(record.date.getTime() + IST_OFFSET_MS);
      const dateStr = recordDateIST.toISOString().split('T')[0];
      const dateKey = `${userId}_${dateStr}`;
      attendanceMap.set(dateKey, record);
    });

    // Generate all dates in the range (in IST)
    // Create dates in IST and convert to UTC for storage, but use IST date string for matching
    const dates = [];
    const currentDate = new Date(startIST);
    while (currentDate <= endIST) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Build complete report with present and absent records
    const allRecords = [];
    
    for (const user of allUsers) {
      for (const date of dates) {
        // Convert UTC date to IST for date string matching
        const dateIST = new Date(date.getTime() + IST_OFFSET_MS);
        const dateStr = dateIST.toISOString().split('T')[0];
        const dateKey = `${user._id.toString()}_${dateStr}`;
        const overtimeHours = overtimeMap.get(dateKey) || 0;
        
        const existingRecord = attendanceMap.get(dateKey);
        
        if (existingRecord) {
          // User has an attendance record for this date
          allRecords.push({
            ...existingRecord,
            user: {
              ...existingRecord.user,
              designation: existingRecord.user?.role || null
            },
            checkInLocation: existingRecord.checkInLocation || null,
            checkOutLocation: existingRecord.checkOutLocation || null,
            checkInSelfie: existingRecord.checkInSelfie || null,
            checkOutSelfie: existingRecord.checkOutSelfie || null,
            ot: overtimeHours,
            overtime: overtimeHours,
            overtimeHours: overtimeHours
          });
        } else {
          // User is absent for this date - create absent record
          allRecords.push({
            _id: null,
            user: {
              _id: user._id,
              name: user.name,
              userId: user.userId,
              role: user.role,
              designation: user.role || null
            },
            date: date,
            checkInTime: null,
            checkOutTime: null,
            status: 'absent',
            notes: null,
            checkInLocation: null,
            checkOutLocation: null,
            checkInSelfie: null,
            checkOutSelfie: null,
            ot: overtimeHours,
            overtime: overtimeHours,
            overtimeHours: overtimeHours,
            createdAt: null,
            updatedAt: null
          });
        }
      }
    }

    // Sort by date (descending) then by user role priority, then by name
    allRecords.sort((a, b) => {
      // First sort by date (descending)
      const dateCompare = new Date(b.date) - new Date(a.date);
      if (dateCompare !== 0) return dateCompare;
      
      // Then by role priority
      const rolePriority = (role) => {
        if (!role) return 4;
        const r = role.toUpperCase();
        if (r.includes('MANAGEMENT')) return 1;
        if (r.includes('SUPERVISOR')) return 2;
        if (r.includes('WORKER')) return 3;
        return 4;
      };
      
      const aPriority = rolePriority(a.user?.role);
      const bPriority = rolePriority(b.user?.role);
      if (aPriority !== bPriority) return aPriority - bPriority;
      
      // Finally by name
      return (a.user?.name || '').localeCompare(b.user?.name || '');
    });
    
    res.status(200).json({ success: true, count: allRecords.length, data: allRecords });

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