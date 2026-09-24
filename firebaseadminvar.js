/**
 * Firebase Admin bootstrap.
 *
 * Initialises the Admin SDK exactly once for the whole process and exports the
 * handles the rest of the app needs. Credentials are read from the environment
 * so that no service-account key has to live in the repo; a local JSON file is
 * still accepted as a development fallback.
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

function loadServiceAccount() {
  // 1. Base64-encoded JSON in the environment (preferred: works on Render,
  //    Cloud Run, Functions, etc. without writing a file to disk).
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      "base64"
    ).toString("utf8");
    return JSON.parse(json);
  }

  // 2. Raw JSON in the environment.
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  // 3. A path to a key file - the standard Google variable.
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, "serviceAccountKey.json");

  if (fs.existsSync(keyPath)) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn(
        "[firebase] Falling back to serviceAccountKey.json on disk. " +
          "Set FIREBASE_SERVICE_ACCOUNT_BASE64 instead - a key file must never be committed."
      );
    }
    return JSON.parse(fs.readFileSync(keyPath, "utf8"));
  }

  // 4. No key anywhere. On Google infrastructure (Cloud Run, Cloud Functions,
  //    App Engine) the platform supplies an identity, which is better than a
  //    key file: there is no secret to leak or rotate. Returning null here
  //    makes initializeApp use it.
  console.warn(
    "[firebase] No key file; using the platform's own credentials. " +
      "Expected on Cloud Run - a mistake anywhere else."
  );
  return null;
}

const serviceAccount = loadServiceAccount();

// With no key file the project id comes from the environment instead.
const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  (serviceAccount && serviceAccount.project_id) ||
  undefined;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: serviceAccount
      ? admin.credential.cert(serviceAccount)
      : admin.credential.applicationDefault(),
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      "https://excel-academy-online-default-rtdb.firebaseio.com",
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      (projectId ? projectId + ".appspot.com" : undefined),
  });
}

/**
 * Public Firebase web config. These values are not secret - they ship inside
 * the mobile and dashboard clients - but they are kept in the environment so
 * that a staging project can be swapped in without a code change.
 */
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

module.exports = {
  admin,
  serviceAccount,
  firebaseConfig,
  // Preferred handles for new code - these are server-side and ignore
  // Firestore/Storage security rules, unlike the `firebase/*` client SDK.
  db: admin.firestore(),
  auth: admin.auth(),
  bucket: admin.storage().bucket(),
};
