/**
 * The programmes students browse in the app, with their levels.
 *
 * The app has the same list built in (ExcelGroup/lib/widgets/card.dart
 * `programCatalogue` and lib/core/constants/program_levels.dart). A course
 * shows under a programme in the app when its `program` field is that code
 * (or, for older courses, its title starts with it), and under a level when
 * its `level` matches one of these. Keep the three lists in step.
 */
const PROGRAMMES = [
  { code: "ICAN", label: "Institute of Chartered Accountants of Nigeria",
    levels: ["ATS 1 LEVEL", "ATS 2 LEVEL", "ATS 3 LEVEL", "FOUNDATION LEVEL", "SKILLS LEVEL", "PROFESSIONAL LEVEL"] },
  { code: "ACCA", label: "Association of Chartered Certified Accountants",
    levels: ["APPLIED KNOWLEDGE LEVEL", "APPLIED SKILLS LEVEL", "STRATEGIC PROFESSIONAL LEVEL"] },
  { code: "CITN", label: "Chartered Institute of Taxation of Nigeria", levels: ["FOUNDATION LEVEL", "PT1 LEVEL", "PT2 LEVEL"] },
  { code: "CIMA", label: "Chartered Institute of Management Accountants", levels: ["LEVEL 1", "LEVEL 2"] },
  { code: "CIS", label: "Chartered Institute of Stockbrokers of Nigeria", levels: ["LEVEL 1", "LEVEL 2"] },
  { code: "ANAN", label: "Association of National Accountants of Nigeria", levels: [] },
  { code: "CIBN", label: "Chartered Institute of Bankers of Nigeria",
    levels: ["DIPLOMA LEVEL", "INTERMEDIATE LEVEL", "CHARTERED BANKER LEVEL", "OTHER CERTIFICATIONS"] },
  { code: "CFA", label: "Chartered Financial Analyst", levels: ["LEVEL 1", "LEVEL 2", "LEVEL 3"] },
  { code: "CPA", label: "Certified Public Accountant", levels: [] },
  { code: "CIPM", label: "Chartered Institute of Personnel Management of Nigeria",
    levels: ["FOUNDATION LEVEL", "INTERMEDIATE 1 LEVEL", "INTERMEDIATE 2 LEVEL", "PROFESSIONAL 1 LEVEL", "PROFESSIONAL 2 LEVEL"] },
  { code: "ICSAN", label: "Chartered Governance Institute of Nigeria (ICSAN)",
    levels: ["FOUNDATION LEVEL", "PRE-PROFESSIONAL LEVEL", "PROFESSIONAL PROGRAMME PART I LEVEL", "PROFESSIONAL PROGRAMME PART II LEVEL"] },
  { code: "CIIN", label: "Chartered Insurance Institute of Nigeria", levels: ["FOUNDATION LEVEL", "INTERMEDIATE LEVEL", "ASSOCIATESHIP LEVEL"] },
  { code: "JUPEB", label: "Joint Universities Preliminary Examinations Board", levels: [] },
  { code: "CFE", label: "Certified Fraud Examiner", levels: [] },
  { code: "CISA", label: "Certified Information Systems Auditor", levels: [] },
];

const CODES = new Set(PROGRAMMES.map((p) => p.code));
const ICAN_PROGRAM_ID = "R24tuQ4ycfBXOFaZHKjI";

/** Programme code from a course title prefix, for courses not tagged yet. */
function programFromTitle(course) {
  const t = String(course.title || "");
  if (/^ICAN/.test(t) || course.programId === ICAN_PROGRAM_ID) return "ICAN";
  if (/^(ACCA|F4 |P7 |Advanced Performance Management|Strategic Business Leader)/.test(t)) return "ACCA";
  for (const code of ["CITN", "CIMA", "CIBN", "CIPM", "ICSAN", "CIIN", "CFA", "CFE", "CISA", "CPA", "ANAN", "JUPEB"]) {
    if (new RegExp("^" + code + "\\b").test(t)) return code;
  }
  return /^CIS /.test(t) ? "CIS" : "";
}

/** The programme the app lists a course under ("" = none). */
const programmeOf = (course) => (CODES.has(course.program) ? course.program : programFromTitle(course));

module.exports = { PROGRAMMES, CODES, programFromTitle, programmeOf };
