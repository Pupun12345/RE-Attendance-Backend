const cron = require("node-cron");
const Overtime = require("../models/Overtime");

const autoApproveOvertime = () => {
  // Run every day at 2 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("⏰ Running overtime auto-approval cron...");

    try {
      // Date 6 days ago
      const sixDaysAgo = new Date();
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

      // Update all pending records older than 6 days
      const result = await Overtime.updateMany(
        {
          status: "pending",
          createdAt: { $lte: sixDaysAgo },
        },
        {
          $set: { status: "approved" },
        },
      );

      console.log(`✅ Auto-approved ${result.modifiedCount} overtime records`);
    } catch (err) {
      console.error("❌ Cron error:", err);
    }
  });
};

module.exports = autoApproveOvertime;
