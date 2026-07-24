// controllers/attendanceController.js
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const mongoose = require("mongoose");
const {
  RekognitionClient,
  CompareFacesCommand,
} = require("@aws-sdk/client-rekognition");
const { bucket } = require("../config/initializeGCS");
const path = require("path");
const fs = require("fs");

// --- 1. INITIALIZE AWS REKOGNITION ---
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// --- 3. HELPER: Download Image (Smart GCS/Local Detection) ---
async function getImageBuffer(imageUrl) {
  try {
    // Check if it's a GCS URL or local file path
    if (imageUrl.startsWith("https://storage.googleapis.com/")) {
      // GCS URL - extract filename and download from bucket
      const fileName = imageUrl.split("/").pop();
      const [buffer] = await bucket.file(fileName).download();
      return buffer;
    } else {
      // Local file path - read from filesystem
      const localPath = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
      const absolutePath = path.join(process.cwd(), localPath);
      const buffer = await fs.promises.readFile(absolutePath);
      return buffer;
    }
  } catch (error) {
    console.error(`Error downloading/reading image:`, error.message);
    console.error(`Image URL/Path: ${imageUrl}`);

    // More specific error messages
    if (imageUrl.startsWith("https://storage.googleapis.com/")) {
      throw new Error(
        `Failed to retrieve image from cloud storage: ${error.message}`,
      );
    } else {
      throw new Error(`Failed to read local image file: ${error.message}`);
    }
  }
}

// --- 3.4. HELPER: Get Today in IST (UTC+5:30) ---
// Returns today's date at 00:00:00 IST (stored as UTC internally)
function getTodayIST() {
  const now = new Date();
  // Get current time in IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const istTime = new Date(now.getTime() + istOffset);

  // Get date string in IST (YYYY-MM-DD)
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istTime.getUTCDate()).padStart(2, "0");
  const istDateStr = `${year}-${month}-${day}`;

  // Create date at 00:00:00 IST (which is 18:30:00 previous day UTC)
  const todayIST = new Date(istDateStr + "T00:00:00.000+05:30");

  return todayIST;
}

// --- 3.4.1. HELPER: Get Start of Day in IST for a given date ---
// Converts any date to start of day (00:00:00) in IST
function getStartOfDayIST(date) {
  // Convert date to IST
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffset);

  // Get date string in IST (YYYY-MM-DD)
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istTime.getUTCDate()).padStart(2, "0");
  const istDateStr = `${year}-${month}-${day}`;

  // Create date at 00:00:00 IST
  return new Date(istDateStr + "T00:00:00.000+05:30");
}

// --- 3.5. HELPER: Parse Location Data ---
// This function can accept location as:
// 1. An object: { longitude, latitude, address } or { lng, lat, address }
// 2. A JSON string
// 3. A string in format "lat,lng"
// 4. Or it can extract from req.body directly if location is not provided
function parseLocation(location, reqBody = null) {
  // If location is undefined or null, try to construct from req.body fields
  if (!location && reqBody) {
    const lat = reqBody.lat || reqBody.latitude;
    const lng = reqBody.lng || reqBody.longitude;
    const address = reqBody.address || reqBody.location;

    if (lat && lng) {
      return {
        longitude: String(lng),
        latitude: String(lat),
        address: address || null,
      };
    }
    // If only address is provided, return it
    if (address && address.trim() !== "") {
      return {
        longitude: null,
        latitude: null,
        address: address,
      };
    }
    return null;
  }

  // If location is undefined or null, return null
  if (!location) {
    return null;
  }

  // If location is already an object, validate and return it
  if (typeof location === "object" && !Array.isArray(location)) {
    // Ensure it has the expected structure
    return {
      longitude: location.longitude || location.lng || null,
      latitude: location.latitude || location.lat || null,
      address: location.address || null,
    };
  }

  // If location is a JSON string, parse it
  if (typeof location === "string") {
    // Handle empty string
    if (location.trim() === "") {
      // Try to get from reqBody if available
      if (reqBody) {
        const lat = reqBody.lat || reqBody.latitude;
        const lng = reqBody.lng || reqBody.longitude;
        const address = reqBody.address;
        if (lat && lng) {
          return {
            longitude: String(lng),
            latitude: String(lat),
            address: address || null,
          };
        }
      }
      return null;
    }
    try {
      const parsed = JSON.parse(location);
      // Validate parsed object
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          longitude: parsed.longitude || parsed.lng || null,
          latitude: parsed.latitude || parsed.lat || null,
          address: parsed.address || null,
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
          address: reqBody?.address || null,
        };
      }
      // If it's just an address string, return it
      if (location.trim().length > 0) {
        return {
          longitude: reqBody?.lng || reqBody?.longitude || null,
          latitude: reqBody?.lat || reqBody?.latitude || null,
          address: location,
        };
      }
      return null;
    }
  }

  return null;
}

