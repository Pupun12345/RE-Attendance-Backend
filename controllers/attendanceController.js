// controllers/attendanceController.js
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { RekognitionClient, CompareFacesCommand } = require("@aws-sdk/client-rekognition");
const { bucket } = require('../config/initializeGCS');
const path = require('path');

// --- 1. INITIALIZE AWS REKOGNITION ---
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- 3. HELPER: Download Image from GCS ---
async function getImageBuffer(imageUrl) {
  try {
    const fileName = imageUrl.split('/').pop();
    const [buffer] = await bucket.file(fileName).download();
    return buffer;
  } catch (error) {
    console.error(`Error downloading image from GCS:`, error.message);
    throw new Error('Failed to retrieve image from secure storage.');
  }
}

// --- 3.5. HELPER: Parse Location Data ---
function parseLocation(location) {
  // If location is undefined or null, return null
  if (!location) {
    return null;
  }
  
  // If location is already an object, validate and return it
  if (typeof location === 'object' && !Array.isArray(location)) {
    // Ensure it has the expected structure
    return {
      longitude: location.longitude || location.lng || null,
      latitude: location.latitude || location.lat || null,
      address: location.address || null
    };
  }
  
  // If location is a JSON string, parse it
  if (typeof location === 'string') {
    // Handle empty string
    if (location.trim() === '') {
      return null;
    }
    try {
      const parsed = JSON.parse(location);
      // Validate parsed object
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          longitude: parsed.longitude || parsed.lng || null,
          latitude: parsed.latitude || parsed.lat || null,
          address: parsed.address || null
        };
      }
      return null;
    } catch (e) {
      // If JSON parsing fails, try to extract lat/lng from string format like "lat,lng"
      const coordsMatch = location.match(/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (coordsMatch) {
        return {
          longitude: coordsMatch[2],
          latitude: coordsMatch[1],
          address: null
        };
      }
      return null;
    }
  }
  
  return null;
}

// --- 4. HELPER: Compare Faces (AWS Rekognition) ---
async function verifyFace(sourceImageUrl, targetImageUrl) {
  // DEBUG: Bypass face verification
  const BYPASS_FACE_VERIFICATION = true; // Set to false to re-enable
  if (BYPASS_FACE_VERIFICATION) {
    console.log('⚠️  Face verification BYPASSED for debugging');
    return true;
  }
  
  try {
    const sourceBuffer = await getImageBuffer(sourceImageUrl);
    const targetBuffer = await getImageBuffer(targetImageUrl);

    const command = new CompareFacesCommand({
      SourceImage: { Bytes: sourceBuffer },
      TargetImage: { Bytes: targetBuffer },
      SimilarityThreshold: 90,
    });

    const response = await rekognition.send(command);

    if (response.FaceMatches && response.FaceMatches.length > 0) {
      const match = response.FaceMatches[0];
      console.log(`✅ Face Match! Similarity: ${match.Similarity.toFixed(2)}%`);
      return true;
    } else {
      console.log(`❌ No Face Match.`);
      return false;
    }
  } catch (error) {
    console.error("AWS Rekognition Error:", error);
    if (error.name === 'InvalidParameterException') {
      throw new Error('No face detected in the photo. Please retry.');
    }
    return false;
  }
}

