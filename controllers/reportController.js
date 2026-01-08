// controllers/reportController.js
const Attendance = require('../models/Attendance');
const Complaint = require('../models/Complaint');
const Overtime = require('../models/Overtime');
const User = require('../models/User');
const Holiday = require('../models/Holiday');

// Helper function to get date-only string (YYYY-MM-DD) from a date object
// Normalizes to IST timezone for consistent date comparison
const getDateOnlyString = (date) => {
  if (!date) return null;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const dateIST = new Date(date.getTime() + IST_OFFSET_MS);
  return dateIST.toISOString().split('T')[0]; // Returns YYYY-MM-DD
};

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
  // Use start of day and end of day to cover entire date range
  const startIST = new Date(startDate + 'T00:00:00.000+05:30');
  const endIST = new Date(endDate + 'T23:59:59.999+05:30');
  
  // Get date-only strings for comparison (prevents day rollover issues)
  const startDateStr = getDateOnlyString(startIST);
  const endDateStr = getDateOnlyString(endIST);
  
  // Use date range for MongoDB query (covers entire days)
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

    // Fetch holidays in the date range
    console.log('📅 [Daily Report] Fetching holidays with query:', {
      date: { $gte: start.toISOString(), $lte: end.toISOString() },
      startDateStr,
      endDateStr
    });
    
    const holidays = await Holiday.find({
      date: { $gte: start, $lte: end }
    }).lean();
    
    console.log('📅 [Daily Report] Holidays query result:');
    console.log('  - Total records returned from DB:', holidays.length);
    console.log('  - Holiday records:', holidays.map(h => ({
      _id: h._id,
      name: h.name,
      date: h.date,
      dateISO: h.date?.toISOString(),
      type: h.type
    })));

    // Create a Set of holiday dates (normalized to date-only strings) for quick lookup
    // Filter to only include holidays within the date range using date-only comparison
    // Use a Set to ensure we only count unique dates, not duplicate records
    const holidayDateSet = new Set();
    const seenHolidayIds = new Set(); // Track holiday IDs to prevent counting duplicates
    
    holidays.forEach((holiday, index) => {
      console.log(`📅 [Daily Report] Processing holiday ${index + 1}:`, {
        _id: holiday._id,
        name: holiday.name,
        date: holiday.date?.toISOString(),
        dateStr: getDateOnlyString(holiday.date)
      });
      
      // Skip if we've already processed this holiday ID (prevent duplicate counting)
      const holidayId = holiday._id?.toString() || holiday._id;
      if (seenHolidayIds.has(holidayId)) {
        console.log(`  ⚠️  Skipping duplicate holiday ID: ${holidayId}`);
        return; // Skip duplicate holiday records
      }
      seenHolidayIds.add(holidayId);
      
      const dateStr = getDateOnlyString(holiday.date);
      // Only include holidays within the date range (date-only comparison)
      if (dateStr && dateStr >= startDateStr && dateStr <= endDateStr) {
        holidayDateSet.add(dateStr);
        console.log(`  ✅ Added to holidayDateSet: ${dateStr}`);
      } else {
        console.log(`  ❌ Holiday date ${dateStr} is outside range [${startDateStr}, ${endDateStr}]`);
      }
    });
    
    console.log('📅 [Daily Report] Holiday processing summary:');
    console.log('  - Unique holiday IDs seen:', seenHolidayIds.size);
    console.log('  - Unique holiday dates in set:', holidayDateSet.size);
    console.log('  - Holiday dates in set:', Array.from(holidayDateSet));

    // Fetch overtime records for the date range (include pending and approved, exclude rejected)
    const overtimeRecords = await Overtime.find({
      date: { $gte: start, $lte: end },
      status: { $in: ['pending', 'approved'] }
    }).lean();

    // Create a map of user+date -> overtime hours for quick lookup
    // Use date-only strings for matching (prevents day rollover)
    // Filter to only include records within the date range using date-only comparison
    const overtimeMap = new Map();
    overtimeRecords.forEach(ot => {
      const userId = ot.user?.toString() || ot.user;
      const dateStr = getDateOnlyString(ot.date);
      // Only include records within the date range (date-only comparison)
      if (dateStr && userId && dateStr >= startDateStr && dateStr <= endDateStr) {
        const dateKey = `${userId}_${dateStr}`;
        overtimeMap.set(dateKey, ot.hours);
        
        // Debug logging (can be removed in production)
        if (process.env.NODE_ENV !== 'production') {
          console.log(`📊 Overtime mapping: userId=${userId}, date=${dateStr}, hours=${ot.hours}, status=${ot.status}, key=${dateKey}`);
        }
      }
    });

    // Create a map of user+date -> attendance record for quick lookup
    // Use date-only strings for matching (prevents day rollover)
    // Filter to only include records within the date range using date-only comparison
    const attendanceMap = new Map();
    attendanceRecords.forEach(record => {
      const userId = record.user?._id?.toString() || record.user?.toString() || record.user;
      const dateStr = getDateOnlyString(record.date);
      // Only include records within the date range (date-only comparison)
      if (dateStr && userId && dateStr >= startDateStr && dateStr <= endDateStr) {
        const dateKey = `${userId}_${dateStr}`;
        attendanceMap.set(dateKey, record);
      }
    });

    // Generate all dates in the range using date-only comparison
    // Compare dates as strings to prevent day rollover issues
    const dates = [];
    const currentDate = new Date(startIST);
    const endDateOnly = getDateOnlyString(endIST);
    
    while (true) {
      const currentDateStr = getDateOnlyString(currentDate);
      if (!currentDateStr || currentDateStr > endDateStr) break;
      
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Build complete report with present and absent records
    const allRecords = [];
    
    for (const user of allUsers) {
      for (const date of dates) {
        // Use date-only string for matching (prevents day rollover)
        const dateStr = getDateOnlyString(date);
        if (!dateStr) continue;
        
        const dateKey = `${user._id.toString()}_${dateStr}`;
        const overtimeHours = overtimeMap.get(dateKey) || 0;
        
        // Check if this date is a holiday - exclude holidays from absent calculation
        const isHoliday = holidayDateSet.has(dateStr);
        
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
        } else if (!isHoliday) {
          // User is absent for this date - create absent record
          // Only create absent record if the date is NOT a holiday
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
        // If isHoliday is true and no existingRecord, we skip creating any record
        // Holidays are not considered as absent days
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
    
    // Get holidays count from database - simply count the number of holiday entries
    const holidaysCount = holidays.length;
    console.log('📅 [Daily Report] Final holidaysCount:', holidaysCount);
    
    res.status(200).json({ 
      success: true, 
      count: allRecords.length, 
      holidaysCount: holidaysCount,
      data: allRecords 
    });

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
  
  // Get date-only strings for comparison (prevents day rollover issues)
  const startDateStr = getDateOnlyString(startIST);
  const endDateStr = getDateOnlyString(endIST);
  
  // Use date range for MongoDB query (covers entire days)
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
    // Get all active users (workers, supervisors, management) for role-based filtering
    const userQuery = { isActive: true };
    if (req.user.role === 'supervisor') {
      // Supervisors can only see their own records
      userQuery._id = req.user._id;
    } else {
      // Admin/Management can see all roles
      userQuery.role = { $in: ['worker', 'supervisor', 'management'] };
    }
    
    const allUsers = await User.find(userQuery, 'name userId role designation').lean();

    // Fetch holidays in the date range
    console.log('📅 Fetching holidays with query:', {
      date: { $gte: start.toISOString(), $lte: end.toISOString() },
      startDateStr,
      endDateStr
    });
    
    const holidays = await Holiday.find({
      date: { $gte: start, $lte: end }
    }).lean();
    
    console.log('📅 Holidays query result:');
    console.log('  - Total records returned from DB:', holidays.length);
    console.log('  - Holiday records:', holidays.map(h => ({
      _id: h._id,
      name: h.name,
      date: h.date,
      dateISO: h.date?.toISOString(),
      type: h.type
    })));

    // Create a Set of holiday dates (normalized to date-only strings) for quick lookup
    // Filter to only include holidays within the date range using date-only comparison
    // Use a Set to ensure we only count unique dates, not duplicate records
    const holidayDateSet = new Set();
    const seenHolidayIds = new Set(); // Track holiday IDs to prevent counting duplicates
    
    holidays.forEach((holiday, index) => {
      console.log(`📅 Processing holiday ${index + 1}:`, {
        _id: holiday._id,
        name: holiday.name,
        date: holiday.date?.toISOString(),
        dateStr: getDateOnlyString(holiday.date)
      });
      
      // Skip if we've already processed this holiday ID (prevent duplicate counting)
      const holidayId = holiday._id?.toString() || holiday._id;
      if (seenHolidayIds.has(holidayId)) {
        console.log(`  ⚠️  Skipping duplicate holiday ID: ${holidayId}`);
        return; // Skip duplicate holiday records
      }
      seenHolidayIds.add(holidayId);
      
      const dateStr = getDateOnlyString(holiday.date);
      // Only include holidays within the date range (date-only comparison)
      if (dateStr && dateStr >= startDateStr && dateStr <= endDateStr) {
        holidayDateSet.add(dateStr);
        console.log(`  ✅ Added to holidayDateSet: ${dateStr}`);
      } else {
        console.log(`  ❌ Holiday date ${dateStr} is outside range [${startDateStr}, ${endDateStr}]`);
      }
    });
    
    console.log('📅 Holiday processing summary:');
    console.log('  - Unique holiday IDs seen:', seenHolidayIds.size);
    console.log('  - Unique holiday dates in set:', holidayDateSet.size);
    console.log('  - Holiday dates in set:', Array.from(holidayDateSet));
    
    // Get holidays count from database - simply count the number of holiday entries
    const holidaysCount = holidays.length;
    console.log('📅 Final holidaysCount:', holidaysCount);

    // Calculate total working days (excluding holidays) in the date range
    // Use date-only comparison to prevent day rollover
    const totalWorkingDays = [];
    const currentDate = new Date(startIST);
    
    while (true) {
      const currentDateStr = getDateOnlyString(currentDate);
      if (!currentDateStr || currentDateStr > endDateStr) break;
      
      if (!holidayDateSet.has(currentDateStr)) {
        totalWorkingDays.push(currentDateStr);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    const totalWorkingDaysCount = totalWorkingDays.length;

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

    // Debug: Log overtime records to check for duplicates
    console.log('📊 Overtime records found:', overtimeRecords.length);
    if (process.env.NODE_ENV !== 'production') {
      overtimeRecords.forEach((ot, idx) => {
        console.log(`  OT ${idx + 1}: userId=${ot.user}, date=${ot.date?.toISOString()}, hours=${ot.hours}, status=${ot.status}, _id=${ot._id}`);
      });
    }

    // Calculate total overtime hours per user
    // Accumulate raw values first, then round when retrieving to avoid precision issues
    const overtimeMap = new Map();
    overtimeRecords.forEach(ot => {
      const userId = ot.user?.toString() || ot.user;
      const currentHours = overtimeMap.get(userId) || 0;
      // Accumulate raw values without rounding to maintain accuracy
      overtimeMap.set(userId, currentHours + ot.hours);
    });
    
    // Debug: Log accumulated overtime totals
    if (process.env.NODE_ENV !== 'production') {
      console.log('📊 Accumulated overtime totals:');
      overtimeMap.forEach((hours, userId) => {
        console.log(`  User ${userId}: ${hours} hours (raw), ${Math.round(hours)} hours (rounded)`);
      });
    }

    // Track userIds that are already in the summary to avoid duplicates
    const userIdsInSummary = new Set();
    
    // Join overtime data with attendance summary and recalculate absent days
    const summaryWithOvertime = summary.map(record => {
      // userId is stored as ObjectId in the aggregation result
      const userId = record.userId?.toString() || record.userId;
      userIdsInSummary.add(userId); // Track this userId
      const totalOvertimeHours = Math.round(overtimeMap.get(userId) || 0);
      
      // Recalculate absent days: total working days - present - leave - late
      // This ensures holidays are excluded and we count actual absent days correctly
      const presentDays = record.presentDays || 0;
      const leaveDays = record.leaveDays || 0;
      const lateDays = record.lateDays || 0;
      // Late days are considered as present, so we include them in the calculation
      const actualPresentDays = presentDays + lateDays;
      const recalculatedAbsentDays = Math.max(0, totalWorkingDaysCount - actualPresentDays - leaveDays);
      
      // Remove userId from final output (not needed in response)
      const { userId: _, ...recordWithoutUserId } = record;
      
      return {
        ...recordWithoutUserId,
        presentDays: actualPresentDays, // Include late days as present
        absentDays: recalculatedAbsentDays, // Recalculated excluding holidays
        leaveDays: leaveDays,
        lateDays: lateDays,
        ot: totalOvertimeHours, // Rounded to whole number
        overtime: totalOvertimeHours, // Rounded to whole number
        overtimeHours: totalOvertimeHours // Rounded to whole number
      };
    });

    // Also include users who have overtime but no attendance records
    // For these users, all working days are considered absent (excluding holidays)
    const usersWithOvertimeOnly = Array.from(overtimeMap.keys())
      .filter(userId => !userIdsInSummary.has(userId))
      .map(userId => {
        userIdsInSummary.add(userId); // Track this userId
        // Fetch user details for users with only overtime
        const userRecord = overtimeRecords.find(ot => (ot.user?.toString() || ot.user) === userId);
        if (userRecord) {
          const userOvertimeHours = Math.round(overtimeMap.get(userId) || 0);
          return {
            userId: userId,
            user: {
              userId: null, // Will need to populate from User model
              name: null,
              role: null,
              designation: null
            },
            presentDays: 0,
            absentDays: totalWorkingDaysCount, // All working days are absent (holidays excluded)
            leaveDays: 0,
            lateDays: 0,
            ot: userOvertimeHours, // Rounded to whole number
            overtime: userOvertimeHours, // Rounded to whole number
            overtimeHours: userOvertimeHours // Rounded to whole number
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

    // Also include all active users who have no attendance or overtime records
    // For these users, all working days are considered absent (excluding holidays)
    const usersWithNoRecords = allUsers
      .filter(user => !userIdsInSummary.has(user._id.toString()))
      .map(user => ({
        user: {
          userId: user.userId,
          name: user.name,
          role: user.role,
          designation: user.designation
        },
        presentDays: 0,
        absentDays: totalWorkingDaysCount, // All working days are absent (holidays excluded)
        leaveDays: 0,
        lateDays: 0,
        ot: 0,
        overtime: 0,
        overtimeHours: 0
      }));
    
    summaryWithOvertime.push(...usersWithNoRecords);

    res.status(200).json({ 
      success: true, 
      count: summaryWithOvertime.length, 
      holidaysCount: holidaysCount,
      data: summaryWithOvertime 
    });
    
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