/**
 * Which lessons use each video on the VPS - for the dashboard's Videos page,
 * so staff can see what's safe to delete.
 *
 * Lesson videos are links under VIDEO_BASE_URL
 * (https://courses.excelacademyonline.com/wp-content/uploads/...) stored
 * somewhere inside a course's `lesson` tree. We walk every course and map
 * each file path (relative to uploads/) to the lessons that point at it.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");

const BASE = (process.env.VIDEO_BASE_URL || "https://courses.excelacademyonline.com/wp-content/uploads").replace(/\/+$/, "") + "/";

let cache = null;

function relOf(url) {
  if (typeof url !== "string" || !url.startsWith(BASE)) return null;
  try {
    return decodeURIComponent(url.slice(BASE.length).split("?")[0]);
  } catch {
    return url.slice(BASE.length).split("?")[0];
  }
}

/** GET /api/videos/usage - { "2022/10/x.mp4": [{ courseId, courseTitle, section, lesson, status }] } */
exports.Usage = catchAsync(async (req, res) => {
  if (cache && Date.now() - cache.at < 60 * 1000 && req.query.refresh !== "1") {
    return res.status(200).json({ status: "ok", message: "Video usage", data: cache.data });
  }
  const snap = await db.collection("courses").get();
  const usage = {};
  for (const d of snap.docs) {
    const c = d.data();
    const courseTitle = c.title || d.id;
    const status = Number(c.status) === 1 ? "published" : "hidden";
    for (const section of c.lesson || []) {
      const sectionName = section.session_name || section.title || "";
      for (const item of section.content || []) {
        const lessonName = item.title || item.name || "";
        const seen = new Set();
        (function walk(v) {
          if (typeof v === "string") {
            const rel = relOf(v);
            if (rel && !seen.has(rel)) {
              seen.add(rel);
              (usage[rel] = usage[rel] || []).push({ courseId: d.id, courseTitle, section: sectionName, lesson: lessonName, status });
            }
          } else if (v && typeof v === "object") {
            for (const x of Object.values(v)) walk(x);
          }
        })(item);
      }
    }
  }
  cache = { at: Date.now(), data: usage };
  res.status(200).json({ status: "ok", message: "Video usage", data: usage });
});