// --- 4. HELPER: Compare Faces (AWS Rekognition) ---
async function verifyFace(sourceImageUrl, targetImageUrl) {
  console.log("🔍 FACE VERIFICATION DEBUG:");
  console.log("   Source Image (Profile):", sourceImageUrl);
  console.log("   Target Image (Check-in):", targetImageUrl);

  // Face verification is ALWAYS ENABLED for security
  console.log("🔒 Face verification is ENABLED - processing images...");

  try {
    console.log("📥 Downloading/Reading source image...");
    const sourceBuffer = await getImageBuffer(sourceImageUrl);
    console.log("✅ Source image loaded, size:", sourceBuffer.length, "bytes");

    console.log("📥 Downloading/Reading target image...");
    const targetBuffer = await getImageBuffer(targetImageUrl);
    console.log("✅ Target image loaded, size:", targetBuffer.length, "bytes");

    // Validate image buffers
    if (!sourceBuffer || sourceBuffer.length === 0) {
      console.error("❌ Source image buffer is empty or invalid");
      return { success: false, error: "Source image is empty or invalid" };
    }

    if (!targetBuffer || targetBuffer.length === 0) {
      console.error("❌ Target image buffer is empty or invalid");
      return { success: false, error: "Target image is empty or invalid" };
    }

    // Check if images are too small (likely corrupted)
    if (sourceBuffer.length < 1000 || targetBuffer.length < 1000) {
      console.error("❌ One or both images are too small (likely corrupted)");
      return {
        success: false,
        error:
          "Images are too small or corrupted. Please use higher quality images.",
      };
    }

    console.log("🤖 Sending to AWS Rekognition for comparison...");
    const command = new CompareFacesCommand({
      SourceImage: { Bytes: sourceBuffer },
      TargetImage: { Bytes: targetBuffer },
      SimilarityThreshold: 80, // Lowered from 90 to 80 for better flexibility
    });

    const response = await rekognition.send(command);
    console.log(
      "📊 AWS Rekognition Response:",
      JSON.stringify(response, null, 2),
    );

    // Detailed AWS Response Breakdown
    console.log("🔬 AWS RESPONSE ANALYSIS:");
    console.log("   📊 Full Response Structure:");
    console.log(
      "     - FaceMatches array length:",
      response.FaceMatches?.length || 0,
    );
    console.log(
      "     - UnmatchedFaces array length:",
      response.UnmatchedFaces?.length || 0,
    );
    console.log("     - SourceImageFace:", !!response.SourceImageFace);

    if (response.FaceMatches && response.FaceMatches.length > 0) {
      console.log("   🎯 DETAILED MATCH ANALYSIS:");
      response.FaceMatches.forEach((match, index) => {
        console.log(`   ✅ Match ${index + 1}:`);
        console.log(`      - Similarity: ${match.Similarity.toFixed(2)}%`);
        console.log(
          `      - Face Confidence: ${match.Face.Confidence.toFixed(2)}%`,
        );
        console.log(`      - Face BoundingBox:`, match.Face.BoundingBox);
        if (match.Face.Quality) {
          console.log(`      - Face Quality:`, {
            Brightness: match.Face.Quality.Brightness?.toFixed(2),
            Sharpness: match.Face.Quality.Sharpness?.toFixed(2),
          });
        }
        console.log(
          `      - Face Landmarks Count: ${match.Face.Landmarks?.length || 0}`,
        );
        if (match.Face.Pose) {
          console.log(`      - Face Pose:`, match.Face.Pose);
        }
      });

      const match = response.FaceMatches[0];
      const similarity = match.Similarity.toFixed(2);
      console.log(
        `🎯 FINAL RESULT: FACE MATCH SUCCESS! Similarity: ${similarity}%`,
      );
      console.log(
        "   Best Match Confidence:",
        match.Face.Confidence.toFixed(2) + "%",
      );
      return {
        success: true,
        similarity: parseFloat(similarity),
        confidence: match.Face.Confidence,
      };
    } else {
      console.log("❌ NO FACE MATCH - Different faces detected");
      console.log("   Unmatched faces:", response.UnmatchedFaces?.length || 0);

      if (response.UnmatchedFaces && response.UnmatchedFaces.length > 0) {
        console.log("   🚫 UNMATCHED FACES DETAILS:");
        response.UnmatchedFaces.forEach((unmatched, index) => {
          console.log(`   🚫 Unmatched Face ${index + 1}:`);
          console.log(
            `      - Confidence: ${unmatched.Confidence?.toFixed(2)}%`,
          );
          console.log(`      - BoundingBox:`, unmatched.BoundingBox);
          if (unmatched.Quality) {
            console.log(`      - Quality:`, {
              Brightness: unmatched.Quality.Brightness?.toFixed(2),
              Sharpness: unmatched.Quality.Sharpness?.toFixed(2),
            });
          }
        });
      }

      if (response.SourceImageFace) {
        console.log("   📷 SOURCE IMAGE FACE DETAILS:");
        console.log(
          `      - Confidence: ${response.SourceImageFace.Confidence?.toFixed(2)}%`,
        );
        console.log(
          `      - BoundingBox:`,
          response.SourceImageFace.BoundingBox,
        );
      }
      return {
        success: false,
        error: "Face verification failed: faces do not match",
      };
    }
  } catch (error) {
    console.error("🚨 Face verification ERROR:", error.message);
    console.error("🔍 Error details:", {
      name: error.name,
      code: error.code || error.$metadata?.httpStatusCode,
      message: error.message,
    });

    if (
      error.name === "InvalidParameterException" ||
      error.message.includes("InvalidParameter")
    ) {
      console.error(
        "   🚫 FACE DETECTION ISSUE: No clear face detected in one or both images",
      );
      console.error("   💡 SUGGESTIONS:");
      console.error(
        "      - Ensure the image shows a clear, front-facing face",
      );
      console.error("      - Check lighting - avoid shadows or overexposure");
      console.error("      - Make sure the face is not too small in the image");
      console.error("      - Avoid blurry or low-quality images");
      return {
        success: false,
        error:
          "No clear face detected in the image. Please take a clearer photo with good lighting and ensure your face is clearly visible.",
      };
    }

    if (error.name === "InvalidS3ObjectException") {
      console.error(
        "   📁 IMAGE ACCESS ISSUE: Cannot access one of the images",
      );
      return {
        success: false,
        error:
          "Cannot access the image files. Please try uploading the image again.",
      };
    }

    if (error.name === "InvalidImageFormatException") {
      console.error("   🖼️ IMAGE FORMAT ISSUE: Unsupported image format");
      return {
        success: false,
        error: "Unsupported image format. Please use JPEG or PNG images.",
      };
    }

    if (error.name === "ImageTooLargeException") {
      console.error("   📏 IMAGE SIZE ISSUE: Image is too large");
      return {
        success: false,
        error: "Image is too large. Please use a smaller image (max 15MB).",
      };
    }

    if (
      error.name === "ProvisionedThroughputExceededException" ||
      error.name === "ThrottlingException"
    ) {
      console.error("   ⏱️ RATE LIMITING: Too many requests to AWS");
      return {
        success: false,
        error: "Service temporarily busy. Please try again in a moment.",
      };
    }

    console.error("   ❓ Unexpected error occurred, returning false");
    return {
      success: false,
      error:
        "Face verification service encountered an unexpected error. Please try again.",
    };
  }
}

