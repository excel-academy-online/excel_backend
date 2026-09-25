/**
 * Referrals: invite a friend, earn points, cash them out.
 *
 * Rules (they match the numbers the app shows):
 *   - A student's invite link is https://excelacademyonline.com/invite/{uid}.
 *   - A new account (under 30 days old) may submit one link, once.
 *   - The referrer is rewarded only when the friend makes their first paid
 *     purchase: NGN 4,000 earned = 800 points. Sign-ups alone earn nothing,
 *     so fake accounts can't farm rewards.
 *   - 400 points cash out as NGN 2,000. A payout request reserves the points;
 *     an admin marks it paid, or rejects it (which releases the points).
 *
 *   referrals/{refereeUid}  { referrerUid, refereeUid, refereeName, status: pending|rewarded,
 *                             rewardNaira, points, createdAt, rewardedAt }
 *   payouts/{autoId}        { uid, name, email, points, amountNaira, bank, status: pending|paid|rejected,
 *                             createdAt, decidedAt, decidedBy }
 *   studentProfiles/{uid}.bank { accountNumber, bankName, accountName }
 */
const { db, admin } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const POINTS_PER_CASH_UNIT = 400;
const NAIRA_PER_CASH_UNIT = 2000;
const NAIRA_PER_INVITE = 4000;
const POINTS_PER_INVITE = (NAIRA_PER_INVITE / NAIRA_PER_CASH_UNIT) * POINTS_PER_CASH_UNIT;
const NEW_ACCOUNT_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const now = () => new Date().toISOString();
const profile = (uid) => db.collection("studentProfiles").doc(uid);

/** Accepts a full invite link or a bare uid. */
function referrerFrom(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!u.hostname.endsWith("excelacademyonline.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length === 2 && parts[0] === "invite" ? decodeURIComponent(parts[1]) : null;
  } catch {
    return /^[A-Za-z0-9_-]{6,128}$/.test(s) ? s : null;
  }
}

/** POST /api/referrals/claim { link } - the new student says who invited them. */
exports.ClaimReferral = catchAsync(async (req, res) => {
  const referrerUid = referrerFrom((req.body || {}).link || (req.body || {}).referrerUid);
  if (!referrerUid) throw new AppError("That is not a valid invite link", 400);
  if (referrerUid === req.uid) throw new AppError("You can't use your own invite link", 400);

  const me = await admin.auth().getUser(req.uid);
  const createdMs = Date.parse(me.metadata && me.metadata.creationTime);
  if (Number.isFinite(createdMs) && Date.now() - createdMs > NEW_ACCOUNT_DAYS * DAY) {
    throw new AppError("Invite links can only be used by new accounts", 400);
  }
  try {
    await admin.auth().getUser(referrerUid);
  } catch {
    throw new AppError("That invite link doesn't belong to any student", 404);
  }

  const ref = db.collection("referrals").doc(req.uid);
  const record = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) throw new AppError("You have already used an invite link", 409);
    const data = {
      referrerUid,
      refereeUid: req.uid,
      refereeName: me.displayName || (me.email || "").split("@")[0] || "A friend",
      status: "pending",
      rewardNaira: 0,
      points: 0,
      createdAt: now(),
    };
    tx.set(ref, data);
    return data;
  });

  res.status(201).json({
    status: "ok",
    message: "Invite accepted. Your friend is rewarded when you make your first purchase.",
    data: { referrerUid: record.referrerUid, status: record.status },
  });
});

/**
 * Called by the payment flow after a purchase is fulfilled. Rewards the
 * referrer the first time; later purchases do nothing. Never throws.
 */
exports.creditReferral = async function creditReferral(refereeUid) {
  try {
    const ref = db.collection("referrals").doc(refereeUid);
    const rewarded = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== "pending") return null;
      tx.set(ref, { status: "rewarded", rewardNaira: NAIRA_PER_INVITE, points: POINTS_PER_INVITE, rewardedAt: now() }, { merge: true });
      return snap.data();
    });
    if (rewarded) {
      await require("./notification.controller").notify(rewarded.referrerUid, {
        type: "account",
        title: "You earned a referral reward",
        body: `${rewarded.refereeName || "A friend you invited"} made their first purchase. +${POINTS_PER_INVITE} points (NGN ${NAIRA_PER_INVITE.toLocaleString("en-NG")}).`,
        data: { screen: "referral" },
      });
    }
  } catch (err) {
    console.error("Referral credit failed for", refereeUid, err.message);
  }
};

async function balance(uid) {
  const [refSnap, paySnap] = await Promise.all([
    db.collection("referrals").where("referrerUid", "==", uid).get(),
    db.collection("payouts").where("uid", "==", uid).get(),
  ]);
  const referrals = refSnap.docs.map((d) => d.data());
  const payouts = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const earnedPoints = referrals.reduce((s, r) => s + (r.points || 0), 0);
  const spentPoints = payouts.filter((p) => p.status !== "rejected").reduce((s, p) => s + (p.points || 0), 0);
  return { referrals, payouts, points: Math.max(0, earnedPoints - spentPoints) };
}

const SPANS = { week: 7 * DAY, month: 30 * DAY, allTime: null };

