/**
 * One-off: removes the three test push notifications from September 2026
 * ("Latest update on Mobile" x2, "Sunday Demoing") that students still see
 * under What's New. Backs them up to backups/ first. Run from excel_backend:
 *
 *   node scripts/cleanupTestBroadcasts.js
 */
const fs = require("fs");
const path = require("path");
const { db } = require("../firebaseadminvar");

const IDS = ["91l0UBGaUvARNYUWVCcw", "CcUZ4OHOFu8TbM8q9GyX", "S1YVmcAw8Kz3d2vvI0z2"];

(async () => {
  const docs = await Promise.all(IDS.map((id) => db.collection("broadcasts").doc(id).get()));
  const file = path.join(__dirname, "..", "backups", "test-broadcasts-2026-10-11.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(docs.filter((d) => d.exists).map((d) => ({ id: d.id, data: d.data() })), null, 1));
  console.log("backup:", file);
  for (const d of docs) {
    if (!d.exists) continue;
    await d.ref.delete();
    console.log("deleted:", d.data().title);
  }
  process.exit(0);
})().catch((e) => {
  console.log("FAILED", e.message);
  process.exit(1);
});
