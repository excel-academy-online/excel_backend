#!/usr/bin/env node
/**
 * Import the WordPress/Tutor LMS export into Firestore.
 *
 *   node scripts/importWordpress.js <export-dir>            dry run
 *   node scripts/importWordpress.js <export-dir> --apply    writes to Firestore
 *
 * IMPORTANT: this writes the schema the existing API and dashboard already
 * read (see createProgramCourse / createLessonSession / uploadSessionContent
 * in controllers/course.controller.js) rather than a shape of its own.
 * Firestore already held 40 test courses in that shape; inventing a second
 * shape in the same collection is exactly the mistake that produced the
 * Mongo/Firestore split in the first place.
 *
 * WordPress            ->  Firestore
 *   course                 courses/{wp-<id>}
 *   topic                  an entry in that course's `lesson` array (a session)
 *   lesson                 an entry in that session's `content` array
 *   lesson video           a `medias` entry of type "video"
 *
 * Document ids are `wp-<wordpress id>`, so re-running updates rather than
 * duplicates.
 *
 * Enrolments are deliberately NOT written to `enrollments`: that collection
 * keys students by Firebase uid, and these students have no Firebase accounts
 * (their WordPress accounts were deleted). They go to `studentRecovery`
 * instead, keyed by the email that paid, so access can be restored when a
 * student signs up or asks.
 */
const fs = require("fs");
const path = require("path");

const DIR = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!DIR) {
  console.error("usage: node scripts/importWordpress.js <export-dir> [--apply]");
  process.exit(1);
}

const VIDEO_BASE =
  process.env.VIDEO_BASE_URL || "https://courses.excelacademyonline.com/wp-content/uploads";

/** The one real programme in Firestore; everything else there is test data. */
const ICAN_PROGRAM_ID = process.env.ICAN_PROGRAM_ID || "R24tuQ4ycfBXOFaZHKjI";

/* ---------------------------------------------------------------- helpers */

