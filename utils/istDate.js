// utils/istDate.js
// Single source of truth for India-time (UTC+5:30) date handling.
// The app device, this server (Cloud Run) and any dev machine running it
// locally can each be on a different system timezone, so any date logic
// that relies on "local time" is unreliable. Everything here is explicit
// about IST instead.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Turns any date-ish input into that calendar day's midnight in IST.
// - "2026-01-26" or "2026-01-26T..." (date-only prefix): treated as the
//   IST calendar date directly - unambiguous, no conversion needed.
// - Anything else (a full timestamp, epoch ms, Date object): converted to
//   the IST calendar day that moment falls on.
function toISTMidnight(dateInput) {
  if (!dateInput) return null;

  const dateOnlyMatch = String(dateInput).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return new Date(`${y}-${m}-${d}T00:00:00.000+05:30`);
  }

  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) return null;
  return toISTMidnight(getDateOnlyStringIST(parsed));
}

// Returns YYYY-MM-DD for the IST calendar day a moment falls on.
function getDateOnlyStringIST(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const istShifted = new Date(d.getTime() + IST_OFFSET_MS);
  const y = istShifted.getUTCFullYear();
  const m = String(istShifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istShifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// dd-MM-yyyy, ready to render as-is on any client.
function formatDateIST(date) {
  const dateStr = getDateOnlyStringIST(date);
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}

// hh:mm AM/PM, ready to render as-is on any client.
function formatTimeIST(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const istShifted = new Date(d.getTime() + IST_OFFSET_MS);
  let hours = istShifted.getUTCHours();
  const minutes = String(istShifted.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

// Start of "today" in IST, as a real Date (UTC-backed, correct instant).
function getTodayIST() {
  return toISTMidnight(getDateOnlyStringIST(new Date()));
}

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// 0 = Sunday ... 6 = Saturday, for the IST calendar day a moment falls on.
function getDayOfWeekIST(date) {
  const dateStr = getDateOnlyStringIST(date);
  if (!dateStr) return null;
  // toISTMidnight gives a real instant at IST midnight; reading it back
  // through the IST-shift trick above gives the correct IST weekday
  // regardless of what timezone this process itself is running in.
  const shifted = new Date(toISTMidnight(dateStr).getTime() + IST_OFFSET_MS);
  return shifted.getUTCDay();
}

function isSundayIST(date) {
  return getDayOfWeekIST(date) === 0;
}

function getDayNameIST(date) {
  const dow = getDayOfWeekIST(date);
  return dow === null ? null : DAY_NAMES[dow];
}

module.exports = {
  toISTMidnight,
  getDateOnlyStringIST,
  formatDateIST,
  formatTimeIST,
  getTodayIST,
  getDayOfWeekIST,
  isSundayIST,
  getDayNameIST,
};
