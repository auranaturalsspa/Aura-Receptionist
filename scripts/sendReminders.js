// Run this once a day (Railway/Render "Cron Job" or a scheduled task).
// It checks for confirmed bookings happening in the next 24 hours and sends
// each client a WhatsApp reminder, then marks it as sent so they don't get
// reminded twice.

require("dotenv").config();
const db = require("../src/db");
const { sendWhatsAppMessage } = require("../src/whatsapp");

async function sendReminders() {
  const due = db.getUpcomingBookingsNeedingReminder();

  if (due.length === 0) {
    console.log("No reminders to send right now.");
    return;
  }

  for (const booking of due) {
    const message =
      `Hi ${booking.name}! 🌸 Just a friendly reminder from Aura Naturals & Wellness Spa - ` +
      `you have a *${booking.service}* booked for ${booking.date} at ${booking.time}` +
      `${booking.mode === "mobile" ? " (mobile/at-home session)" : ""}. ` +
      `We can't wait to pamper you! If you need to reschedule, just reply here.`;

    await sendWhatsAppMessage(booking.phone, message);
    db.markReminderSent(booking.id);
    console.log(`Reminder sent to ${booking.phone} for booking ${booking.id}`);
  }
}

sendReminders();
