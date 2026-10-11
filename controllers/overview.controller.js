/**
 * GET /api/dashboard/overview - platform-wide numbers for the admin home.
 *
 * The older /dashboard/getdashboarddata counts only courses the caller
 * authored (so an admin who wrote none saw 0) and has no revenue. This
 * counts everything, from the real collections.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const { programmeOf } = require("../utils/programmes");

const count = async (q) => (await q.count().get()).data().count;

exports.Overview = catchAsync(async (req, res) => {
  const [liveCourses, students, enrolments, questions, games, openChats, orders, payouts] = await Promise.all([
    // Programmes are the ones the app shows (ICAN, ACCA...) that have a
    // published course - not the old programs collection.
    db.collection("courses").where("status", "==", 1).get(),
    // Students only: staff accounts are users too.
    db.collection("users").get().then((s) => s.docs.filter((d) => d.data().type !== "admin" && d.data().admin !== true).length),
    count(db.collection("enrollments")),
    count(db.collection("gamification").where("status", "==", 1)),
    count(db.collection("quizResults")),
    count(db.collection("conversations").where("status", "==", "open")),
    db.collection("orders").where("status", "==", "completed").get(),
    db.collection("payouts").where("status", "==", "pending").get(),
  ]);

  const courses = liveCourses.size;
  const programs = new Set(liveCourses.docs.map((d) => programmeOf({ id: d.id, ...d.data() })).filter(Boolean)).size;

  // Revenue by month for the last 12 months (NGN), oldest first.
  const byMonth = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    byMonth[d.toISOString().slice(0, 7)] = 0;
  }
  let revenue = 0;
  for (const o of orders.docs.map((d) => d.data())) {
    const amount = Number(o.amount) || 0;
    revenue += amount;
    const month = String(o.paidAt || "").slice(0, 7);
    if (month in byMonth) byMonth[month] += amount;
  }

  res.status(200).json({
    status: "ok",
    message: "Overview fetched",
    data: {
      programs,
      courses,
      students,
      enrolments,
      quizQuestions: questions,
      quizGamesPlayed: games,
      openChats,
      orders: orders.size,
      revenueNaira: revenue,
      revenueByMonth: Object.entries(byMonth).map(([month, naira]) => ({ month, naira })),
      pendingPayouts: payouts.size,
      pendingPayoutsNaira: payouts.docs.reduce((s, d) => s + (Number(d.data().amountNaira) || 0), 0),
    },
  });
});