function tsv(name) {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

// mysql --batch escapes newlines and tabs; undo that so content survives.
const unesc = (s) => (s || "").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
const phpStr = (blob, key) => {
  const m = new RegExp('"' + key + '";s:\\d+:"([^"]*)"').exec(blob || "");
  return m ? m[1] : "";
};
const emailKey = (e) => (e || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** Titles encode the ICAN level: "ICAN ATS 2 - Information Technology". */
function levelFrom(title) {
  const t = title.toLowerCase();
  if (/\bats\s*1\b/.test(t)) return "ATS 1 Level";
  if (/\bats\s*2\b/.test(t)) return "ATS 2 Level";
  if (/\bats\s*3\b/.test(t)) return "ATS 3 Level";
  if (/\bfnd\b|foundation/.test(t)) return "Foundation Level";
  if (/\bskills?\b/.test(t)) return "Skills Level";
  if (/\bprof\b|professional/.test(t)) return "Professional Level";
  return "";
}

/* ------------------------------------------------------------------- load */

const posts = tsv("posts.tsv");
const meta = tsv("postmeta.tsv");
const orders = tsv("orders.tsv");
const orderItems = tsv("order_items.tsv");
const users = tsv("users.tsv");
const terms = tsv("terms.tsv");

const metaOf = {};
for (const m of meta) (metaOf[m.post_id] ||= {})[m.meta_key] = m.meta_value;
const fileOf = {};
for (const m of meta) if (m.meta_key === "_wp_attached_file") fileOf[m.post_id] = m.meta_value;
const termsOf = {};
for (const t of terms) (termsOf[t.object_id] ||= []).push(t.name);

const byId = Object.fromEntries(posts.map((p) => [p.ID, p]));
const courses = posts.filter((p) => p.post_type === "courses");
const topics = posts.filter((p) => p.post_type === "topics");
const lessons = posts.filter((p) => p.post_type === "lesson");
const attachmentParent = Object.fromEntries(
  posts.filter((p) => p.post_type === "attachment").map((a) => [a.ID, a.post_parent])
);

const mediaUrl = (relPath) => `${VIDEO_BASE}/${relPath}`;

/* ---------------------------------------------------------------- courses */

const stats = { sessions: 0, contents: 0, videos: 0, videoMissing: 0, orphanRecovered: 0, noProgram: 0 };

function contentFor(lesson) {
  const m = metaOf[lesson.ID] || {};
  const attId = phpStr(m._video, "source_video_id");
  const relPath = attId ? fileOf[attId] : "";
  const medias = [];

  if (relPath) {
    stats.videos++;
    medias.push({
      id: `wp-media-${attId}`,
      type: "video",
      url: mediaUrl(relPath),
      image: mediaUrl(relPath),
      thumbnail: "",
      status: 1,
    });
  } else if (attId) {
    stats.videoMissing++;
  }

  stats.contents++;
  return {
    id: `wp-${lesson.ID}`,
    title: unesc(lesson.post_title),
    session_Id: `wp-${lesson.post_parent}`,
    description: unesc(lesson.post_content),
    status: 1,
    medias,
  };
}

const courseDocs = courses.map((c) => {
  const m = metaOf[c.ID] || {};
  const categories = termsOf[c.ID] || [];
  const title = unesc(c.post_title);

  // topics -> sessions, each holding its lessons as content
  const courseTopics = topics
    .filter((t) => t.post_parent === c.ID)
    .sort((a, b) => Number(a.menu_order) - Number(b.menu_order));

  const sessions = courseTopics.map((t) => {
    const topicLessons = lessons
      .filter((l) => l.post_parent === t.ID)
      .sort((a, b) => Number(a.menu_order) - Number(b.menu_order));
    stats.sessions++;
    return {
      id: `wp-${t.ID}`,
      session_name: unesc(t.post_title),
      creator: "wordpress-import",
      status: 1,
      content: topicLessons.map(contentFor),
    };
  });

  // 59 lessons lost their topic; their video attachment still records the
  // course, so they are gathered into one recovered session rather than lost.
  const orphans = lessons.filter((l) => {
    if (byId[l.post_parent]) return false;
    const attId = phpStr((metaOf[l.ID] || {})._video, "source_video_id");
    return attId && attachmentParent[attId] === c.ID;
  });
  if (orphans.length) {
    stats.orphanRecovered += orphans.length;
    sessions.push({
      id: `wp-orphans-${c.ID}`,
      session_name: "Other lessons",
      creator: "wordpress-import",
      status: 1,
      content: orphans.map(contentFor),
    });
  }

  const productId = m._tutor_course_product_id;
  const price = productId ? (metaOf[productId] || {})._price || "" : "";
  const regular = productId ? (metaOf[productId] || {})._regular_price || "" : "";

  const isIcan = /ican/i.test(title) || categories.some((x) => /ican/i.test(x));
  if (!isIcan) stats.noProgram++;

  const thumb = m._thumbnail_id ? fileOf[m._thumbnail_id] : "";
  const image = thumb ? mediaUrl(thumb) : "";

  return {
    _id: `wp-${c.ID}`,
    id: `wp-${c.ID}`,
    title,
    description: unesc(c.post_content),
    price: String(price || ""),
    cancelPrice: String(regular && regular !== price ? regular : ""),
    creator: "wordpress-import",
    instructor: "",
    instructorId: "",
    programId: isIcan ? ICAN_PROGRAM_ID : "",
    level: levelFrom(title),
    package: categories[0] || "",
    image,
    thumbnail: image,
    date: c.post_date,
    dateCreated: c.post_date,
    dateDeleted: "",
    status: c.post_status === "publish" ? 1 : 0,
    lesson: sessions,
    assignment: [],
    quiz: [],
    exams: [],
    faq: [],
    // Provenance, so these are distinguishable from dashboard-created courses.
    source: "wordpress",
    wpId: Number(c.ID),
  };
});

/* ------------------------------------------------------- student recovery */

const orderEmail = {};
for (const o of orders) {
  const id = o.ID || o.id;
  const e = (o.billing_email || "").trim().toLowerCase();
  if (e) orderEmail[id] = e;
}
const itemsOf = {};
for (const i of orderItems) (itemsOf[i.order_id] ||= []).push(unesc(i.order_item_name));

const recovery = {};
const note = (email) => {
  const k = emailKey(email);
  return (recovery[k] ||= {
    _id: k,
    email,
    courseIds: [],
    courseTitles: [],
    orderIds: [],
    wpUserIds: [],
    stillInWordPress: false,
    source: "wordpress",
  });
};

for (const u of users) {
  const e = (u.user_email || "").trim().toLowerCase();
  if (!e) continue;
  const r = note(e);
  r.stillInWordPress = true;
  r.name = unesc(u.display_name);
  r.wpUserIds.push(Number(u.ID));
}

for (const o of orders) {
  const id = o.ID || o.id;
  const e = orderEmail[id];
  if (!e) continue;
  const r = note(e);
  if (!r.orderIds.includes(id)) r.orderIds.push(id);
}

let enrolLinked = 0;
for (const e of posts.filter((p) => p.post_type === "tutor_enrolled")) {
  const orderId = (metaOf[e.ID] || {})._tutor_enrolled_by_order_id;
  const email = orderId ? orderEmail[orderId] : null;
  if (!email) continue;
  enrolLinked++;
  const r = note(email);
  const courseId = `wp-${e.post_parent}`;
  if (!r.courseIds.includes(courseId)) {
    r.courseIds.push(courseId);
    r.courseTitles.push(byId[e.post_parent] ? unesc(byId[e.post_parent].post_title) : courseId);
  }
}

const recoveryDocs = Object.values(recovery);

/* ------------------------------------------------------------------ write */

console.log("=== import plan (schema matches the existing API) ===");
console.log(`courses            ${courseDocs.length}`);
console.log(`  sessions         ${stats.sessions}  (from topics)`);
console.log(`  lesson items     ${stats.contents}`);
console.log(`  with video       ${stats.videos}`);
console.log(`  video missing    ${stats.videoMissing}`);
console.log(`  orphans rescued  ${stats.orphanRecovered}`);
console.log(`  no programme     ${stats.noProgram}  (not ICAN - programId left empty)`);
console.log(`studentRecovery    ${recoveryDocs.length}  (${enrolLinked} enrolments linked by order)`);
console.log(`video base         ${VIDEO_BASE}`);
console.log(`programme id       ${ICAN_PROGRAM_ID}`);

if (!APPLY) {
  const out = path.join(DIR, "import-preview.json");
  fs.writeFileSync(out, JSON.stringify({ stats, course: courseDocs[0], student: recoveryDocs[0] }, null, 2));
  console.log(`\nDRY RUN - wrote ${out}`);
  console.log("Re-run with --apply to write to Firestore.");
  process.exit(0);
}

(async () => {
  const { db } = require("../firebaseadminvar");
  const all = [
    ...courseDocs.map((d) => ["courses", d]),
    ...recoveryDocs.map((d) => ["studentRecovery", d]),
  ];
  let done = 0;
  // Firestore caps a batch at 500 writes; course documents are large, so the
  // batches are kept small.
  for (let i = 0; i < all.length; i += 100) {
    const batch = db.batch();
    for (const [col, doc] of all.slice(i, i + 100)) {
      const { _id, ...data } = doc;
      batch.set(db.collection(col).doc(_id), data, { merge: true });
    }
    await batch.commit();
    done += Math.min(100, all.length - i);
    console.log(`  written ${done}/${all.length}`);
  }
  console.log("Import complete.");
  process.exit(0);
})().catch((e) => {
  console.error("Import failed:", e.message);
  process.exit(1);
});