// ==========================================
// 1. SUPERVISOR CHECK-IN FOR WORKER (Normal Network)
// ==========================================
exports.supervisorCheckInWorker = async (req, res) => {
  const { workerId, location } = req.body;
  console.log('🔍 Supervisor Check-In Request:');
  console.log('   Worker ID:', workerId);
  console.log('   Location (raw):', location);
  console.log('   Location type:', typeof location);
  console.log('   All body fields:', Object.keys(req.body));
  console.log('   Full req.body:', JSON.stringify(req.body, null, 2));

  if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const worker = await User.findById(workerId);
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });

    // Most recent record check
    let record = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true },
    }).sort({ checkInTime: -1 });

    if (record) {
      if (record.status === 'present' && record.checkOutTime == null) {
        return res.status(400).json({ success: false, message: 'Worker already checked in today.' });
      }
    }

    // Face verification (bypass for testing - TEMPORARILY DISABLED FOR PRODUCTION TESTING)
    // TODO: Re-enable face verification after testing
    const SKIP_FACE_VERIFICATION = true; // Set to false to re-enable
    if (!SKIP_FACE_VERIFICATION && process.env.SKIP_FACE_VERIFICATION !== 'true') {
      if (worker.profileImageUrl && req.file.path) {
        const isMatch = await verifyFace(worker.profileImageUrl, req.file.path);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
      } else {
        console.warn('⚠️  Skipping face verification - profile image or check-in image missing');
      }
    } else {
      console.warn('⚠️  Face verification SKIPPED (temporarily disabled for testing)');
    }

    const parsedLocation = parseLocation(location);
    console.log('   Location (parsed):', parsedLocation);

    record = await Attendance.create({
      user: workerId,
      date: today,
      status: 'present',
      checkInTime: new Date(),
      checkInLocation: parsedLocation,
      checkInSelfie: req.file.path,
      notes: `Punch In by Supervisor: ${req.user.name}`
    });

    // Include debug info in response for testing
    const responseData = record.toObject();
    if (process.env.NODE_ENV !== 'production') {
      responseData._debug = {
        locationReceived: location,
        locationParsed: parsedLocation,
        locationType: typeof location
      };
    }

    res.status(201).json({ success: true, data: responseData });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message || 'Server Error during worker check-in' });
  }
};

// ==========================================
// 2. SUPERVISOR CHECK-OUT FOR WORKER (Normal Network)
// ==========================================
exports.supervisorCheckOutWorker = async (req, res) => {
  const { workerId, location } = req.body;

  if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    let record = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow },
      checkOutTime: { $exists: false }
    });

    if (!record || record.status !== 'present') {
      return res.status(400).json({ success: false, message: 'Worker has not checked in today.' });
    }
    if (record.checkOutTime) {
      return res.status(400).json({ success: false, message: 'Worker already checked out.' });
    }
    
    // Face verification (TEMPORARILY DISABLED FOR PRODUCTION TESTING)
    const SKIP_FACE_VERIFICATION = true; // Set to false to re-enable
    if (!SKIP_FACE_VERIFICATION && process.env.SKIP_FACE_VERIFICATION !== 'true') {
      const worker = await User.findById(workerId);
      const isMatch = await verifyFace(worker.profileImageUrl, req.file.path);
      if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
    } else {
      console.warn('⚠️  Face verification SKIPPED (temporarily disabled for testing)');
    }

    // Update record
    record.checkOutTime = new Date();
    record.checkOutLocation = parseLocation(location);
    record.checkOutSelfie = req.file.path;

    const note = `Punch Out by Supervisor: ${req.user.name}`;
    record.notes = record.notes ? `${record.notes} | ${note}` : note;

    await record.save();
    res.status(200).json({ success: true, data: record });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error during worker check-out' });
  }
};

