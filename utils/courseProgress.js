/**
 * How far a student is through a course, computed the same way everywhere
 * (My board, Home, the course page, achievements).
 *
 * Only lessons with a video count: a lesson with nothing to watch could never
 * be finished and would keep a course below 100% forever.
 *
 * Rounds down, so 100% means every video is watched, but any progress shows
 * at least 1% (1 of 101 videos is not "0%").
 */
const hasVideo = (item) => (item.medias || []).some((m) => m && m.type === "video" && m.url);

function videoIds(course) {
  return (course.lesson || []).flatMap((s) => (s.content || []).filter(hasVideo).map((i) => String(i.id)));
}

function courseProgress(course, completedModules) {
  const ids = videoIds(course);
  const done = new Set((completedModules || []).map(String));
  const completed = ids.filter((id) => done.has(id)).length;
  const total = ids.length;
  let percentage = 0;
  if (total && completed === total) percentage = 100;
  else if (total && completed) percentage = Math.max(1, Math.floor((completed / total) * 100));
  return { percentage, completed, total };
}

module.exports = { courseProgress, videoIds };
