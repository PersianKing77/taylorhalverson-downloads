// Maps a short, public-facing slug (what goes in the URL:
// /download/<slug>) to the exact object key (filename) sitting in the
// taylorhalverson-paid-resources S3 bucket.
//
// IMPORTANT: the value on the right must match the S3 object key EXACTLY —
// same capitalization, same spaces, same file extension — or the presigned
// URL will 404. Easiest way to get the exact names: open the
// taylorhalverson-paid-resources bucket in the AWS S3 console and copy each
// filename directly from the object list.
//
// The slug on the left is yours to choose — keep it short, lowercase,
// hyphenated, and stable (once a download link is out in an email or a
// Beehiiv post, changing the slug breaks that link).

export const RESOURCES = {
  // --- General Conference Lessons (April 2026) — Teacher Circle sessions ---
  "april-2026-saturday-morning": "SaturdayMorningSession_TeacherCircle_April2026.pdf",
  "april-2026-saturday-afternoon": "SaturdayAfternoonSession_TeacherCircle_April2026.pdf",
  "april-2026-sunday-morning": "SundayMorningSession_TeacherCircle_April2026.pdf",
  "april-2026-sunday-afternoon": "SundayAfternoonSession_TeacherCircle_April2026.pdf",
  "april-2026-all-sessions-bundle": "The25MinuteTeacher_ConferenceEdition_FullVolume_April2026.pdf",
  "april-2026-learners-guide": "Learners Guide for April 2026 General Conference.pdf",

  // --- General Conference Lessons (April 2026) — Learner Group sessions ---
  "april-2026-learner-saturday-morning": "SaturdayMorning_LearnerGroup_April2026.pdf",
  "april-2026-learner-saturday-afternoon": "SaturdayAfternoon_LearnerGroup_April2026.pdf",
  "april-2026-learner-sunday-morning": "SundayMorning_LearnerGroup_April2026.pdf",
  "april-2026-learner-sunday-afternoon": "SundayAfternoon_LearnerGroup_April2026.pdf",

  // --- Discussion Question Banks (Old Testament 2026) ---
  "question-bank-ages-3-7": "CFM Questions for OT 2026.Primary Ages 3-7.Halverson.pdf",
  "question-bank-ages-8-11": "CFM Questions for OT 2026.Primary Ages 8-11.Halverson.pdf",
  "question-bank-ages-12-18": "CFM Questions for OT 2026.Youth Ages 12-18.Halverson.pdf",
  "question-bank-adult-sunday-school": "CFM Questions for OT 2026.Adult Sunday School.Halverson.pdf",
  "question-bank-elders-relief-society": "CFM Questions for OT 2026.Elders Quorum Relief Society.Halverson.pdf",
  "question-bank-all-five-bundle": "CFM Questions for OT 2026.All Questions.Halverson.pdf",

  // --- For the Strength of Youth (FSY) ---
  "fsy-sept-oct-2026": "FSY-Teaching-Resources-2026-Sept-Oct.pdf",
};

/**
 * Look up the S3 object key for a given slug.
 * Returns null if the slug isn't recognized (caller should 404).
 */
export function resolveResourceKey(slug) {
  return RESOURCES[slug] || null;
}
