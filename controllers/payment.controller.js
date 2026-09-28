/**
 * Course purchases through Paystack, on Firestore.
 *
 * Replaces purchaseCourse.controller.js, which read the retired MongoDB and
 * trusted the buyer's email and user id from the request body (the app sent a
 * hardcoded test email for every purchase).
 *
 * Flow:
 *   1. POST /api/payment/initialize-payment   -> Paystack checkout URL
 *   2. student pays in the Paystack web view
 *   3. GET  /api/payment/verify-payment/:ref  -> app confirms, gets its courses
 *      POST /api/payment/webhook              -> Paystack confirms, server-to-server
 *
 * Step 3 happens twice on purpose. The app's call gives instant feedback; the
 * webhook guarantees the enrolment even if the student closes the app the
 * moment the payment clears. Fulfilment is idempotent, so whichever arrives
 * second is a no-op.
 *
 * The buyer is always the verified token's uid/email, and the price is always
 * recomputed from Firestore - nothing the client sends is trusted.
 */
const crypto = require("crypto");
const axios = require("axios");
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const { creditReferral } = require("./referral.controller");
const AppError = require("../utils/errors/AppError");
const { toInt } = require("../utils/legacyCourseShape");
const { ownedCourseIds } = require("../utils/ownership");

const PAYMENTS = "payments";
const ENROLLMENTS = "enrollments";
const COURSES = "courses";
const ORDERS = "orders";

const secret = () => process.env.PAYSTACK_SECRET_KEY || process.env.Paystack_Secret_Key || "";

const paystack = () =>
  axios.create({
    baseURL: "https://api.paystack.co",
    headers: { Authorization: `Bearer ${secret()}` },
    timeout: 20000,
  });

/** Accept the new `{ courseIds }` body and the old `{ metadata: { cart_id } }`. */
function requestedCourseIds(body = {}) {
  const raw = body.courseIds || (body.metadata && body.metadata.cart_id) || [];
  return [...new Set((Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean))];
}

/**
 * This API's public origin, for Paystack's redirect. PUBLIC_BASE_URL wins when
 * set; otherwise it is derived from the request (trust proxy is on, so the
 * scheme is the one the client actually used).
 */
const callbackBase = (req) =>
  (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") ||
  (typeof req.get === "function" && req.get("host") ? `${req.protocol}://${req.get("host")}` : "");

const lessonCount = (c) => (c.lesson || []).reduce((n, s) => n + (s.content || []).length, 0);

/*
 * Cart gift box (Figma "index/cart/large-amount-bonus"): a purchase of at
 * least BONUS_THRESHOLD earns BONUS_NAIRA off the student's next purchase.
 * Kept in cartBonus/{uid}.balanceNaira; used at checkout, and only spent
 * once that payment succeeds.
 */
const BONUS_THRESHOLD = 100000;
const BONUS_NAIRA = 3500;
const MIN_CHARGE_NAIRA = 100;

async function bonusBalance(uid) {
  const snap = await db.collection("cartBonus").doc(uid).get();
  return snap.exists ? Math.max(0, toInt(snap.data().balanceNaira)) : 0;
}

/** GET /api/payment/bonus - the student's gift-box credit and the rule. */
module.exports.GetBonus = catchAsync(async (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Bonus fetched",
    data: { balance: await bonusBalance(req.uid), threshold: BONUS_THRESHOLD, amount: BONUS_NAIRA },
  });
});

/**
 * Turn a successful payment into enrolments. Safe to call more than once for
 * the same reference.
 */
