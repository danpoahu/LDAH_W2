// Title, urgency and follow-up date for the task a calendar request raises.
// Pure: no Firestore, so it can be tested on its own.
//
// Why: a request that arrived Mon night for a Sat event sat as
// "New calendar request from X for 2026-10-31" with a 3-day follow-up, i.e.
// due two days before the event and easy to read past. The title now says
// when the event is and how soon, and anything inside a week is urgent
// (pinned first in My Day) and due today.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const URGENT_WITHIN_DAYS = 7;

function _ymd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

// "12:00" -> "12pm", "16:30" -> "4:30pm". Anything unparseable is returned as typed.
function formatTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return String(t || "").trim();
  const h = +m[1], min = m[2];
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (min === "00" ? "" : ":" + min) + suffix;
}

// todayKey is today's HST date as YYYY-MM-DD.
function calendarRequestTask({ requesterName, preferredDate, preferredTime, todayKey, defaultFollowUp }) {
  const name = requesterName || "Unknown requester";
  const ev = _ymd(preferredDate);
  const today = _ymd(todayKey);
  if (ev === null || today === null) {
    return { summary: "New calendar request from " + name, urgent: false, followUpDate: defaultFollowUp };
  }
  const days = Math.round((ev - today) / 86400000);
  const d = new Date(ev);
  const when = DAYS[d.getUTCDay()] + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate()
    + (preferredTime ? " at " + formatTime(preferredTime) : "");

  if (days < 0) {
    return {
      summary: "Calendar request from " + name + " - event date " + when + " has already passed",
      urgent: false, followUpDate: defaultFollowUp,
    };
  }
  if (days < URGENT_WITHIN_DAYS) {
    const soon = days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : "in " + days + " days";
    return {
      summary: "EVENT IS " + when + " (" + soon + ") - calendar request from " + name + ", reply ASAP",
      urgent: true, followUpDate: todayKey,
    };
  }
  return {
    summary: "Calendar request from " + name + " - event is " + when + " (in " + days + " days)",
    urgent: false, followUpDate: defaultFollowUp,
  };
}

module.exports = { calendarRequestTask, formatTime, URGENT_WITHIN_DAYS };
