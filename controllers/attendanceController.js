// controllers/attendanceController.js
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { RekognitionClient, CompareFacesCommand } = require("@aws-sdk/client-rekognition");
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// --- 1. INITIALIZE AWS REKOGNITION ---
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- 2. INITIALIZE GOOGLE CLOUD STORAGE (For Internal Access) ---
const gcs = new Storage({
  projectId: 'reattendance', // Your Project ID
  keyFilename: path.join(__dirname, '../config/gcs-key.json') 
});

// ✅ CORRECTED BUCKET NAME (Matches middleware/upload.js)
const bucketName = 'ray-engineering-attendance-image'; 
const bucket = gcs.bucket(bucketName);

// --- 3. HELPER: Download Image Directly from GCS Bucket ---
async function getImageBuffer(imageUrl) {
  try {
    // Extract the filename from the URL
    // URL format: https://storage.googleapis.com/BUCKET_NAME/FILENAME
    const fileName = imageUrl.split('/').pop(); 

    console.log(`Downloading ${fileName} from bucket: ${bucketName}...`);

    // Download the file contents into memory
    const [buffer] = await bucket.file(fileName).download();
    return buffer;

  } catch (error) {
    console.error(`Error downloading image from GCS:`, error.message);
    throw new Error('Failed to retrieve image from secure storage.');
  }
}

// --- 4. HELPER: Compare Two Faces ---
async function verifyFace(sourceImageUrl, targetImageUrl) {
  try {
    // Download both images securely
    const sourceBuffer = await getImageBuffer(sourceImageUrl);
    const targetBuffer = await getImageBuffer(targetImageUrl);

    // Send to AWS Rekognition
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

// --- CONTROLLER: SELF CHECK-IN ---
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
    if (!user.profileImageUrl) return res.status(400).json({ success: false, message: 'No reference photo found. Contact admin.' });

    // Perform Facial Recognition
    const isMatch = await verifyFace(user.profileImageUrl, req.file.path);

    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Face verification failed. You are not the registered user.' 
      });
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
      record.notes = 'Self check-in (Biometric Verified)';
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
        notes: 'Self check-in (Biometric Verified)'
      });
      res.status(201).json({ success: true, data: record });
    }
  } catch (err) {
    console.error(err);
    const msg = err.message.includes('No face detected') ? err.message : 'Server Error during check-in';
    res.status(500).json({ success: false, message: msg });
  }
};

// --- CONTROLLER: SELF CHECK-OUT ---
exports.selfCheckOut = async (req, res) => {
  const { location } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'Selfie is required' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.profileImageUrl) return res.status(400).json({ success: false, message: 'No reference photo found.' });

    const isMatch = await verifyFace(user.profileImageUrl, req.file.path);

    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Face verification failed. Check-out denied.' 
      });
    }

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
    const msg = err.message.includes('No face detected') ? err.message : 'Server Error during check-out';
    res.status(500).json({ success: false, message: msg });
  }
};

// --- HELPER FUNCTIONS ---

// @desc    Get Today's Summary (For Admin Dashboard)
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
    console.error("Summary Error:", err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Get Pending Attendance Requests
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

// @desc    Approve Pending Attendance
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

// @desc    Reject Pending Attendance
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

// @desc    Get Daily Status Report (For Supervisor)
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

// @desc    Mark Worker Attendance (Manual by Supervisor)
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