// ==========================================
// 1. SUPERVISOR CHECK-IN FOR WORKER (Normal Network)
// ==========================================
exports.supervisorCheckInWorker = async (req, res) => {
  const { workerId, location } = req.body;

  // Validation
  if (!workerId) {
    return res
      .status(400)
      .json({ success: false, message: "Worker ID is required" });
  }

  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "Photo is required" });
  }

  const today = getTodayIST();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // Smart worker lookup - check both ObjectId and userId fields
    let worker;
    if (mongoose.Types.ObjectId.isValid(workerId)) {
      // If valid ObjectId, search by _id
      worker = await User.findById(workerId);
    } else {
      // If not ObjectId, search by userId field
      worker = await User.findOne({ userId: workerId });
    }

    if (!worker) {
      return res
        .status(404)
        .json({ success: false, message: "Worker not found" });
    }

    // Most recent record check - use worker's actual ObjectId
    let record = await Attendance.findOne({
      user: worker._id,
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true },
    }).sort({ checkInTime: -1 });

    if (record) {
      if (record.status === "present" && !record.checkOutTime) {
        return res.status(400).json({
          success: false,
          message: "Already checked in. Please check out first.",
        });
      }

      // Case 2: Already completed check-in & check-out
      if (record.status === "present" && record.checkOutTime) {
        return res.status(400).json({
          success: false,
          message: "You have already completed attendance for today.",
        });
      }
    }
    // Face verification - MANDATORY for attendance approval
    if (!worker.profileImageUrl) {
      return res.status(400).json({
        success: false,
        message:
          "Worker profile image is required for face verification. Please contact admin to upload profile image.",
      });
    }

    if (!req.file.path) {
      return res.status(400).json({
        success: false,
        message: "Check-in photo is required for face verification.",
      });
    }

    const verificationResult = await verifyFace(
      worker.profileImageUrl,
      req.file.path,
    );

    if (!verificationResult.success) {
      return res.status(404).json({
        success: false,
        message:
          verificationResult.error ||
          "Face verification failed. Please try again with a clearer photo.",
      });
    }

    const parsedLocation = parseLocation(location, req.body);

    record = await Attendance.create({
      user: worker._id, // Use worker's ObjectId for consistency
      date: today,
      status: "present",
      checkInTime: new Date(),
      checkInLocation: parsedLocation,
      checkInSelfie: req.file.path,
      notes: `Punch In by Supervisor: ${req.user.name}`,
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Supervisor Check-In Error:", err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Server Error during worker check-in",
    });
  }
};