async function fulfil(reference, paid) {
  const ref = db.collection(PAYMENTS).doc(reference);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("Unknown payment reference", 404);

  const payment = snap.data();
  if (payment.status === "success") return { payment, alreadyDone: true };

  // Paystack reports kobo. The price we asked for must have been paid, or
  // someone has tampered with the checkout. When the account passes Paystack's
  // fee to the customer, `amount` is price + fee and `requested_amount` is the
  // price, so a ₦12,000 course is charged ₦12,284.27 - that is a valid payment.
  const asked = Number(payment.amountKobo);
  const requested = Number(paid.requested_amount ?? paid.amount);
  if (requested !== asked || Number(paid.amount) < asked || paid.currency !== "NGN") {
    await ref.set({ status: "amount_mismatch", paystack: { amount: paid.amount, currency: paid.currency } }, { merge: true });
    throw new AppError("Payment amount does not match the order", 400);
  }

  const courseDocs = await db.getAll(...payment.courseIds.map((id) => db.collection(COURSES).doc(id)));
  const now = new Date().toISOString();
  const batch = db.batch();

  for (const course of courseDocs.filter((d) => d.exists)) {
    const c = course.data();
    batch.set(
      db.collection(ENROLLMENTS).doc(`${payment.uid}_${course.id}`),
      {
        course_id: course.id,
        student_id: payment.uid,
        program_id: c.programId || "",
        enrollment_date: now,
        status: "active",
        progress: {
          percentage: 0,
          lessons_completed: 0,
          total_lessons: lessonCount(c),
          quizzes_completed: 0,
          total_quizzes: (c.quiz || []).length,
          assignments_completed: 0,
          total_assignments: (c.assignment || []).length,
        },
        source: "paystack",
        paymentReference: reference,
      },
      { merge: true }
    );
  }

  batch.set(
    db.collection(ORDERS).doc(reference),
    {
      reference,
      uid: payment.uid,
      email: payment.email,
      courseIds: payment.courseIds,
      amount: payment.amountKobo / 100,
      currency: "NGN",
      status: "completed",
      paidAt: paid.paid_at || now,
      channel: paid.channel || null,
    },
    { merge: true }
  );
  batch.set(ref, { status: "success", verifiedAt: now }, { merge: true });
  await batch.commit();
  await settleBonus(payment);
  await creditReferral(payment.uid);

  const titles = courseDocs.filter((d) => d.exists).map((d) => d.data().title).filter(Boolean);
  await require("./notification.controller").notify(payment.uid, {
    type: "account",
    title: "Payment confirmed",
    body: titles.length === 1
      ? `${titles[0]} is unlocked. Enjoy learning!`
      : `${titles.length} courses are unlocked. Enjoy learning!`,
    data: { screen: "my_learning", reference },
  });

  return { payment: { ...payment, status: "success" }, alreadyDone: false };
}

/** Spends the credit this payment used and awards a new one if it qualifies. */
async function settleBonus(payment) {
  try {
    const used = toInt(payment.creditUsedNaira);
    const earned = toInt(payment.subtotalNaira || payment.amountKobo / 100) >= BONUS_THRESHOLD ? BONUS_NAIRA : 0;
    if (!used && !earned) return;
    const ref = db.collection("cartBonus").doc(payment.uid);
    const payRef = db.collection(PAYMENTS).doc(payment.reference);
    // Once per payment, even if the webhook and the app confirm it together.
    const settled = await db.runTransaction(async (tx) => {
      const [snap, pay] = await Promise.all([tx.get(ref), tx.get(payRef)]);
      if (pay.exists && pay.data().bonusSettled) return false;
      const bal = snap.exists ? toInt(snap.data().balanceNaira) : 0;
      tx.set(ref, { balanceNaira: Math.max(0, bal - used) + earned, updatedAt: new Date().toISOString() }, { merge: true });
      tx.set(payRef, { bonusSettled: true, bonusEarnedNaira: earned }, { merge: true });
      return true;
    });
    if (settled && earned) {
      await require("./notification.controller").notify(payment.uid, {
        type: "account",
        title: "You earned a gift-box bonus",
        body: `NGN ${BONUS_NAIRA.toLocaleString("en-NG")} off your next course purchase.`,
        data: { screen: "cart" },
      });
    }
  } catch (err) {
    console.error("Bonus settlement failed for", payment.reference, err.message);
  }
}

/* ------------------------------------------------------------------ */

