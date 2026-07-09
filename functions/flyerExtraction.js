"use strict";

// Anthropic tool input_schema — forces Claude to return structured event data.
const FLYER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    title:        { type: "string", description: "Event/series title as printed on the flyer" },
    description:  { type: "string", description: "1-2 sentence summary suitable for the public signup page" },
    modality:     { type: "string", enum: ["virtual", "in-person", "hybrid"] },
    location:     { type: "string", description: "'Zoom' for virtual; venue name otherwise" },
    dayOfWeek:    { type: ["string", "null"] },
    timeStart:    { type: ["string", "null"], description: "e.g. '5:00 PM'" },
    timeEnd:      { type: ["string", "null"], description: "e.g. '6:00 PM'" },
    contactPhone: { type: ["string", "null"] },
    website:      { type: ["string", "null"] },
    sessions: {
      type: "array",
      description: "One entry per dated session on the flyer",
      items: {
        type: "object",
        properties: {
          date:        { type: "string", description: "'Month D, YYYY' — ALWAYS include the year; infer it if not printed" },
          time:        { type: ["string", "null"], description: "e.g. '5:00 PM'" },
          topic:       { type: "string" },
          description: { type: "string" },
        },
        required: ["date", "topic"],
      },
    },
    confidence: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
  },
  required: ["title", "description", "sessions"],
};

function hasYear(s) { return /\b20\d{2}\b/.test(String(s || "")); }

// Map extracted sessions -> canonical signupDates[] the CMS/parsers expect:
// "Month D, YYYY, TIME - Topic". `fallbackTime` (the event-level start time) is
// used when a session has no per-session time — the model often reports the time
// once for the whole flyer rather than on each session. Falls back gracefully if
// a field is missing.
function sessionsToSignupDates(sessions, fallbackTime) {
  if (!Array.isArray(sessions)) return [];
  const ft = String(fallbackTime || "").trim();
  return sessions.map((s) => {
    const date = String((s && s.date) || "").trim();
    const time = (String((s && s.time) || "").trim()) || ft;
    const topic = String((s && s.topic) || "").trim();
    let label = date;
    if (time) label += ", " + time;
    if (topic) label += " - " + topic;
    return label.trim();
  }).filter(Boolean);
}

module.exports = { FLYER_TOOL_SCHEMA, hasYear, sessionsToSignupDates };
