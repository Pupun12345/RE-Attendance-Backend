// controllers/dataExportController.js
// Simple GET API to export all production data in a single JSON response

const axios = require('axios');

const PRODUCTION_URL = process.env.PRODUCTION_API_URL || 'https://re-attendance-backend-264138863806.europe-west1.run.app';

// Helper function to get auth token
async function getAuthToken(email, password) {
  try {
    const loginRes = await axios.post(`${PRODUCTION_URL}/api/v1/auth/login`, {
      email: email.trim(),
      password: password.trim()
    });

    if (loginRes.data.success && loginRes.data.token) {
      return loginRes.data.token;
    }
    return null;
  } catch (err) {
    console.error('Auth error:', err.message);
    return null;
  }
}

// Export all production data in a single JSON response
exports.exportAllData = async (req, res) => {
  try {
    const { email, password } = req.query;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Admin email and password required as query parameters: ?email=admin@example.com&password=password123'
      });
    }

    console.log('📥 Exporting All Production Data...');

    // Login to production API
    const token = await getAuthToken(email, password);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Failed to authenticate with production API'
      });
    }

    const allData = {
      users: [],
      attendance: [],
      complaints: [],
      holidays: [],
      overtime: [],
      errors: []
    };

    // Fetch Users
    try {
      const usersRes = await axios.get(`${PRODUCTION_URL}/api/v1/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      console.log(`   📊 Users API Response: success=${usersRes.data.success}, keys=${Object.keys(usersRes.data).join(', ')}`);
      
      // Handle different response formats: {users} or {data}
      const usersArray = usersRes.data.users || usersRes.data.data || [];
      
      if (usersRes.data.success) {
        allData.users = usersArray.map(user => ({
          userId: user.userId,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          designation: user.designation || user.role,
          isActive: user.isActive !== undefined ? user.isActive : true,
          profileImageUrl: user.profileImageUrl || null,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }));
        console.log(`   ✅ Fetched ${allData.users.length} users`);
      } else {
        console.log(`   ⚠️  Users API returned success=false`);
        allData.errors.push(`Users: API returned success=false`);
      }
    } catch (err) {
      allData.errors.push(`Users: ${err.message}`);
      console.error(`   ❌ Error fetching users: ${err.message}`);
      if (err.response) {
        console.error(`   Response status: ${err.response.status}`);
        console.error(`   Response data:`, JSON.stringify(err.response.data, null, 2));
      }
    }

    // Fetch Attendance - Get ALL records (start from a very early date)
    try {
      const endDate = new Date().toISOString().split('T')[0];
      // Start from 2 years ago to get all records
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 2);
      const startDateStr = startDate.toISOString().split('T')[0];

      console.log(`   📅 Fetching attendance from ${startDateStr} to ${endDate}`);

      const attendanceRes = await axios.get(
        `${PRODUCTION_URL}/api/v1/reports/attendance/daily?startDate=${startDateStr}&endDate=${endDate}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      // Handle different response formats: {data} or {attendance}
      const attendanceArray = attendanceRes.data.data || attendanceRes.data.attendance || [];

      if (attendanceRes.data.success && attendanceArray.length > 0) {
        allData.attendance = attendanceArray.map(record => ({
          user: record.user ? {
            userId: record.user.userId,
            name: record.user.name,
            role: record.user.role
          } : null,
          date: record.date,
          checkInTime: record.checkInTime,
          checkOutTime: record.checkOutTime,
          status: record.status || 'absent',
          checkInLocation: record.checkInLocation || null,
          checkOutLocation: record.checkOutLocation || null,
          checkInSelfie: record.checkInSelfie || null,
          checkOutSelfie: record.checkOutSelfie || null,
          notes: record.notes || null,
          ot: record.ot || 0,
          overtime: record.overtime || 0,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt
        }));
        console.log(`   ✅ Fetched ${allData.attendance.length} attendance records`);
      } else {
        console.log(`   ⚠️  No attendance records found or empty response`);
      }
    } catch (err) {
      allData.errors.push(`Attendance: ${err.message}`);
      console.error(`   ❌ Error fetching attendance: ${err.message}`);
      if (err.response) {
        console.error(`   Response status: ${err.response.status}`);
        console.error(`   Response data:`, JSON.stringify(err.response.data, null, 2));
      }
    }

    // Fetch Complaints
    try {
      const complaintsRes = await axios.get(`${PRODUCTION_URL}/api/v1/complaints`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log(`   📊 Complaints API Response: success=${complaintsRes.data.success}, keys=${Object.keys(complaintsRes.data).join(', ')}`);

      // Handle different response formats: {complaints} or {data}
      const complaintsArray = complaintsRes.data.complaints || complaintsRes.data.data || [];

      if (complaintsRes.data.success) {
        allData.complaints = complaintsArray.map(complaint => ({
          user: complaint.user ? {
            userId: complaint.user.userId || complaint.user,
            name: complaint.user.name || null
          } : null,
          title: complaint.title,
          description: complaint.description,
          imageUrl: complaint.imageUrl || null,
          status: complaint.status || 'pending',
          submittedBy: complaint.submittedBy ? {
            userId: complaint.submittedBy.userId || complaint.submittedBy,
            name: complaint.submittedBy.name || null
          } : null,
          createdAt: complaint.createdAt,
          updatedAt: complaint.updatedAt
        }));
        console.log(`   ✅ Fetched ${allData.complaints.length} complaints`);
      } else {
        console.log(`   ⚠️  Complaints API returned success=false`);
        allData.errors.push(`Complaints: API returned success=false`);
      }
    } catch (err) {
      allData.errors.push(`Complaints: ${err.message}`);
      console.error(`   ❌ Error fetching complaints: ${err.message}`);
      if (err.response) {
        console.error(`   Response status: ${err.response.status}`);
        console.error(`   Response data:`, JSON.stringify(err.response.data, null, 2));
      }
    }

    // Fetch Holidays
    try {
      const holidaysRes = await axios.get(`${PRODUCTION_URL}/api/v1/holidays`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log(`   📊 Holidays API Response: success=${holidaysRes.data.success}, keys=${Object.keys(holidaysRes.data).join(', ')}`);

      // Handle different response formats: {holidays} or {data}
      const holidaysArray = holidaysRes.data.holidays || holidaysRes.data.data || [];

      if (holidaysRes.data.success) {
        allData.holidays = holidaysArray;
        console.log(`   ✅ Fetched ${allData.holidays.length} holidays`);
      } else {
        console.log(`   ⚠️  Holidays API returned success=false`);
        allData.errors.push(`Holidays: API returned success=false`);
      }
    } catch (err) {
      allData.errors.push(`Holidays: ${err.message}`);
      console.warn(`   ⚠️  Could not fetch holidays: ${err.message}`);
      if (err.response) {
        console.error(`   Response status: ${err.response.status}`);
        console.error(`   Response data:`, JSON.stringify(err.response.data, null, 2));
      }
    }

    // Fetch Overtime - Get ALL records (no status filter)
    try {
      const overtimeRes = await axios.get(`${PRODUCTION_URL}/api/v1/overtime`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log(`   📊 Overtime API Response: success=${overtimeRes.data.success}, keys=${Object.keys(overtimeRes.data).join(', ')}`);

      // Handle different response formats: {data} or {overtime}
      const overtimeArray = overtimeRes.data.data || overtimeRes.data.overtime || [];

      if (overtimeRes.data.success) {
        allData.overtime = overtimeArray;
        console.log(`   ✅ Fetched ${allData.overtime.length} overtime records`);
      } else {
        console.log(`   ⚠️  Overtime API returned success=false`);
        allData.errors.push(`Overtime: API returned success=false`);
      }
    } catch (err) {
      allData.errors.push(`Overtime: ${err.message}`);
      console.warn(`   ⚠️  Could not fetch overtime: ${err.message}`);
      if (err.response) {
        console.error(`   Response status: ${err.response.status}`);
        console.error(`   Response data:`, JSON.stringify(err.response.data, null, 2));
      }
    }

    // Calculate totals
    const totalRecords = allData.users.length + 
                        allData.attendance.length + 
                        allData.complaints.length + 
                        allData.holidays.length + 
                        allData.overtime.length;

    res.status(200).json({
      success: true,
      message: `Exported ${totalRecords} records from production database`,
      summary: {
        users: allData.users.length,
        attendance: allData.attendance.length,
        complaints: allData.complaints.length,
        holidays: allData.holidays.length,
        overtime: allData.overtime.length,
        total: totalRecords
      },
      data: allData
    });

  } catch (err) {
    console.error('Export all data error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to export production data'
    });
  }
};