/** POST /api/payment/initialize-payment */
module.exports.InitializePayment = catchAsync(async (req, res, next) => {
  if (!secret()) return next(new AppError("Payments are not configured on this server", 503));

  const email = req.user && req.user.email;
  if (!email) return next(new AppError("Your account needs an email address to pay", 400));

  const ids = requestedCourseIds(req.body);
  if (!ids.length) return next(new AppError("No courses selected", 400));

  const docs = await db.getAll(...ids.map((id) => db.collection(COURSES).doc(id)));
  const missing = docs.filter((d) => !d.exists).map((d) => d.id);
  if (missing.length) return next(new AppError(`Course not found: ${missing.join(", ")}`, 404));

  // Don't charge for something the student already has.
  const owned = new Set(await ownedCourseIds(req.uid));
  const toBuy = docs.filter((d) => !owned.has(d.id));
  if (!toBuy.length) return next(new AppError("You already own these courses", 409));

  const total = toBuy.reduce((sum, d) => sum + toInt(d.data().price), 0);
  if (total <= 0) return next(new AppError("These courses have no price set", 400));

  const reference = `ea_${req.uid.slice(0, 8)}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  // Gift-box credit comes off the price (never below the minimum charge).
  const creditUsed = Math.min(await bonusBalance(req.uid), Math.max(0, total - MIN_CHARGE_NAIRA));
  const amountKobo = (total - creditUsed) * 100;

  // Recorded before Paystack is called, so a webhook can never arrive for a
  // reference we have no record of.
  await db.collection(PAYMENTS).doc(reference).set({
    reference,
    uid: req.uid,
    email,
    courseIds: toBuy.map((d) => d.id),
    amountKobo,
    subtotalNaira: total,
    creditUsedNaira: creditUsed,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  let ps;
  try {
    ps = await paystack().post("/transaction/initialize", {
      email,
      amount: String(amountKobo),
      currency: "NGN",
      reference,
      metadata: { uid: req.uid, courseIds: toBuy.map((d) => d.id) },
      // Where Paystack sends the browser afterwards. The app's payment web view
      // closes itself when it sees this URL, then verifies the reference.
      ...(callbackBase(req) ? { callback_url: `${callbackBase(req)}/api/payment/callback` } : {}),
    });
  } catch (err) {
    await db.collection(PAYMENTS).doc(reference).set({ status: "init_failed" }, { merge: true });
    const msg = err.response?.data?.message || err.message;
    return next(new AppError(`Could not start payment: ${msg}`, 502));
  }

  res.status(200).json({
    status: "ok",
    message: "Payment initialised",
    data: {
      authorization_url: ps.data.data.authorization_url,
      access_code: ps.data.data.access_code,
      reference,
      amount: total - creditUsed,
      subtotal: total,
      creditUsed,
      courses: toBuy.map((d) => ({ id: d.id, title: d.data().title || "", price: toInt(d.data().price) })),
      skippedAlreadyOwned: docs.length - toBuy.length,
    },
  });
});

/** GET /api/payment/verify-payment/:reference */
module.exports.VerifyPayment = catchAsync(async (req, res, next) => {
  if (!secret()) return next(new AppError("Payments are not configured on this server", 503));
  const { reference } = req.params;

  const snap = await db.collection(PAYMENTS).doc(reference).get();
  if (!snap.exists) return next(new AppError("Unknown payment reference", 404));
  // Nobody can confirm - and so learn about - someone else's purchase.
  if (snap.data().uid !== req.uid) return next(new AppError("This payment is not yours", 403));

  let paid;
  try {
    const ps = await paystack().get(`/transaction/verify/${encodeURIComponent(reference)}`);
    paid = ps.data.data;
  } catch (err) {
    return next(new AppError(`Could not verify payment: ${err.response?.data?.message || err.message}`, 502));
  }

  if (!paid || paid.status !== "success") {
    return next(new AppError(`Payment not completed (${paid ? paid.status : "unknown"})`, 402));
  }

  const { payment, alreadyDone } = await fulfil(reference, paid);

  res.status(200).json({
    status: "ok",
    message: alreadyDone ? "Payment already confirmed" : "Payment confirmed",
    data: { reference, courseIds: payment.courseIds, status: "success" },
  });
});

/**
 * POST /api/payment/webhook  - called by Paystack, not by users.
 *
 * Authenticated by Paystack's HMAC-SHA512 signature over the raw body, which is
 * why index.js keeps `req.rawBody`. Always answers 200 once the signature is
 * good, so Paystack stops retrying even if the event is one we ignore.
 */
module.exports.PaystackWebhook = catchAsync(async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const expected = crypto.createHmac("sha512", secret()).update(req.rawBody || "").digest("hex");

  const valid =
    secret() &&
    typeof signature === "string" &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) return res.status(401).json({ status: "fail", message: "Invalid signature" });

  const event = req.body || {};
  if (event.event === "charge.success" && event.data && event.data.reference) {
    try {
      await fulfil(event.data.reference, event.data);
    } catch (err) {
      // Logged, not surfaced: Paystack cannot act on our internal errors.
      console.error("Webhook fulfilment failed:", event.data.reference, err.message);
    }
  }
  res.status(200).json({ status: "ok" });
});

/**
 * GET /api/payment/callback - where Paystack redirects after checkout.
 *
 * The app intercepts this URL before it loads, so this page is only ever seen
 * in a normal browser. It confirms nothing by itself; enrolment happens via
 * verify-payment or the webhook.
 */
module.exports.PaymentCallback = (req, res) => {
  res
    .status(200)
    .type("html")
    .send(
      '<!doctype html><meta name="viewport" content="width=device-width">' +
        "<title>Payment received</title>" +
        '<body style="font-family:system-ui;text-align:center;padding:48px">' +
        "<h2>Payment received</h2><p>You can return to the Excel Academy app.</p></body>"
    );
};

/* ------------------------------------------------------------ staff */

/**
 * GET /api/payment/admin/payments?status= - staff: recent payments, newest
 * first, with buyer and courses. Pending/failed ones can be re-checked below.
 */
module.exports.AdminListPayments = catchAsync(async (req, res) => {
  const snap = await db.collection(PAYMENTS).orderBy("createdAt", "desc").limit(200).get();
  const want = String(req.query.status || "").toLowerCase();
  const rows = snap.docs
    .map((d) => d.data())
    .filter((p) => !want || want === "all" || (want === "problem" ? p.status !== "success" : p.status === want));
  const ids = [...new Set(rows.flatMap((p) => p.courseIds || []))];
  const docs = ids.length ? await db.getAll(...ids.map((id) => db.collection(COURSES).doc(id))) : [];
  const titles = Object.fromEntries(docs.filter((d) => d.exists).map((d) => [d.id, d.data().title || d.id]));
  res.status(200).json({
    status: "ok",
    message: "Payments fetched",
    data: rows.map((p) => ({
      reference: p.reference,
      email: p.email || "",
      uid: p.uid,
      courses: (p.courseIds || []).map((id) => titles[id] || id),
      amount: (Number(p.amountKobo) || 0) / 100,
      paid: p.paystack && p.paystack.amount ? Number(p.paystack.amount) / 100 : null,
      status: p.status,
      createdAt: p.createdAt || null,
    })),
  });
});

/**
 * POST /api/payment/admin/payments/:reference/verify - staff: ask Paystack
 * again and, if it was paid, unlock the courses. For payments that got stuck
 * (e.g. the student closed the app, or a past bug rejected them).
 */
module.exports.AdminVerifyPayment = catchAsync(async (req, res, next) => {
  if (!secret()) return next(new AppError("Payments are not configured on this server", 503));
  const { reference } = req.params;
  const snap = await db.collection(PAYMENTS).doc(reference).get();
  if (!snap.exists) return next(new AppError("Unknown payment reference", 404));

  let paid;
  try {
    paid = (await paystack().get(`/transaction/verify/${encodeURIComponent(reference)}`)).data.data;
  } catch (err) {
    return next(new AppError(`Could not reach Paystack: ${err.response?.data?.message || err.message}`, 502));
  }
  if (!paid || paid.status !== "success") {
    return next(new AppError(`Paystack says this payment is "${paid ? paid.status : "unknown"}" - nothing to unlock`, 409));
  }
  const { alreadyDone } = await fulfil(reference, paid);
  res.status(200).json({
    status: "ok",
    message: alreadyDone ? "Already confirmed - the student has the courses" : "Payment confirmed - courses unlocked",
    data: { reference, status: "success" },
  });
});

module.exports._fulfil = fulfil;
