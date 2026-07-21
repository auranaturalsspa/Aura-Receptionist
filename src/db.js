const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "bookings.json");

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ bookings: [], escalated: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Business hours used to generate candidate slots: 9am - 9pm, hourly.
// (Spa is open till late/11pm, but we stop taking new hour-long bookings at 9pm
// so the last session finishes with buffer before close. Adjust freely.)
const OPEN_HOUR = 9;
const LAST_BOOKING_HOUR = 21; // 9pm

function generateDaySlots() {
  const slots = [];
  for (let h = OPEN_HOUR; h <= LAST_BOOKING_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

// date format expected: "YYYY-MM-DD"
function checkAvailability(date) {
  const db = readDB();
  const allSlots = generateDaySlots();
  const takenSlots = db.bookings
    .filter((b) => b.date === date && b.status !== "cancelled")
    .map((b) => b.time);
  return allSlots.filter((s) => !takenSlots.includes(s));
}

function bookAppointment({ name, phone, service, date, time, mode, notes }) {
  const db = readDB();

  // Re-check the slot is still free (avoid double-booking race)
  const alreadyTaken = db.bookings.some(
    (b) => b.date === date && b.time === time && b.status !== "cancelled"
  );
  if (alreadyTaken) {
    return { success: false, reason: "slot_taken" };
  }

  const booking = {
    id: `bk_${Date.now()}`,
    name,
    phone,
    service,
    date,
    time,
    mode: mode || "in-spa", // "in-spa" or "mobile"
    notes: notes || "",
    status: "confirmed",
    reminderSent: false,
    createdAt: new Date().toISOString(),
  };

  db.bookings.push(booking);
  writeDB(db);
  return { success: true, booking };
}

function getUpcomingBookingsNeedingReminder() {
  const db = readDB();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return db.bookings.filter((b) => {
    if (b.status !== "confirmed" || b.reminderSent) return false;
    const bookingDateTime = new Date(`${b.date}T${b.time}:00`);
    return bookingDateTime > now && bookingDateTime <= in24h;
  });
}

function markReminderSent(bookingId) {
  const db = readDB();
  const booking = db.bookings.find((b) => b.id === bookingId);
  if (booking) booking.reminderSent = true;
  writeDB(db);
}

// --- Escalation flag: while a conversation is escalated, the AI stays quiet
// and a human handles it, until the human (or client) resets it. ---
function isEscalated(phone) {
  const db = readDB();
  return !!db.escalated[phone];
}

function setEscalated(phone, reason) {
  const db = readDB();
  db.escalated[phone] = { reason, at: new Date().toISOString() };
  writeDB(db);
}

function clearEscalated(phone) {
  const db = readDB();
  delete db.escalated[phone];
  writeDB(db);
}

module.exports = {
  checkAvailability,
  bookAppointment,
  getUpcomingBookingsNeedingReminder,
  markReminderSent,
  isEscalated,
  setEscalated,
  clearEscalated,
};
