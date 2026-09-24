#!/usr/bin/env node
/**
 * READ-ONLY survey of what actually lives in Firestore and MongoDB.
 *
 *   npm run inspect
 *
 * Writes nothing. Run this before migrating anything - it answers the question
 * "is the real course catalogue in Firestore already, or only in Mongo?"
 *
 * Needs the same .env the server uses. If Mongo_Uri is absent or unreachable
 * the Mongo section is skipped and the Firestore section still runs.
 */
require("dotenv").config();

const SAMPLE_KEYS_LIMIT = 15;

// Collections worth reporting on, based on what the controllers touch.
const FIRESTORE_COLLECTIONS = [
  "courses",
  "programs",
  "users",
  "enrollments",
  "gamification",
  "community",
  "announcements",
  "certificates",
  "advertisement",
  "modules",
  "roles",
  "publicnotifications",
];

function line(char = "-") {
  console.log(char.repeat(72));
}

async function inspectFirestore() {
  line("=");
  console.log("FIRESTORE");
  line("=");

  let db;
  try {
    ({ db } = require("../firebaseadminvar"));
  } catch (err) {
    console.log(`Could not initialise Firebase: ${err.message}`);
    return;
  }

  // List whatever actually exists, not just the names we guessed at.
  let existing = [];
  try {
    const cols = await db.listCollections();
    existing = cols.map((c) => c.id);
    console.log(`Root collections present (${existing.length}):`);
    console.log("  " + (existing.join(", ") || "(none)"));
    console.log("");
  } catch (err) {
    console.log(`Could not list collections: ${err.message}\n`);
  }

  const names = Array.from(new Set([...existing, ...FIRESTORE_COLLECTIONS]));

  for (const name of names) {
    let snap;
    try {
      snap = await db.collection(name).limit(3).get();
    } catch (err) {
      console.log(`${name.padEnd(22)} ERROR: ${err.message}`);
      continue;
    }

    if (snap.empty) {
      console.log(`${name.padEnd(22)} EMPTY`);
      continue;
    }

    // count() avoids reading every document just to size the collection.
    let total = "?";
    try {
      const agg = await db.collection(name).count().get();
      total = agg.data().count;
    } catch {
      /* count() needs a recent SDK; the sample below is still useful. */
    }

    const first = snap.docs[0];
    const keys = Object.keys(first.data()).slice(0, SAMPLE_KEYS_LIMIT);
    console.log(`${name.padEnd(22)} ${String(total).padStart(6)} docs`);
    console.log(`${" ".repeat(22)} sample id : ${first.id}`);
    console.log(`${" ".repeat(22)} fields    : ${keys.join(", ")}`);
  }
  console.log("");
}

async function inspectMongo() {
  line("=");
  console.log("MONGODB");
  line("=");

  if (!process.env.Mongo_Uri) {
    console.log("Mongo_Uri is not set - skipping.");
    console.log("If nobody has this connection string, the data below is unreachable");
    console.log("and the Mongo-backed endpoints cannot be migrated, only rebuilt.\n");
    return;
  }

  const mongoose = require("mongoose");
  try {
    await mongoose.connect(process.env.Mongo_Uri, {
      serverSelectionTimeoutMS: 8000,
    });
  } catch (err) {
    console.log(`Could not connect: ${err.message}\n`);
    return;
  }

  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log(`Collections (${collections.length}):\n`);

  for (const { name } of collections) {
    const col = mongoose.connection.db.collection(name);
    const count = await col.countDocuments();
    const sample = await col.findOne();
    console.log(`${name.padEnd(22)} ${String(count).padStart(6)} docs`);
    if (sample) {
      const keys = Object.keys(sample).slice(0, SAMPLE_KEYS_LIMIT);
      console.log(`${" ".repeat(22)} fields    : ${keys.join(", ")}`);
    }
  }

  await mongoose.disconnect();
  console.log("");
}

async function main() {
  console.log("\nREAD-ONLY data survey. Nothing is written or modified.\n");
  await inspectFirestore();
  await inspectMongo();

  line("=");
  console.log("WHAT TO LOOK FOR");
  line("=");
  console.log(
    [
      "- Firestore `courses` populated  -> the catalogue already lives there;",
      "  the migration is just repointing the live endpoints at it.",
      "- Firestore `courses` EMPTY but Mongo `courses` populated -> the real",
      "  catalogue is only in Mongo and must be exported before anything is",
      "  switched over.",
      "- Both populated -> compare the counts and sample fields; they are",
      "  separate systems and will have diverged.",
      "- Mongo unreachable -> whatever is in it is effectively gone.",
    ].join("\n")
  );
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
