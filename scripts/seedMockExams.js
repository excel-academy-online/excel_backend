/**
 * Gives every published course a mock exam from the subject banks in
 * mockExamBank1.js / mockExamBank2.js.
 *
 *   node scripts/seedMockExams.js         -> dry run (lists course -> subject)
 *   node scripts/seedMockExams.js apply   -> writes mockExams/{courseId}
 *
 * Exams written by staff (source !== "seed") are never overwritten.
 */
const { db } = require("../firebaseadminvar");
const bank = { ...require("./mockExamBank1"), ...require("./mockExamBank2") };

const APPLY = process.argv[2] === "apply";
const MINUTES_PER_QUESTION = 1.5;

// First match wins, so specific rules come before general ones.
const rules = [
  [/Case Study/i, ["strategicReporting", "governance"]],
  [/Strategic Business Reporting/i, ["strategicReporting"]],
  [/CITN PT2|Advance(d)? Taxation|International Tax|Extractive|Tax Audit|Tax Planning|Professional Competence/i, ["advancedTax"]],
  [/Advance(d)? Audit|P7/i, ["advancedAudit"]],
  [/Strategic Financial Management|Advanced Financial Management/i, ["advancedFinancialManagement"]],
  [/Advanced Performance Management|Performance Management|F5/i, ["performanceManagement"]],
  [/Financial Reporting|F7|International Financial Reporting/i, ["financialReporting"]],
  [/Audit/i, ["audit"]],
  [/Financial Management|F9/i, ["financialManagement"]],
  [/Public Sector/i, ["publicSector"]],
  [/ACCA F6/i, ["ukTax"]],
  [/Digital Tax/i, ["informationTechnology", "nigerianTax"]],
  [/Information Technology/i, ["informationTechnology"]],
  [/Tax/i, ["nigerianTax"]],
  [/Governance|Strategic Business Leader|Strategic Management|Secretaryship|Ethics/i, ["governance"]],
  [/Law/i, ["businessLaw"]],
  [/Economics/i, ["economics"]],
  [/Business Environment|Business & Technology/i, ["businessEnvironment"]],
  [/Management Accounting|Cost Accounting/i, ["managementAccounting"]],
  [/Financial Accounting|Basic Accounting/i, ["financialAccounting"]],
  [/Quantitative/i, ["quantitative"]],
  [/Communication/i, ["communication"]],
  [/Management/i, ["management"]],
  [/^CIS /i, ["capitalMarkets"]],
  [/Financial Model/i, ["financialModeling"]],
  [/Excel/i, ["excel"]],
  [/Business Analysis/i, ["businessAnalysis"]],
  [/QuickBooks/i, ["quickbooks"]],
  [/Sage/i, ["sage"]],
];

/** 10 questions from one bank, or 5 + 5 from two. */
function questionsFor(keys) {
  const per = keys.length === 1 ? 10 : 5;
  return keys.flatMap((k) =>
    bank[k].slice(0, per).map(([question, options, answer, explanation], i) => ({
      id: `${k}-${i + 1}`,
      question,
      options,
      answer,
      explanation,
    }))
  );
}

(async () => {
  for (const [k, qs] of Object.entries(bank)) {
    for (const [q, o, a] of qs) {
      if (o.length !== 4 || !(a >= 0 && a < 4)) throw new Error(`Bad question in ${k}: ${q}`);
    }
  }
  const [courses, existing] = await Promise.all([db.collection("courses").get(), db.collection("mockExams").get()]);
  const staffMade = new Set(existing.docs.filter((d) => d.data().source !== "seed").map((d) => d.id));
  const batch = db.batch();
  let n = 0;
  const unmatched = [];
  for (const d of courses.docs) {
    const c = d.data();
    if (Number(c.status) !== 1) continue;
    const rule = rules.find(([re]) => re.test(c.title || ""));
    if (!rule) { unmatched.push(c.title); continue; }
    if (staffMade.has(d.id)) { console.log("keep staff exam", d.id, c.title); continue; }
    const questions = questionsFor(rule[1]);
    n++;
    console.log(d.id.padEnd(9), String(c.title).slice(0, 60).padEnd(60), rule[1].join("+"));
    if (APPLY) {
      batch.set(db.collection("mockExams").doc(d.id), {
        courseId: d.id,
        title: `${c.title} - Mock Examination`,
        level: c.level || "",
        minutes: Math.ceil(questions.length * MINUTES_PER_QUESTION),
        status: 1,
        source: "seed",
        questions,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  if (APPLY && n) await batch.commit();
  if (unmatched.length) console.log("\nNo subject for:", unmatched.join(" | "));
  console.log(`\n${APPLY ? "WROTE" : "DRY RUN"} ${n} mock exams, ${Object.values(bank).flat().length} questions in the bank`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
