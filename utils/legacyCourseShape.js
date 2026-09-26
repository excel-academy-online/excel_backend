/**
 * Present a Firestore course in the shape the Flutter app parses.
 *
 * The app's models (ExcelGroup/lib/pages/home/model.dart and
 * course_view/model.dart) were written against the old MongoDB documents:
 *
 *   { _id, title, creator, description, thumbnail, price: <int>,
 *     subscribers: [],
 *     lessons: [{ _id, lesson_name, subscriptionRequired,
 *                 modules: [{ _id, module_name, firebase_id, subscriptionRequired }] }] }
 *
 * Firestore stores the same content as `lesson[]` sessions holding `content[]`
 * items holding `medias[]`. Rather than break every client, the two legacy
 * course endpoints translate on the way out.
 *
 * Access control lives here too: a lesson's video URL (`firebase_id`) is only
 * included when the caller owns the course. Everyone else sees the course
 * structure with each module locked, which is what the app's lock UI expects.
 */

const toInt = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const firstVideo = (item) =>
  (item.medias || []).find((m) => m && m.type === "video" && m.url) || null;

/**
 * @param {object}  course    Firestore course document (with `_id` or `id`)
 * @param {object}  [opts]
 * @param {boolean} [opts.owned=false]     caller has an active enrolment
 * @param {boolean} [opts.withLessons=true] include the lesson tree
 */
function legacyCourse(course, { owned = false, withLessons = true } = {}) {
  const id = String(course._id || course.id || "");

  const lessons = !withLessons
    ? []
    : (course.lesson || []).map((session) => ({
        _id: String(session.id || ""),
        lesson_name: session.session_name || "",
        subscriptionRequired: !owned,
        modules: (session.content || []).map((item) => {
          const video = firstVideo(item);
          return {
            _id: String(item.id || ""),
            module_name: item.title || "",
            // Only owners get the playable URL. Non-owners get the structure
            // with an empty URL, so the app renders a locked lesson rather
            // than a free one.
            firebase_id: owned && video ? video.url : "",
            hasVideo: !!video,
            subscriptionRequired: !owned,
          };
        }),
      }));

  return {
    _id: id,
    id,
    title: course.title || "",
    creator: course.creator || "",
    description: course.description || "",
    thumbnail: course.thumbnail || course.image || "",
    price: toInt(course.price),
    // Free on the old website; enrolled via /students/enroll-free, no payment.
    isFree: course.isFree === true,
    level: course.level || "",
    status: course.status,
    subscribers: [],
    owned,
    lessonCount: (course.lesson || []).reduce((n, s) => n + (s.content || []).length, 0),
    lessons,
  };
}

module.exports = { legacyCourse, toInt };