// ==========================================
// 2. SUPERVISOR CHECK-OUT FOR WORKER (Normal Network)
// ==========================================
exports.supervisorCheckOutWorker = async (req, res) => {
  const { workerId, location } = req.body;

  if (!workerId)
    return res
      .status(400)
      .json({ success: false, message: "Worker ID is required" });
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Photo is required" });

  const today = getTodayIST();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // Smart worker lookup - check both ObjectId and userId fields
    let worker;
    if (mongoose.Types.ObjectId.isValid(workerId)) {
      // If valid ObjectId, search by _id
      worker = await User.findOne({ _id: workerId });
    } else {
      // If not ObjectId, search by userId field
      worker = await User.findOne({ userId: workerId });
    }

    if (!worker) {
      return res
        .status(400)
        .json({ success: false, message: "Worker not found" });
    }

    let record = await Attendance.findOne({
      user: worker._id, // Use worker's ObjectId
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true },
      checkOutTime: { $exists: false },
    });

    if (!record) {
      return res
        .status(400)
        .json({ success: false, message: "Worker has not checked in today." });
    }
    if (record.status !== "present") {
      return res.status(400).json({
        success: false,
        message: `Worker attendance status is '${record.status}', not 'present'. Cannot check out.`,
      });
    }
    if (record.checkOutTime) {
      return res
        .status(400)
        .json({ success: false, message: "Worker already checked out." });
    }

    // Face verification for supervisor checkout worker
    if (process.env.SKIP_FACE_VERIFICATION !== "true") {
      if (worker.profileImageUrl && req.file.path) {
        const verificationResult = await verifyFace(
          worker.profileImageUrl,
          req.file.path,
        );

        if (!verificationResult.success) {
          return res.status(404).json({
            success: false,
            message:
              verificationResult.error ||
              "Face verification failed. Please try again with a clearer photo.",
          });
        }
      }
    }

    // Update record
    const parsedCheckOutLocation = parseLocation(location, req.body);

    record.checkOutTime = new Date();
    record.checkOutLocation = parsedCheckOutLocation;
    record.checkOutSelfie = req.file.path;

    const note = `Punch Out by Supervisor: ${req.user.name}`;
    record.notes = record.notes ? `${record.notes} | ${note}` : note;

    await record.save();

    res.status(200).json({ success: true, data: record });
  } catch (err) {
    console.error("Supervisor Check-Out Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server Error during worker check-out",
    });
  }
};

