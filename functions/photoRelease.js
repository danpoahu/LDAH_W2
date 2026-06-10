const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const PHOTO_RELEASE_VERSION = "06/2026; v1";
const PHOTO_RELEASE_TEXT = `__DRAFT_DELIVERED_TO_DANIEL_BEFORE_LIVE__`; // replaced in Task 11 with approved copy

// Base URL for the public signing link (STAGE value; switched to live in Task 11)
const SIGNING_BASE_URL = "https://danpoahu.github.io/LDAH_W2/STAGE/photo-release.html";

const LAA_EMAIL = "LSalvani@LDAHawaii.org";

function newToken() { return crypto.randomBytes(16).toString("hex"); }

async function lookupUidByEmail(email) {
  const snap = await admin.firestore().collection("userRoles")
    .where("email", "==", email).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

module.exports = { PHOTO_RELEASE_VERSION, PHOTO_RELEASE_TEXT, SIGNING_BASE_URL, LAA_EMAIL, newToken, lookupUidByEmail };
