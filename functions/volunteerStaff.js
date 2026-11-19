"use strict";
/* Volunteer help requests: LDAH staff vs volunteers (Daniel 2026-11-18).
   "have the staff volunteer cards be re-categorized as staff, then when you ask
   how many volunteers ask how many LDAH staff and how many volunteer ... If more
   than requested staff sign up count the extras as volunteers and lower that count."

   A volunteer card is staff when it is marked isStaff:true, or its email is an
   @ldahawaii.org address. The client (DAN) carries a copy of these two rules. */

function isStaffCard(v) {
  if (!v) return false;
  if (v.isStaff === true) return true;
  if (v.isStaff === false) return false;
  return /@ldahawaii\.org$/i.test(String(v.email || "").trim());
}

function _n(x) { const v = parseInt(x, 10); return isFinite(v) && v > 0 ? v : 0; }

/* participants: [{ isStaff, confirmed }]. A request saved before the split has
   no staffNeeded/volunteersNeeded; then every confirmed person counts against
   maxVolunteers as before. */
function countNeeds(req, participants) {
  const r = req || {};
  const ps = (participants || []).filter((p) => p && p.confirmed === true);
  const staffConf = ps.filter((p) => p.isStaff === true).length;
  const volConf = ps.length - staffConf;
  /* Both 0 (or blank) = no limit, same as maxVolunteers 0. */
  const split = (r.staffNeeded != null || r.volunteersNeeded != null) && (_n(r.staffNeeded) + _n(r.volunteersNeeded)) > 0;
  const staffNeeded = split ? _n(r.staffNeeded) : 0;
  const volunteersNeeded = split ? _n(r.volunteersNeeded) : _n(r.maxVolunteers);
  const extraStaff = split ? Math.max(0, staffConf - staffNeeded) : 0;
  const staffStill = split ? Math.max(0, staffNeeded - staffConf) : 0;
  const volFilled = split ? volConf + extraStaff : volConf + staffConf;
  const volStill = Math.max(0, volunteersNeeded - volFilled);
  return { split, staffNeeded, volunteersNeeded, staffConf, volConf, extraStaff, staffStill, volStill, volFilled };
}

/* "Rosie Rowe" -> "RR". */
function initials(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase()).join("").slice(0, 3);
}

module.exports = { isStaffCard, countNeeds, initials };
