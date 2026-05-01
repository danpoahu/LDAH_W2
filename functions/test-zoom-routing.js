// Verify the v119.5+ Zoom routing now driven by per-event zoomMode.
// Reads settings/zoomDefault, walks every active event/recurringEvent,
// applies pickZoomForEvent() the same way the deployed CFs do, and
// emails Daniel a side-by-side summary so the routing is auditable.
//
// Usage:
//   node test-zoom-routing.js          (dry run — prints to console)
//   node test-zoom-routing.js --send   (sends the summary email via Resend)

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
const { execSync } = require("child_process");

admin.initializeApp({
  credential: applicationDefault(),
  projectId: "ldah-932d5",
});

const db = admin.firestore();
const SEND = process.argv.includes("--send");
const TO_EMAIL = "danpellegrini63@gmail.com";

// MUST stay in sync with pickZoomForEvent() in functions/index.js.
function pickZoomForEvent(zoomDoc, event, collection) {
  if (!zoomDoc) return null;
  const hasNested = (s) => s && typeof s === "object" && (s.meetingUrl || s.meetingId || s.passcode);
  const programZoom = hasNested(zoomDoc.programZoom)
    ? zoomDoc.programZoom
    : ((zoomDoc.meetingUrl || zoomDoc.meetingId || zoomDoc.passcode)
        ? { meetingUrl: zoomDoc.meetingUrl || "", meetingId: zoomDoc.meetingId || "", passcode: zoomDoc.passcode || "" }
        : null);
  const eventZoom = hasNested(zoomDoc.eventZoom) ? zoomDoc.eventZoom : null;
  let mode;
  if (event && event.zoomMode === "program") mode = "program";
  else if (event && event.zoomMode === "event") mode = "event";
  else mode = (collection === "recurringEvents") ? "program" : "event";
  if (mode === "program") return programZoom || eventZoom;
  return eventZoom || programZoom;
}

function fmtSlot(z) {
  if (!z) return "<em>(not set)</em>";
  return `URL: <code>${z.meetingUrl || "(empty)"}</code><br>Meeting ID: <code>${z.meetingId || "(empty)"}</code><br>Passcode: <code>${z.passcode || "(empty)"}</code>`;
}

(async () => {
  console.log("Reading settings/zoomDefault…");
  const zSnap = await db.collection("settings").doc("zoomDefault").get();
  const zoomDoc = zSnap.exists ? (zSnap.data() || null) : null;
  if (!zoomDoc) { console.error("settings/zoomDefault missing"); process.exit(1); }

  // Resolve the two slots for display.
  const programResolved = pickZoomForEvent(zoomDoc, { zoomMode: "program" }, "events");
  const eventResolved   = pickZoomForEvent(zoomDoc, { zoomMode: "event" }, "events");

  // Walk every active event + recurringEvent and resolve per-event.
  const [evSnap, recSnap] = await Promise.all([
    db.collection("events").get(),
    db.collection("recurringEvents").get(),
  ]);

  const rows = [];
  function pushRow(collection, docId, data) {
    if (data.archived === true) return;
    if (collection === "recurringEvents" && data.active === false) return;
    const resolved = pickZoomForEvent(zoomDoc, data, collection);
    const useProgram = resolved && programResolved && resolved.meetingId === programResolved.meetingId;
    const defaultMode = (collection === "recurringEvents") ? "program" : "event";
    rows.push({
      collection,
      title: data.title || data.name || "(untitled)",
      zoomMode: data.zoomMode || `(unset → ${defaultMode})`,
      slot: useProgram ? "Program Zoom" : "Event Zoom",
      meetingId: resolved && resolved.meetingId ? resolved.meetingId : "(none)",
    });
  }
  evSnap.forEach((d) => pushRow("events", d.id, d.data() || {}));
  recSnap.forEach((d) => pushRow("recurringEvents", d.id, d.data() || {}));
  rows.sort((a, b) => (a.slot === b.slot ? a.title.localeCompare(b.title) : a.slot.localeCompare(b.slot)));

  console.log("\n=== Slot resolution ===");
  console.log("Program Zoom:", programResolved);
  console.log("Event Zoom:  ", eventResolved);
  console.log("\n=== Per-event routing ===");
  rows.forEach((r) => console.log(`- [${r.slot}] ${r.title}  (collection=${r.collection}, zoomMode=${r.zoomMode}, meetingId=${r.meetingId})`));

  const tableRows = rows.map((r) => {
    const slotStyle = r.slot === "Program Zoom"
      ? "background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;"
      : "background:#FFF7ED;color:#9A3412;border:1px solid #FED7AA;";
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">${r.title}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:.82rem;color:#64748B;">${r.collection}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:.82rem;">${r.zoomMode}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:700;${slotStyle}">${r.slot}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:monospace;font-size:.82rem;">${r.meetingId}</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#1f2937;">
      <h2 style="color:#004E7C;margin:0 0 8px;">Zoom Routing Verification</h2>
      <p style="color:#475569;margin:0 0 20px;">Per-event routing via <code>event.zoomMode</code>. Connect-Gen is flagged <code>zoomMode=program</code>; everything else defaults to Event Zoom.</p>

      <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="font-weight:700;color:#0C4A6E;margin-bottom:8px;font-size:1.05rem;">Program Zoom slot</div>
        <div style="font-size:.82rem;color:#64748B;margin-bottom:8px;">For events flagged <code>zoomMode=program</code> (Connect-Gen).</div>
        ${fmtSlot(programResolved)}
      </div>

      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:16px;margin-bottom:18px;">
        <div style="font-weight:700;color:#9A3412;margin-bottom:8px;font-size:1.05rem;">Event Zoom slot</div>
        <div style="font-size:.82rem;color:#64748B;margin-bottom:8px;">For everything else — Learning Labs, Parent Talk Cafe, all one-off events.</div>
        ${fmtSlot(eventResolved)}
      </div>

      <h3 style="color:#0F172A;margin:18px 0 10px;font-size:1.05rem;">Every active event/program — what it'll route to</h3>
      <table style="width:100%;border-collapse:collapse;font-size:.92rem;">
        <thead>
          <tr style="background:#F1F5F9;">
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #CBD5E1;">Title</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #CBD5E1;">Collection</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #CBD5E1;">zoomMode</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #CBD5E1;">Routes to</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #CBD5E1;">Meeting ID</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>

      <p style="color:#94A3B8;font-size:.78rem;margin-top:20px;">Generated by test-zoom-routing.js on ${new Date().toLocaleString()} HST</p>
    </div>
  `;

  if (!SEND) {
    console.log("\n(dry run — re-run with --send to email Daniel)");
    process.exit(0);
  }

  const apiKey = execSync("firebase functions:secrets:access RESEND_API_KEY --project ldah-932d5", { encoding: "utf8" }).trim();
  if (!apiKey) { console.error("Could not read RESEND_API_KEY."); process.exit(1); }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "LDAH <registration@ldahawaii.org>",
      to: [TO_EMAIL],
      subject: "Zoom Routing Verification — per-event zoomMode",
      html,
    }),
  });
  if (!resp.ok) { console.error("Resend error:", resp.status, await resp.text()); process.exit(1); }
  const result = await resp.json();
  console.log("\nSent to", TO_EMAIL, "— Resend id:", result.id);
})().catch((err) => { console.error(err); process.exit(1); });