// ==========================================
// 3. SUPERVISOR PENDING SYNC: CHECK-IN (3rd API - Offline Sync)
// ==========================================
exports.supervisorCreatePendingCheckIn = async (req, res) => {
  const { workerId, location, dateTime } = req.body;

  if (!workerId || !req.file) {
    return res.status(400).json({ success: false, message: 'Worker ID and Photo are required' });
  }

  try {
    // Use the timestamp passed from the app (when photo was taken offline)
    const attendanceDate = dateTime ? new Date(dateTime) : new Date();
    
    const record = await Attendance.create({
      user: workerId,
      date: attendanceDate,
      status: 'pending', // IMPORTANT: Goes to Admin Pending Queue
      checkInTime: attendanceDate,
      checkInLocation: parseLocation(location),
      checkInSelfie: req.file.path, 
      notes: `Offline Sync by Supervisor: ${req.user.name}`
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Pending Sync Error:", err);
    res.status(500).json({ success: false, message: 'Server Error saving pending record' });
  }
};

// ==========================================
// 4. SUPERVISOR PENDING SYNC: CHECK-OUT (3rd API - Offline Sync)
// ==========================================
exports.supervisorCreatePendingCheckOut = async (req, res) => {
  const { workerId, location, dateTime } = req.body;

  if (!workerId || !req.file) {
    return res.status(400).json({ success: false, message: 'Worker ID and Photo are required' });
  }

  try {
    const attendanceDate = dateTime ? new Date(dateTime) : new Date();
    
    const startOfDay = new Date(attendanceDate);
    startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(attendanceDate);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Try to find existing record for that day
    let record = await Attendance.findOne({
      user: workerId,
      date: { $gte: startOfDay, $lt: endOfDay }
    });

    if (record) {
      // Existing record update, set status to pending for approval
      record.checkOutTime = attendanceDate;
      record.checkOutLocation = parseLocation(location);
      record.checkOutSelfie = req.file.path;
      record.status = 'pending'; 
      record.notes = (record.notes || "") + ` | Offline Out Sync by ${req.user.name}`;
      await record.save();
    } else {
      // No check-in found (maybe check-in was also offline and not synced yet?)
      record = await Attendance.create({
        user: workerId,
        date: attendanceDate,
        status: 'pending',
        checkOutTime: attendanceDate,
        checkOutLocation: parseLocation(location),
        checkOutSelfie: req.file.path,
        notes: `Offline Out (No CheckIn Found) by Supervisor: ${req.user.name}`
      });
    }

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Pending Out Sync Error:", err);
    res.status(500).json({ success: false, message: 'Server Error saving pending record' });
  }
};

// controllers/attendanceController.js

// ... (Existing imports and functions) ...

// 5. SELF ATTENDANCE: OFFLINE SYNC (PENDING)
// This saves the record as 'pending' so Admin must approve it.
exports.selfCreatePendingCheckIn = async (req, res) => {
  const { dateTime, location } = req.body;
  
  // Note: For self-attendance, req.user.id comes from the token
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  try {
    // Use the time provided by the app (when the photo was actually taken)
    const attendanceDate = dateTime ? new Date(dateTime) : new Date();
    
    const record = await Attendance.create({
      user: req.user.id, 
      date: attendanceDate,
      status: 'pending', // <--- Goes to Admin Queue
      checkInTime: attendanceDate,
      checkInLocation: parseLocation(location),
      checkInSelfie: req.file.path, 
      notes: `Offline Self-Sync: ${req.user.name}`
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Self Pending Sync Error:", err);
    res.status(500).json({ success: false, message: 'Server Error saving pending record' });
  }
};

// 6. SELF ATTENDANCE: OFFLINE CHECK-OUT SYNC (PENDING)
exports.selfCreatePendingCheckOut = async (req, res) => {
  const { dateTime, location } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  try {
    const attendanceDate = dateTime ? new Date(dateTime) : new Date();
    
    // Find today's record
    const startOfDay = new Date(attendanceDate);
    startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(attendanceDate);
    endOfDay.setDate(endOfDay.getDate() + 1);

    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: startOfDay, $lt: endOfDay }
    });

    if (record) {
      record.checkOutTime = attendanceDate;
      record.checkOutLocation = parseLocation(location);
      record.checkOutSelfie = req.file.path;
      record.status = 'pending'; // Set to pending for Admin review
      record.notes = (record.notes || "") + ` | Offline Self-Out Sync`;
      await record.save();
    } else {
      // Create new if no check-in found
      record = await Attendance.create({
        user: req.user.id,
        date: attendanceDate,
        status: 'pending',
        checkOutTime: attendanceDate,
        checkOutLocation: parseLocation(location),
        checkOutSelfie: req.file.path,
        notes: `Offline Self-Out (No CheckIn found)`
      });
    }

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Self Pending Out Sync Error:", err);
    res.status(500).json({ success: false, message: 'Server Error saving pending record' });
  }
};


// 5. SELF ATTENDANCE: OFFLINE SYNC (PENDING)
// This saves the record as 'pending' so Admin must approve it.
exports.selfCreatePendingCheckIn = async (req, res) => {
  const { dateTime, location } = req.body;
  
  // Note: For self-attendance, req.user.id comes from the token
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  try {
    // Use the time provided by the app (when the photo was actually taken)
    const attendanceDate = dateTime ? new Date(dateTime) : new Date();
    
    const record = await Attendance.create({
      user: req.user.id, 
      date: attendanceDate,
      status: 'pending', // <--- Goes to Admin Queue
      checkInTime: attendanceDate,
      checkInLocation: parseLocation(location),
      checkInSelfie: req.file.path, 
      notes: `Offline Self-Sync: ${req.user.name}`
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Self Pending Sync Error:", err);
    res.status(500).json({ success: false, message: 'Server Error saving pending record' });
  }
};

// 6. SELF ATTENDANCE: OFFLINE CHECK-OUT SYNC (PENDING)
exports.selfCreatePendingCheckOut = async (req, res) => {
  const { dateTime, location } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  try {
    const attendanceDate = dateTime ? new Date(dateTime) : new Date();
    
    // Find today's record
    const startOfDay = new Date(attendanceDate);
    startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(attendanceDate);
    endOfDay.setDate(endOfDay.getDate() + 1);

    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: startOfDay, $lt: endOfDay }
    });

    if (record) {
      record.checkOutTime = attendanceDate;
      record.checkOutLocation = parseLocation(location);
      record.checkOutSelfie = req.file.path;
      record.status = 'pending'; // Set to pending for Admin review
      record.notes = (record.notes || "") + ` | Offline Self-Out Sync`;
      await record.save();
    } else {
      // Create new if no check-in found
      record = await Attendance.create({
        user: req.user.id,
        date: attendanceDate,
        status: 'pending',
        checkOutTime: attendanceDate,
        checkOutLocation: parseLocation(location),
        checkOutSelfie: req.file.path,
        notes: `Offline Self-Out (No CheckIn found)`
      });
    }

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Self Pending Out Sync Error:", err);
    res.status(500).json({ success: false, message: 'Server Error saving pending record' });
  }
};

