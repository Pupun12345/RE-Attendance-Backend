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

// --- 4. HELPER: Compare Faces (AWS Rekognition) ---
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
// ✅ NEW: SUPERVISOR CHECK-IN FOR WORKER
// ==========================================
exports.supervisorCheckInWorker = async (req, res) => {
  const { workerId, location } = req.body;
  console.log('Worker ID:', workerId);
  console.log('Photo Path:', req.file.path);

  if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const worker = await User.findById(workerId);
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });

    // 2. Check for existing attendance
    // let record = await Attendance.findOne({
    //   user: workerId,
    //   date: { $gte: today, $lt: tomorrow },
    //   checkInTime: { $exists: true },

    // });

    // most recent record check with checkedin time
    let record = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true },
    }).sort({ checkInTime: -1 });


    console.log('Existing Record:', record);


    if (record) {
      if (record.status === 'present' && record.checkOutTime == null) {
        return res.status(400).json({ success: false, message: 'Worker already checked in today.' });
      }
    }
    //face verification

    const isMatch = await verifyFace(worker.profileImageUrl, req.file.path);

    console.log('Face Match Result:', isMatch);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });




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
    // Return explicit error to help with "Error Uploading Data" messages
    res.status(500).json({ success: false, message: err.message || 'Server Error during worker check-in' });
  }
};

// ==========================================
// 4. SUPERVISOR CHECK-OUT FOR WORKER
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
    // Face verification

    const worker = await User.findById(workerId);
    const isMatch = await verifyFace(worker.profileImageUrl, req.file.path);
    console.log('Face Match Result:', isMatch);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });


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

    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true }
    }).sort({ checkInTime: -1 });

    // Simple face verify if profile image exists




    if (record) {
      if (record.status === 'present' && record.checkOutTime == null) return res.status(400).json({ success: false, message: 'Already checked in today.' });

    }

    if (user.profileImageUrl) {
      const isMatch = await verifyFace(user.profileImageUrl, req.file.path);
      if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
    }


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

    // Face verification
    const user = await User.findById(req.user.id);
    if (user.profileImageUrl) {
      const isMatch = await verifyFace(user.profileImageUrl, req.file.path);
      if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });
    }

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

    const presentStats = await Attendance.aggregate([
      { $match: { date: { $gte: today, $lt: tomorrow } } },

      // unique users only
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



    console.log(presentStats.length, absentCount);

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