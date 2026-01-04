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

    // Fetch overtime records for the date range (include pending and approved, exclude rejected)
    const overtimeRecords = await Overtime.find({
      date: { $gte: start, $lte: end },
      status: { $in: ['pending', 'approved'] }
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
      
      // Debug logging (can be removed in production)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`📊 Overtime mapping: userId=${userId}, date=${dateStr}, hours=${ot.hours}, status=${ot.status}, key=${dateKey}`);
      }
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
          // Normalize location structure for frontend compatibility
          const checkInLoc = existingRecord.checkInLocation || {};
          const checkOutLoc = existingRecord.checkOutLocation || {};
          
          // Normalize location structure for frontend compatibility
          // Frontend expects: checkInLocation = { longitude, latitude, address } or null
          // Also supports fallback: record['longitude'], record['latitude'], record['address']
          const normalizedCheckInLocation = existingRecord.checkInLocation 
            ? {
                longitude: existingRecord.checkInLocation.longitude || existingRecord.checkInLocation.lng || null,
                latitude: existingRecord.checkInLocation.latitude || existingRecord.checkInLocation.lat || null,
                address: existingRecord.checkInLocation.address || null
              }
            : null;
          
          const normalizedCheckOutLocation = existingRecord.checkOutLocation
            ? {
                longitude: existingRecord.checkOutLocation.longitude || existingRecord.checkOutLocation.lng || null,
                latitude: existingRecord.checkOutLocation.latitude || existingRecord.checkOutLocation.lat || null,
                address: existingRecord.checkOutLocation.address || null
              }
            : null;
          
          allRecords.push({
            ...existingRecord,
            user: {
              ...existingRecord.user,
              designation: existingRecord.user?.role || null
            },
            // Provide location objects with consistent structure for frontend
            checkInLocation: normalizedCheckInLocation,
            checkOutLocation: normalizedCheckOutLocation,
            // Backward compatibility: also include at root level for frontend fallbacks
            // Frontend code: location['longitude'] ?? record['longitude'] ?? '0.0'
            longitude: normalizedCheckInLocation?.longitude || null,
            latitude: normalizedCheckInLocation?.latitude || null,
            address: normalizedCheckInLocation?.address || null,
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
            // Frontend expects location objects or null, with fallback to root level fields
            checkInLocation: null,
            checkOutLocation: null,
            // Backward compatibility: include at root level for frontend fallbacks
            longitude: null,
            latitude: null,
            address: null,
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
  
  // Parse dates in IST (UTC+5:30) to match how attendance dates are stored
  // When user selects Jan 1, they mean Jan 1 IST, which is Dec 31 18:30 UTC
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  
  // Parse dates as IST - JavaScript automatically converts to UTC internally
  // Jan 1 00:00 IST becomes Dec 31 18:30 UTC internally
  // Use the same approach as daily report for consistency
  const startIST = new Date(startDate + 'T00:00:00.000+05:30');
  const endIST = new Date(endDate + 'T23:59:59.999+05:30');
  
  // Use directly for MongoDB query (already in UTC internally)
  const start = startIST;
  const end = endIST;

  // Debug logging
  console.log('📊 Monthly Report Query:');
  console.log('  Input dates:', { startDate, endDate });
  console.log('  Query range (UTC):', { start: start.toISOString(), end: end.toISOString() });
  console.log('  Query range (IST):', { 
    startIST: new Date(start.getTime() - IST_OFFSET_MS).toISOString(),
    endIST: new Date(end.getTime() - IST_OFFSET_MS).toISOString()
  });

  try {
    // Get attendance summary
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
          userId: '$_id',
          user: {
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

    // Debug: Log summary results
    console.log('  Attendance records found:', summary.length);
    if (summary.length > 0) {
      console.log('  Sample record:', JSON.stringify(summary[0], null, 2));
    } else {
      // Check if there are any attendance records in the database for debugging
      const sampleRecords = await Attendance.find({ 
        date: { 
          $gte: new Date(startDate + 'T00:00:00.000Z'), 
          $lte: new Date(endDate + 'T23:59:59.999Z') 
        } 
      })
        .limit(5)
        .lean();
      console.log('  ⚠️  No records found in query range. Sample records in date range (UTC):', 
        sampleRecords.map(r => ({ date: r.date?.toISOString(), user: r.user, status: r.status }))
      );
    }

    // Fetch overtime records for the date range (include pending and approved)
    const overtimeRecords = await Overtime.find({
      date: { $gte: start, $lte: end },
      status: { $in: ['pending', 'approved'] }
    }).lean();

    // Calculate total overtime hours per user
    const overtimeMap = new Map();
    overtimeRecords.forEach(ot => {
      const userId = ot.user?.toString() || ot.user;
      const currentHours = overtimeMap.get(userId) || 0;
      overtimeMap.set(userId, currentHours + ot.hours);
    });

    // Join overtime data with attendance summary
    const summaryWithOvertime = summary.map(record => {
      // userId is stored as ObjectId in the aggregation result
      const userId = record.userId?.toString() || record.userId;
      const totalOvertimeHours = overtimeMap.get(userId) || 0;
      
      // Remove userId from final output (not needed in response)
      const { userId: _, ...recordWithoutUserId } = record;
      
      return {
        ...recordWithoutUserId,
        ot: totalOvertimeHours,
        overtime: totalOvertimeHours,
        overtimeHours: totalOvertimeHours
      };
    });

    // Also include users who have overtime but no attendance records
    const usersWithOvertimeOnly = Array.from(overtimeMap.keys())
      .filter(userId => !summary.some(s => (s.userId?.toString() || s.userId) === userId))
      .map(userId => {
        // Fetch user details for users with only overtime
        const userRecord = overtimeRecords.find(ot => (ot.user?.toString() || ot.user) === userId);
        if (userRecord) {
          return {
            userId: userId,
            user: {
              userId: null, // Will need to populate from User model
              name: null,
              role: null,
              designation: null
            },
            presentDays: 0,
            absentDays: 0,
            leaveDays: 0,
            lateDays: 0,
            ot: overtimeMap.get(userId) || 0,
            overtime: overtimeMap.get(userId) || 0,
            overtimeHours: overtimeMap.get(userId) || 0
          };
        }
        return null;
      })
      .filter(Boolean);

    // Populate user details for users with only overtime
    if (usersWithOvertimeOnly.length > 0) {
      const userIdsToPopulate = usersWithOvertimeOnly.map(u => u.userId);
      const users = await User.find({ _id: { $in: userIdsToPopulate } }, 'name userId role designation').lean();
      const userMap = new Map(users.map(u => [u._id.toString(), u]));
      
      usersWithOvertimeOnly.forEach(record => {
        const user = userMap.get(record.userId);
        if (user) {
          record.user = {
            userId: user.userId,
            name: user.name,
            role: user.role,
            designation: user.designation
          };
        }
      });
      
      summaryWithOvertime.push(...usersWithOvertimeOnly);
    }

    res.status(200).json({ success: true, count: summaryWithOvertime.length, data: summaryWithOvertime });
    
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