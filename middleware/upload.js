// middleware/upload.js
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');

// --- 1. Configuration ---

// Initialize GCS Storage
const gcs = new Storage({
  projectId: 'reattendance', // <-- Make sure this is replaced
  keyFilename: path.join(__dirname, '../config/gcs-key.json') 
});

// Your bucket name
const bucketName = 'reattendance-profile-images'; // <-- Corrected bucket name
const bucket = gcs.bucket(bucketName);

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
const uploadToGCS = (req, res, next) => {
  // If no file was uploaded, skip to the controller
  if (!req.file) {
    return next();
  }

  // Create a unique filename for GCS
  const fileName = `complaint_${req.user.id}_${Date.now()}${path.extname(req.file.originalname)}`;
  
  // Create a "blob" (file object) in GCS
  const blob = bucket.file(fileName);

  // Create a stream to write the file to GCS
  const blobStream = blob.createWriteStream({
    resumable: false,
    gzip: true,
  });

  blobStream.on('error', (err) => {
    console.error("GCS Upload Error:", err); 
    return next(err);
  });

  blobStream.on('finish', () => {
    // 1. Get the public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;

    // 2. Attach the URL to req.file.path
    req.file.path = publicUrl;

    // 3. Continue to the next middleware
    next();
  });

  // End the stream by writing the file's buffer
  blobStream.end(req.file.buffer);
};

// --- 3. Export the Middlewares ---
module.exports = {
  uploadImage: upload.single('profileImage'), // For user profiles
  // --- ADD THIS LINE ---
  uploadComplaintImage: upload.single('complaintImage'), // For complaints
  uploadAttendanceImage: upload.single('attendanceImage'),
  uploadToGCS: uploadToGCS,
};