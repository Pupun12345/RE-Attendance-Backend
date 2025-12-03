// controllers/attendanceController.js
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { RekognitionClient, CompareFacesCommand } = require("@aws-sdk/client-rekognition");
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// --- 1. INITIALIZE AWS REKOGNITION (Optional use) ---
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- 2. INITIALIZE GCS ---
const gcs = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: path.join(__dirname, '../config/gcs-key.json') 
});
const bucketName = 'ray-engineering-attendance-image'; // Ensure this matches middleware
const bucket = gcs.bucket(bucketName);

// --- Helper: Download Image from GCS ---
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

// --- Helper: Compare Faces ---
async function verifyFace(sourceImageUrl, targetImageUrl) {
  try {
    const sourceBuffer = await getImageBuffer(sourceImageUrl);
    const targetBuffer = await getImageBuffer(targetImageUrl);

    const command = new CompareFacesCommand({
      SourceImage: { Bytes: sourceBuffer },
      TargetImage: { Bytes: targetBuffer },
      SimilarityThreshold: 90, 
    });

    const response = await rekognition.send(command);
    return response.FaceMatches && response.FaceMatches.length > 0;
  } catch (error) {
    console.error("AWS Rekognition Error:", error);
    // Return false instead of crashing if face detection fails
    return false;
  }
}

// ==========================================
// ✅ NEW: SUPERVISOR CHECK-IN FOR WORKER
// ==========================================
exports.supervisorCheckInWorker = async (req, res) => {
  const { workerId, location } = req.body;
  
  if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // 1. Verify Worker Exists
    const worker = await User.findById(workerId);
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });

    // 2. Check for existing attendance
    let record = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow }
    });

    if (record) {
      if (record.status === 'present') {
        return res.status(400).json({ success: false, message: 'Worker already checked in today.' });
      }
      // If status was absent/leave, update it
      record.status = 'present';
      record.checkInTime = new Date();
      record.checkInLocation = location;
      record.checkInSelfie = req.file.path; // GCS URL
      record.notes = `Punch In by Supervisor: ${req.user.name}`;
      await record.save();
      return res.status(200).json({ success: true, data: record });
    }

    // 3. Create new record
    record = await Attendance.create({
      user: workerId,
      date: today,
      status: 'present',
      checkInTime: new Date(),
      checkInLocation: location,
      checkInSelfie: req.file.path,
      notes: `Punch In by Supervisor: ${req.user.name}`
    });

    res.status(201).json({ success: true, data: record });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error during worker check-in' });
  }
};

// ==========================================
// ✅ NEW: SUPERVISOR CHECK-OUT FOR WORKER
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
    // 1. Find today's record
    let record = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow }
    });

    if (!record || record.status !== 'present') {
      return res.status(400).json({ success: false, message: 'Worker has not checked in today.' });
    }
    if (record.checkOutTime) {
      return res.status(400).json({ success: false, message: 'Worker already checked out.' });
    }

    // 2. Update record
    record.checkOutTime = new Date();
    record.checkOutLocation = location;
    record.checkOutSelfie = req.file.path;
    
    // Append to notes
    const note = `Punch Out by Supervisor: ${req.user.name}`;
    record.notes = record.notes ? `${record.notes} | ${note}` : note;
    
    await record.save();
    res.status(200).json({ success: true, data: record });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error during worker check-out' });
  }
};

// --- EXISTING CONTROLLERS (Unchanged logic) ---

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
    
    // Simple face verify if profile image exists
    if (user.profileImageUrl) {
       // const isMatch = await verifyFace(user.profileImageUrl, req.file.path);
       // if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
    }

    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today, $lt: tomorrow }
    });

    if (record) {
      if (record.status === 'present') return res.status(400).json({ success: false, message: 'Already checked in today.' });
      record.status = 'present';
      record.checkInTime = new Date();
      record.checkInLocation = location;
      record.checkInSelfie = req.file.path;
      record.notes = 'Self check-in';
      await record.save();
      res.status(200).json({ success: true, data: record });
    } else {
      record = await Attendance.create({
        user: req.user.id,
        date: today,
        status: 'present',
        checkInTime: new Date(),
        checkInLocation: location,
        checkInSelfie: req.file.path,
        notes: 'Self check-in'
      });
      res.status(201).json({ success: true, data: record });
    }
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
      date: { $gte: today, $lt: tomorrow }
    });

    if (!record || record.status !== 'present') return res.status(400).json({ success: false, message: 'You have not checked in today.' });
    if (record.checkOutTime) return res.status(400).json({ success: false, message: 'Already checked out.' });

    record.checkOutTime = new Date();
    record.checkOutLocation = location;
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

    const stats = await Attendance.aggregate([
      { $match: { date: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    
    const summary = { present: 0, absent: 0, leave: 0, pending: 0, rejected: 0 };
    stats.forEach(stat => {
      if (summary.hasOwnProperty(stat._id)) summary[stat._id] = stat.count;
    });

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