/** GET /api/referrals/stats?period=week|month|allTime */
exports.Stats = catchAsync(async (req, res) => {
  const period = Object.prototype.hasOwnProperty.call(SPANS, req.query.period) ? req.query.period : "week";
  const span = SPANS[period];
  const since = span ? Date.now() - span : 0;
  const { referrals, payouts, points } = await balance(req.uid);

  const inPeriod = (iso) => !span || Date.parse(iso) >= since;
  res.status(200).json({
    status: "ok",
    message: "Referral stats fetched",
    data: {
      period,
      referrals: referrals.filter((r) => inPeriod(r.createdAt)).length,
      totalEarnedNaira: referrals.filter((r) => r.status === "rewarded" && inPeriod(r.rewardedAt)).reduce((s, r) => s + (r.rewardNaira || 0), 0),
      allTimeEarnedNaira: referrals.reduce((s, r) => s + (r.rewardNaira || 0), 0),
      points,
      claimableNaira: Math.floor(points / POINTS_PER_CASH_UNIT) * NAIRA_PER_CASH_UNIT,
      pendingPayouts: payouts.filter((p) => p.status === "pending").map((p) => ({ id: p.id, amountNaira: p.amountNaira, createdAt: p.createdAt })),
    },
  });
});

/** GET /api/referrals/bank */
exports.GetBank = catchAsync(async (req, res) => {
  const snap = await profile(req.uid).get();
  res.status(200).json({ status: "ok", message: "Bank details fetched", data: (snap.exists && snap.data().bank) || null });
});

/** PUT /api/referrals/bank { accountNumber, bankName, accountName } */
exports.SetBank = catchAsync(async (req, res) => {
  const b = req.body || {};
  const accountNumber = String(b.accountNumber || "").replace(/\D/g, "");
  const bankName = String(b.bankName || "").trim().slice(0, 80);
  const accountName = String(b.accountName || "").trim().slice(0, 120);
  if (accountNumber.length !== 10) throw new AppError("Account number must be 10 digits", 400);
  if (!bankName || !accountName) throw new AppError("Bank name and account name are required", 400);
  const bank = { accountNumber, bankName, accountName };
  await profile(req.uid).set({ bank, updatedAt: now() }, { merge: true });
  res.status(200).json({ status: "ok", message: "Bank details saved", data: bank });
});

/** POST /api/referrals/payout - cash out every whole unit of points. */
exports.RequestPayout = catchAsync(async (req, res) => {
  const prof = await profile(req.uid).get();
  const bank = prof.exists && prof.data().bank;
  if (!bank) throw new AppError("Add your bank details first", 400);

  const { points, payouts } = await balance(req.uid);
  if (payouts.some((p) => p.status === "pending")) throw new AppError("You already have a withdrawal being processed", 409);
  const units = Math.floor(points / POINTS_PER_CASH_UNIT);
  if (!units) throw new AppError(`You need at least ${POINTS_PER_CASH_UNIT} points to withdraw`, 400);

  const payout = {
    uid: req.uid,
    name: (req.user && req.user.name) || null,
    email: (req.user && req.user.email) || null,
    points: units * POINTS_PER_CASH_UNIT,
    amountNaira: units * NAIRA_PER_CASH_UNIT,
    bank,
    status: "pending",
    createdAt: now(),
  };
  const ref = await db.collection("payouts").add(payout);
  res.status(201).json({ status: "ok", message: "Withdrawal requested", data: { id: ref.id, ...payout } });
});

/* ------------------------------------------------------------ admin */

/** GET /api/referrals/admin/payouts?status=pending */
exports.AdminListPayouts = catchAsync(async (req, res) => {
  let q = db.collection("payouts");
  if (req.query.status) q = q.where("status", "==", String(req.query.status));
  const snap = await q.get();
  const data = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.status(200).json({ status: "ok", message: "Payouts fetched", data });
});

/** PATCH /api/referrals/admin/payouts/:id { status: "paid"|"rejected" } */
exports.AdminDecidePayout = catchAsync(async (req, res) => {
  const status = (req.body || {}).status;
  if (!["paid", "rejected"].includes(status)) throw new AppError('status must be "paid" or "rejected"', 400);
  const ref = db.collection("payouts").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("Payout not found", 404);
  if (snap.data().status !== "pending") throw new AppError(`This payout is already ${snap.data().status}`, 409);
  const update = { status, decidedAt: now(), decidedBy: req.uid };
  await ref.set(update, { merge: true });
  const p = snap.data();
  await require("./notification.controller").notify(p.uid, {
    type: "account",
    title: status === "paid" ? "Withdrawal paid" : "Withdrawal declined",
    body: status === "paid"
      ? `NGN ${Number(p.amountNaira).toLocaleString("en-NG")} has been sent to your ${(p.bank || {}).bankName || "bank"} account.`
      : "Your withdrawal request was declined and your points are back in your balance. Chat with us if you have questions.",
    data: { screen: "referral" },
  });
  res.status(200).json({ status: "ok", message: `Payout marked ${status}`, data: { id: ref.id, ...snap.data(), ...update } });
});

exports._referrerFrom = referrerFrom;
exports.POINTS_PER_INVITE = POINTS_PER_INVITE;
