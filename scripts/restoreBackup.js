/**
 * Restores documents from a nightly backup (firestore-*.json.gz, copied from
 * /home/media-backups on the VPS). Run from excel_backend.
 *
 *   node scripts/restoreBackup.js <file> --list               what's inside
 *   node scripts/restoreBackup.js <file> --only users/abc123  one document
 *   node scripts/restoreBackup.js <file> --only payments      one collection
 *   node scripts/restoreBackup.js <file> --all --yes          everything
 *
 * Restoring overwrites the live copy of each document it writes.
 */
const fs = require("fs");
const zlib = require("zlib");
const { admin, db } = require("../firebaseadminvar");

const [file, ...args] = process.argv.slice(2);
if (!file) {
  console.log("Usage: node scripts/restoreBackup.js <backup.json.gz> --list | --only <path> | --all --yes");
  process.exit(1);
}

const revive = (v) => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    if (typeof v._ts === "string" && Object.keys(v).length === 1) return admin.firestore.Timestamp.fromDate(new Date(v._ts));
    if (typeof v._ref === "string" && Object.keys(v).length === 1) return db.doc(v._ref);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};

(async () => {
  const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  console.log(`Backup from ${backup.createdAt}: ${backup.count} documents`);

  if (args.includes("--list")) {
    const byCol = {};
    for (const d of backup.docs) {
      const col = d.path.split("/").filter((_, i) => i % 2 === 0).join("/");
      byCol[col] = (byCol[col] || 0) + 1;
    }
    Object.entries(byCol).sort().forEach(([c, n]) => console.log(`  ${c}: ${n}`));
    return process.exit(0);
  }

  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  if (!only && !(args.includes("--all") && args.includes("--yes"))) {
    console.log("Say what to restore: --only <path> or --all --yes");
    return process.exit(1);
  }
  const pick = backup.docs.filter((d) => !only || d.path === only || d.path.startsWith(only + "/"));
  let n = 0;
  for (let i = 0; i < pick.length; i += 400) {
    const batch = db.batch();
    pick.slice(i, i + 400).forEach((d) => batch.set(db.doc(d.path), revive(d.data)));
    await batch.commit();
    n += Math.min(400, pick.length - i);
  }
  console.log(`Restored ${n} documents${only ? ` under ${only}` : ""}.`);
  process.exit(0);
})().catch((e) => {
  console.log("FAILED", e.message);
  process.exit(1);
});
