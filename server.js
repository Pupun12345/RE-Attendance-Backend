// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan')
const connectDB = require('./config/db');

// Load env vars
dotenv.config({ path: './.env' });

// Connect to Database
connectDB();

// Route files
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const complaintRoutes = require('./routes/complaints');
const holidayRoutes = require('./routes/holidays');
const overtimeRoutes = require('./routes/overtime');
const reportRoutes = require('./routes/reports');
const setupRoutes = require('./routes/setup');
const dataExportRoutes = require('./routes/dataExport');
const emailRoutes = require('./routes/emails');

const app = express();

// Enable CORS
app.use(cors());

// Body parser - Increase limit for base64 image uploads (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));


app.use(morgan('dev'));

// Mount routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/complaints', complaintRoutes);
app.use('/api/v1/holidays', holidayRoutes);
app.use('/api/v1/overtime', overtimeRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/setup', setupRoutes);
app.use('/api/v1/export', dataExportRoutes);
app.use('/api/v1/emails', emailRoutes);

// Simple test route
app.get('/', (req, res) => {
  res.send('SmartCare API is running...');
});

const PORT = process.env.PORT || 5000;



app.listen(
  PORT,
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
);