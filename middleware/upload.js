// middleware/upload.js
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');
const {configDotenv} = require ('dotenv')
const { bucket } = require('../config/initializeGCS');

configDotenv()

// --- 1. Configuration ---

// Initialize GCS Storage


// Configure Multer to use memory storage
const multerStorage = multer.memoryStorage();

// Multer filter to allow images OR generic streams
const fileFilter = (req, file, cb) => {
  const isImage = file.mimetype.startsWith('image/');
  const isGenericStream = file.mimetype === 'application/octet-stream';

  if (isImage || isGenericStream) {
    cb(null, true); // Accept the file
  } else {
    console.warn(`File rejected: Invalid mimetype ${file.mimetype}`);
    cb('Error: Images Only!', false); // Reject it
  }
};

// Create the Multer upload instance
const upload = multer({
  storage: multerStorage,
  fileFilter: fileFilter,
});

// --- 2. Custom Middleware to Upload to GCS ---

// This middleware runs *after* multer processes the file
const uploadToGCS = async (req, res, next) => {
  console.log('uploadToGCS middleware triggered');
  console.log('req.file:', req.file);
  if (!req.file) return next();

  const fileName = `complaint_${req.user.id}_${Date.now()}${path.extname(req.file.originalname)}`;
  const file = bucket.file(fileName);

  try {
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
      resumable: false,
      // public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log(`File uploaded to GCS: ${publicUrl}`);
    req.file.path = publicUrl;
    next();
  } catch (error) {
    console.error('GCS Upload Error:', error);
    next(error);
  }
};


// --- 3. Export the Middlewares ---
module.exports = {
  uploadImage: upload.single('profileImage'), // For user profiles
  uploadComplaintImage: upload.single('complaintImage'), // For complaints
  uploadAttendanceImage: upload.single('attendanceImage'),
  uploadToGCS: uploadToGCS,
};