// --- EXISTING CONTROLLERS ---

exports.selfCheckIn = async (req, res) => {
  const { location } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true }
    }).sort({ checkInTime: -1 });

    if (record) {
      if (record.status === 'present' && record.checkOutTime == null) return res.status(400).json({ success: false, message: 'Already checked in today.' });
    }

    // Face verification (TEMPORARILY DISABLED FOR PRODUCTION TESTING)
    const SKIP_FACE_VERIFICATION = true; // Set to false to re-enable
    if (!SKIP_FACE_VERIFICATION && process.env.SKIP_FACE_VERIFICATION !== 'true') {
      if (user.profileImageUrl && req.file.path) {
        const isMatch = await verifyFace(user.profileImageUrl, req.file.path);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
      } else {
        console.warn('⚠️  Skipping face verification - profile image or check-in image missing');
      }
    } else {
      console.warn('⚠️  Face verification SKIPPED (temporarily disabled for testing)');
    }

    record = await Attendance.create({
      user: req.user.id,
      date: today,
      status: 'present',
      checkInTime: new Date(),
      checkInLocation: parseLocation(location),
      checkInSelfie: req.file.path,
      notes: 'Self check-in'
    });
    res.status(201).json({ success: true, data: record });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.selfCheckOut = async (req, res) => {
  const { location } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today, $lt: tomorrow },
      checkOutTime: { $exists: false }
    });

    if (!record || record.status !== 'present') return res.status(400).json({ success: false, message: 'Worker not checked in.' });
    if (record.checkOutTime) return res.status(400).json({ success: false, message: 'Already checked out.' });

    // Face verification (TEMPORARILY DISABLED FOR PRODUCTION TESTING)
    const SKIP_FACE_VERIFICATION = true; // Set to false to re-enable
    if (!SKIP_FACE_VERIFICATION && process.env.SKIP_FACE_VERIFICATION !== 'true') {
      const user = await User.findById(req.user.id);
      if (user.profileImageUrl) {
        const isMatch = await verifyFace(user.profileImageUrl, req.file.path);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
      }
    } else {
      console.warn('⚠️  Face verification SKIPPED (temporarily disabled for testing)');
    }

    record.checkOutTime = new Date();
    record.checkOutLocation = parseLocation(location);
    record.checkOutSelfie = req.file.path;
    await record.save();

    res.status(200).json({ success: true, data: record });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const presentStats = await Attendance.aggregate([
      { $match: { date: { $gte: today, $lt: tomorrow } } },
      {
        $group: {
          _id: '$user',
          status: { $first: '$status' }
        }
      }
    ]);

    const absentCount = await User.countDocuments({
      role: { $in: ['worker'] },
      isActive: true,
      _id: { $nin: presentStats.map(stat => stat._id) }
    });

    const leaveCount = await Attendance.countDocuments({
      date: { $gte: today, $lt: tomorrow },
      status: 'leave',
    });

    const rejectedCount = await Attendance.countDocuments({
      date: { $gte: today, $lt: tomorrow },
      status: 'rejected',
    });

    const pendingCount = await Attendance.countDocuments({
      date: { $gte: today, $lt: tomorrow },
      status: 'pending',
    });

    const summary = { present: presentStats.length, absent: absentCount, leave: leaveCount, pending: pendingCount, rejected: rejectedCount };

    const totalStaff = await User.countDocuments({
      role: { $in: ['worker', 'supervisor', 'management'] },
      isActive: true
    });

    summary.absent = totalStaff - summary.present - summary.leave;
    if (summary.absent < 0) summary.absent = 0;

    res.status(200).json({ success: true, data: summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getPendingAttendance = async (req, res) => {
  try {
    const records = await Attendance.find({ status: 'pending' })
      .populate('user', 'name userId profileImageUrl');
    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.approveAttendance = async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    record.status = 'present';
    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.rejectAttendance = async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    record.status = 'rejected';
    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getDailyStatusReport = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const workers = await User.find(
      { role: 'worker', isActive: true },
      'name userId profileImageUrl'
    ).lean();

    const todayRecords = await Attendance.find({
      date: { $gte: today, $lt: tomorrow }
    });

    const attendanceMap = new Map();
    todayRecords.forEach(record => {
      attendanceMap.set(record.user.toString(), record.status);
    });

    const report = workers.map(worker => {
      const status = attendanceMap.get(worker._id.toString()) || 'absent';
      return { ...worker, status };
    });

    res.status(200).json({ success: true, count: report.length, data: report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.markWorkerAttendance = async (req, res) => {
  const { workerId } = req.body;
  if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required' });

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingRecord = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow }
    });

    if (existingRecord) {
      if (existingRecord.status === 'present') {
        return res.status(400).json({ success: false, message: 'Worker already marked present' });
      }
      existingRecord.status = 'present';
      existingRecord.checkInTime = new Date();
      existingRecord.notes = `Marked present by supervisor: ${req.user.name}`;
      await existingRecord.save();
      return res.status(200).json({ success: true, data: existingRecord });
    }

    const attendanceRecord = await Attendance.create({
      user: workerId,
      date: today,
      checkInTime: new Date(),
      status: 'present',
      notes: `Marked present by supervisor: ${req.user.name}`
    });

    res.status(201).json({ success: true, data: attendanceRecord });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};