exports.selfCheckIn = async (req, res) => {
  const { location } = req.body;
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Selfie is required" });

  const today = getTodayIST();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today, $lt: tomorrow },
      checkInTime: { $exists: true },
    }).sort({ checkInTime: -1 });

    if (record) {
      if (record.status === "present" && !record.checkOutTime) {
        return res.status(400).json({
          success: false,
          message: "Already checked in. Please check out first.",
        });
      }

      // Case 2: Already completed check-in & check-out
      if (record.status === "present" && record.checkOutTime) {
        return res.status(400).json({
          success: false,
          message: "You have already completed attendance for today.",
        });
      }
    }

    // Face verification for self check-in
    if (process.env.SKIP_FACE_VERIFICATION !== "true") {
      if (user.profileImageUrl && req.file.path) {
        const verificationResult = await verifyFace(
          user.profileImageUrl,
          req.file.path,
        );

        if (!verificationResult.success) {
          return res.status(404).json({
            success: false,
            message:
              verificationResult.error ||
              "Face verification failed. Please try again with a clearer photo.",
          });
        }
      }
    }

    record = await Attendance.create({
      user: req.user.id,
      date: today,
      status: "present",
      checkInTime: new Date(),
      checkInLocation: parseLocation(location, req.body),
      checkInSelfie: req.file.path,
      notes: "Self check-in",
    });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error("Self Check-In Error:", err.message);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.selfCheckOut = async (req, res) => {
  const { location } = req.body;
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "Selfie is required" });

  const today = getTodayIST();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    let record = await Attendance.findOne({
      user: req.user.id,
      date: { $gte: today, $lt: tomorrow },
      checkOutTime: { $exists: false },
    });

    if (!record || record.status !== "present")
      return res
        .status(400)
        .json({ success: false, message: "Worker not checked in." });
    if (record.checkOutTime)
      return res
        .status(400)
        .json({ success: false, message: "Already checked out." });

    // Face verification for self check-out
    if (process.env.SKIP_FACE_VERIFICATION !== "true") {
      const user = await User.findById(req.user.id);
      if (user.profileImageUrl && req.file.path) {
        const verificationResult = await verifyFace(
          user.profileImageUrl,
          req.file.path,
        );

        if (!verificationResult.success) {
          return res.status(404).json({
            success: false,
            message:
              verificationResult.error ||
              "Face verification failed. Please try again with a clearer photo.",
          });
        }
      }
    }

    record.checkOutTime = new Date();
    record.checkOutLocation = parseLocation(location, req.body);
    record.checkOutSelfie = req.file.path;
    await record.save();

    res.status(200).json({ success: true, data: record });
  } catch (err) {
    console.error("Self Check-Out Error:", err.message);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const today = getTodayIST();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // These are independent of each other - run them in parallel instead of
    // serially awaiting each one.
    const [presentStats, leaveCount, totalStaff] = await Promise.all([
      Attendance.aggregate([
        { $match: { date: { $gte: today, $lt: tomorrow } } },
        {
          $group: {
            _id: "$user",
            status: { $first: "$status" },
          },
        },
      ]),
      Attendance.countDocuments({
        date: { $gte: today, $lt: tomorrow },
        status: "leave",
      }),
      User.countDocuments({
        role: { $in: ["worker", "supervisor", "management"] },
        isActive: true,
      }),
    ]);

    const summary = {
      present: presentStats.length,
      absent: Math.max(0, totalStaff - presentStats.length - leaveCount),
      leave: leaveCount,
    };

    res.status(200).json({ success: true, data: summary });
  } catch (err) {
    console.error("Get Today Summary Error:", err.message);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getDailyStatusReport = async (req, res) => {
  try {
    const today = getTodayIST();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const workers = await User.find(
      { role: "worker", isActive: true },
      "name userId profileImageUrl",
    ).lean();

    const todayRecords = await Attendance.find({
      date: { $gte: today, $lt: tomorrow },
    });

    const attendanceMap = new Map();
    todayRecords.forEach((record) => {
      attendanceMap.set(record.user.toString(), record.status);
    });

    const report = workers.map((worker) => {
      const status = attendanceMap.get(worker._id.toString()) || "absent";
      return { ...worker, status };
    });

    res.status(200).json({ success: true, count: report.length, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.markWorkerAttendance = async (req, res) => {
  const { workerId } = req.body;
  if (!workerId)
    return res
      .status(400)
      .json({ success: false, message: "Worker ID is required" });

  try {
    const today = getTodayIST();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingRecord = await Attendance.findOne({
      user: workerId,
      date: { $gte: today, $lt: tomorrow },
    });

    if (existingRecord) {
      if (existingRecord.status === "present") {
        return res
          .status(400)
          .json({ success: false, message: "Worker already marked present" });
      }
      existingRecord.status = "present";
      existingRecord.checkInTime = new Date();
      existingRecord.notes = `Marked present by supervisor: ${req.user.name}`;
      await existingRecord.save();
      return res.status(200).json({ success: true, data: existingRecord });
    }

    const attendanceRecord = await Attendance.create({
      user: workerId,
      date: today,
      checkInTime: new Date(),
      status: "present",
      notes: `Marked present by supervisor: ${req.user.name}`,
    });

    res.status(201).json({ success: true, data: attendanceRecord });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
