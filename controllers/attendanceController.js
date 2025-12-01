// controllers/attendanceController.js
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { RekognitionClient, CompareFacesCommand } = require("@aws-sdk/client-rekognition");
const axios = require('axios');

// --- 1. INITIALIZE AWS REKOGNITION ---
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- 2. HELPER: Download Image from GCS URL to Buffer ---
async function getImageBuffer(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    console.error(`Error downloading image from ${url}:`, error.message);
    throw new Error('Failed to retrieve image for facial recognition.');
  }
}

// --- 3. HELPER: Compare Two Faces ---
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
    if (!user || !user.profileImageUrl) {
      return res.status(400).json({ success: false, message: 'No reference photo found.' });
    }

    // Perform Facial Recognition
    const isMatch = await verifyFace(user.profileImageUrl, req.file.path);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Face verification failed.' });
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
    res.status(500).json({ success: false, message: err.message || 'Server Error' });
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
    if (!isMatch) return res.status(400).json({ success: false, message: 'Face verification failed.' });

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
    res.status(500).json({ success: false, message: err.message || 'Server Error' });
  }
};

// --- KEEP YOUR EXISTING HELPER FUNCTIONS BELOW ---
exports.getDailyStatusReport = async (req, res) => { /* ... Keep code ... */ };
exports.markWorkerAttendance = async (req, res) => { /* ... Keep code ... */ };
exports.getTodaySummary = async (req, res) => { /* ... Keep code ... */ };
exports.getPendingAttendance = async (req, res) => { /* ... Keep code ... */ };
exports.approveAttendance = async (req, res) => { /* ... Keep code ... */ };
exports.rejectAttendance = async (req, res) => { /* ... Keep code ... */ };