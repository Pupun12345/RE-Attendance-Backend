// Quick database check script
const mongoose = require('mongoose');
const User = require('./models/User');

async function checkUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/re-attendance');
    console.log('📊 Connected to MongoDB');

    // Get all users and check their profileImageUrl
    const users = await User.find({}, 'name userId profileImageUrl email role').lean();
    
    console.log(`\n👥 Found ${users.length} users:\n`);
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.name} (${user.userId})`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Profile Image URL: ${user.profileImageUrl || '❌ No image URL'}`);
      console.log(`   Email: ${user.email || 'N/A'}`);
      console.log('   ---');
    });

    await mongoose.connection.close();
    console.log('\n✅ Database check complete');

  } catch (error) {
    console.error('❌ Database Error:', error.message);
  }
}

if (require.main === module) {
  checkUsers();
}

module.exports = checkUsers;