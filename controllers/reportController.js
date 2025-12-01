// controllers/reportController.js
const Attendance = require('../models/Attendance');
const Complaint = require('../models/Complaint');

// @desc    Get Daily Attendance Report
// @route   GET /api/v1/reports/attendance/daily
exports.getDailyAttendance = async (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
  }

  try {
    const records = await Attendance.find({
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }).populate('user', 'name userId');
    
    // For a real app, you would format this as a CSV.
    // For now, just send the JSON data.
    res.status(200).json({ success: true, count: records.length, data: records });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Get Monthly Attendance Summary
// @route   GET /api/v1/reports/attendance/monthly
exports.getMonthlySummary = async (req, res) => {
  const { month, year } = req.query; // month (1-12), year (YYYY)

  if (!month || !year) {
    return res.status(400).json({ success: false, message: 'month and year are required' });
  }
  
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // Day 0 of next month is last day of current

  try {
     const summary = await Attendance.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: "$user",
          presentDays: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
          absentDays: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
          leaveDays: { $sum: { $cond: [{ $eq: ["$status", "leave"] }, 1, 0] } }
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
          userId: '$userDetails.userId',
          name: '$userDetails.name',
          presentDays: 1,
          absentDays: 1,
          leaveDays: 1
        }
      }
    ]);

    res.status(200).json({ success: true, data: summary });
    
  } catch (err) {
     res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Get Complaint Report
// @route   GET /api/v1/reports/complaints
exports.getComplaintReport = async (req, res) => {
  try {
    const complaints = await Complaint.find().populate('user', 'name userId');
    
    // Send JSON, format as CSV in a real app
    res.status(200).json({ success: true, count: complaints.length, data: complaints });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};