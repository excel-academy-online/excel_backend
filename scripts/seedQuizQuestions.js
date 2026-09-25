#!/usr/bin/env node
/**
 * Seeds the quiz game with real questions for every programme the app offers,
 * and unpublishes the test questions ("ABCD", "What is 5 + 2?") that were live.
 *
 *   node scripts/seedQuizQuestions.js          # dry run: prints what it would do
 *   node scripts/seedQuizQuestions.js --apply  # writes to Firestore
 *
 * Safe to re-run: seeded questions have fixed ids (seed-<prog>-<n>) and are
 * overwritten in place. Staff can edit or unpublish them from the dashboard's
 * gamification page like any other question.
 *
 * Questions stick to concepts that don't change year to year (no tax rates or
 * thresholds, which Nigeria's 2025 tax reforms are changing).
 */
const { db } = require("../firebaseadminvar");

// [question, correct answer, ...wrong answers]
const BANK = {
  ICAN: [
    ["Which equation underlies double-entry bookkeeping?", "Assets = Liabilities + Equity", "Assets = Revenue - Expenses", "Equity = Assets + Liabilities", "Liabilities = Assets + Equity"],
    ["Which IFRS deals with revenue from contracts with customers?", "IFRS 15", "IAS 18", "IFRS 9", "IAS 16"],
    ["IAS 16 sets out the accounting for:", "Property, plant and equipment", "Inventories", "Leases", "Intangible assets"],
    ["IFRS 16 deals with:", "Leases", "Financial instruments", "Revenue", "Insurance contracts"],
    ["Which statement shows an entity's financial position at a point in time?", "Statement of financial position", "Statement of profit or loss", "Statement of cash flows", "Statement of changes in equity"],
    ["What is the double entry for a cash sale?", "Debit cash, credit sales", "Debit sales, credit cash", "Debit receivables, credit sales", "Debit cash, credit receivables"],
    ["The going concern assumption means the entity:", "Will continue operating for the foreseeable future", "Is about to be liquidated", "Has made a profit this year", "Has no debts"],
    ["An auditor who finds material and pervasive misstatement should issue:", "An adverse opinion", "An unmodified opinion", "A qualified 'except for' opinion", "An emphasis of matter only"],
    ["Which depreciation method charges the same amount every year?", "Straight-line", "Reducing balance", "Sum-of-the-digits", "Units of production"],
    ["Contribution is calculated as:", "Sales minus variable costs", "Sales minus fixed costs", "Profit plus variable costs", "Sales minus all costs"],
    ["Which body sets and enforces financial reporting standards in Nigeria?", "Financial Reporting Council of Nigeria", "Central Bank of Nigeria", "Corporate Affairs Commission", "Nigerian Exchange Limited"],
    ["ICAN was established by an Act of Parliament in:", "1965", "1960", "1979", "1992"],
  ],
  ACCA: [
    ["Where is ACCA headquartered?", "London", "Dublin", "New York", "Lagos"],
    ["IAS 2 deals with:", "Inventories", "Income taxes", "Provisions", "Borrowing costs"],
    ["Under IAS 2, inventory is measured at:", "The lower of cost and net realisable value", "Cost only", "Selling price", "The higher of cost and net realisable value"],
    ["Which ratio is a measure of liquidity?", "Current ratio", "Gross margin", "Gearing ratio", "Return on capital employed"],
    ["Which is a fundamental qualitative characteristic of useful financial information?", "Faithful representation", "Comparability", "Timeliness", "Understandability"],
    ["Information is material if omitting or misstating it could:", "Influence the economic decisions of users", "Change the tax charge", "Delay the audit", "Reduce profit"],
    ["IAS 37 covers:", "Provisions, contingent liabilities and contingent assets", "Leases", "Share-based payment", "Employee benefits"],
    ["The accruals concept means income and expenses are recognised when:", "They are earned or incurred", "Cash is received or paid", "The invoice is paid", "The year ends"],
    ["A project with a positive NPV should, other things equal, be:", "Accepted", "Rejected", "Deferred indefinitely", "Financed with equity only"],
    ["The payback period measures:", "How long it takes to recover the initial investment", "The project's total profit", "The internal rate of return", "The cost of capital"],
    ["Goodwill on acquisition is consideration plus non-controlling interest minus:", "The fair value of net assets acquired", "The book value of the parent", "Retained earnings", "Share capital"],
    ["In most companies, the external auditor is appointed by:", "The shareholders", "The finance director", "The tax authority", "The internal auditor"],
  ],
  CITN: [
    ["A tax borne by the person who pays it directly to government is:", "A direct tax", "An indirect tax", "An excise duty", "A customs duty"],
    ["Value Added Tax is best described as:", "An indirect tax on consumption", "A tax on company profits", "A tax on property", "A direct tax on salaries"],
    ["Withholding tax is:", "Tax deducted at source as an advance payment", "A penalty for late filing", "A tax on imports", "A refund of overpaid tax"],
    ["Which of these is illegal?", "Tax evasion", "Tax avoidance", "Tax planning", "Claiming capital allowances"],
    ["The classic 'canons of taxation' were set out by:", "Adam Smith", "John Maynard Keynes", "Karl Marx", "David Ricardo"],
    ["The canon of certainty means the taxpayer should know:", "How much, when and how to pay", "That tax will always fall", "The government's budget", "Other taxpayers' liabilities"],
    ["A progressive tax is one where:", "The rate rises as income rises", "Everyone pays the same amount", "The rate falls as income rises", "Only companies pay"],
    ["In a tax computation, accounting depreciation is replaced by:", "Capital allowances", "Investment income", "Withholding tax credits", "Provisions"],
    ["Transfer pricing rules apply to transactions between:", "Connected or related persons", "Unrelated customers", "Government agencies", "Employees and employers"],
    ["Under self-assessment, the tax liability is computed by:", "The taxpayer", "The tax authority alone", "The auditor", "The tax tribunal"],
    ["Double taxation agreements mainly aim to:", "Stop the same income being taxed twice in two countries", "Double a country's tax revenue", "Tax foreign companies twice", "Abolish income tax"],
    ["The Chartered Institute of Taxation of Nigeria was established by law in:", "1992", "1965", "1982", "2004"],
  ],
  CIMA: [
    ["CIMA's qualification focuses mainly on:", "Management accounting", "External auditing", "Tax law", "Actuarial science"],
    ["Under marginal costing, fixed production overheads are treated as:", "Period costs", "Product costs", "Capital expenditure", "Variable costs"],
    ["Absorption costing assigns fixed production overheads to:", "Units produced", "The period only", "Selling expenses", "Reserves"],
    ["Break-even point in units equals:", "Fixed costs / contribution per unit", "Variable cost / selling price", "Sales / fixed costs", "Profit / contribution per unit"],
    ["The margin of safety is:", "Budgeted sales minus break-even sales", "Profit minus fixed costs", "Contribution minus variable costs", "Break-even sales minus actual sales"],
    ["A flexible budget is one that:", "Adjusts to the actual level of activity", "Never changes", "Covers only fixed costs", "Is prepared by the auditor"],
    ["A cost variance is favourable when actual cost is:", "Lower than standard", "Higher than standard", "Equal to budget", "Not yet known"],
    ["Which is NOT a balanced scorecard perspective?", "Competitor", "Financial", "Customer", "Learning and growth"],
    ["Activity-based costing assigns overheads using:", "Cost drivers", "Labour hours only", "Sales value", "Floor area only"],
    ["Zero-based budgeting requires every activity to be:", "Justified from zero each period", "Increased by inflation", "Copied from last year", "Approved by shareholders"],
    ["Opportunity cost is:", "The benefit of the next best alternative given up", "A cost already incurred", "The total cost of production", "A fixed overhead"],
    ["A sunk cost is:", "Already incurred and irrelevant to future decisions", "Relevant to every decision", "A future cash cost", "Always variable"],
  ],
  CIS: [
    ["Which body is the apex regulator of Nigeria's capital market?", "Securities and Exchange Commission", "Central Bank of Nigeria", "NDIC", "Corporate Affairs Commission"],
    ["Nigerian Exchange Limited (NGX) was previously known as:", "The Nigerian Stock Exchange", "The Lagos Commodity Exchange", "FMDQ", "The Abuja Securities Exchange"],
    ["Which organisation provides central securities depository services in Nigeria?", "Central Securities Clearing System (CSCS)", "SEC", "NDIC", "Nigerian Customs Service"],
    ["When market interest rates rise, existing bond prices generally:", "Fall", "Rise", "Stay the same", "Double"],
    ["A bull market is one in which prices are generally:", "Rising", "Falling", "Frozen", "Regulated"],
    ["Dividend yield equals:", "Dividend per share / market price per share", "Earnings per share / dividend", "Market price / earnings per share", "Dividend / total assets"],
    ["The price-earnings (P/E) ratio equals:", "Market price per share / earnings per share", "Earnings / dividends", "Dividends / market price", "Assets / liabilities"],
    ["An IPO is:", "A company's first sale of shares to the public", "A bonus issue", "A share buy-back", "A bond redemption"],
    ["Diversification mainly reduces:", "Unsystematic (specific) risk", "Systematic (market) risk", "Inflation", "Interest rates"],
    ["A rights issue offers new shares to:", "Existing shareholders in proportion to their holdings", "The general public only", "Employees only", "Foreign investors only"],
    ["Preference shareholders usually:", "Receive a fixed dividend before ordinary shareholders", "Control the company's votes", "Get no dividends", "Are the company's creditors"],
    ["Insider dealing means trading on:", "Price-sensitive information that is not public", "Published annual reports", "Broker research", "Newspaper headlines"],
  ],
  ANAN: [
    ["ANAN's professional designation is:", "CNA (Certified National Accountant)", "ACA", "ACCA", "CPA"],
    ["A trial balance mainly checks that:", "Total debits equal total credits", "The business made a profit", "All transactions were recorded", "Cash matches the bank"],
    ["An error of omission:", "Leaves the trial balance still balancing", "Always shows in the trial balance", "Affects only the debit side", "Is the same as a casting error"],
    ["A bank reconciliation compares:", "The cash book balance with the bank statement", "Sales with purchases", "Assets with liabilities", "Debtors with creditors"],
    ["A prepaid expense is shown as:", "A current asset", "A current liability", "Revenue", "Equity"],
    ["An accrued expense is shown as:", "A current liability", "A current asset", "A non-current asset", "Share capital"],
    ["Buying a delivery van for the business is:", "Capital expenditure", "Revenue expenditure", "A drawing", "A liability"],
    ["A suspense account is used when:", "The trial balance does not agree", "Goods are returned", "Cash is banked", "A loan is repaid"],
    ["Gross profit equals:", "Sales minus cost of sales", "Sales minus all expenses", "Net profit plus tax", "Assets minus liabilities"],
    ["IPSAS are accounting standards for:", "The public sector", "Banks only", "Small private companies", "Charities only"],
    ["The prudence concept means:", "Not overstating assets or income", "Always reporting the highest profit", "Ignoring liabilities", "Valuing assets at selling price"],
    ["The imprest system is used to manage:", "Petty cash", "Share capital", "Long-term loans", "Payroll tax"],
  ],
  CIBN: [
    ["Which institution regulates and supervises banks in Nigeria?", "Central Bank of Nigeria", "SEC", "CAC", "Nigerian Exchange Limited"],
    ["Which body insures bank deposits in Nigeria?", "NDIC", "CBN", "SEC", "PenCom"],
    ["The Monetary Policy Rate is:", "The central bank's benchmark interest rate", "The rate banks pay on savings", "The exchange rate", "The inflation rate"],
    ["The cash reserve ratio is the share of deposits a bank must:", "Keep with the central bank", "Lend to government", "Pay as dividends", "Invest in shares"],
    ["KYC stands for:", "Know Your Customer", "Keep Your Cash", "Key Yield Calculation", "Know Your Credit"],
    ["Liquidity risk is the risk that a bank:", "Cannot meet its obligations as they fall due", "Makes too much profit", "Has too many branches", "Changes its logo"],
    ["A cheque is a bill of exchange drawn on a banker and payable:", "On demand", "After 90 days", "Only abroad", "Only to the government"],
    ["The Basel Accords are international standards on:", "Bank capital adequacy", "Stock exchange listings", "Tax treaties", "Accounting for leases"],
    ["A loan is usually classed as non-performing when payments are overdue by:", "90 days or more", "1 day", "7 days", "5 years"],
    ["Open market operations involve the central bank:", "Buying and selling government securities", "Opening new branches", "Printing money for banks", "Setting company tax rates"],
    ["The first stage of money laundering is:", "Placement", "Layering", "Integration", "Reporting"],
    ["CIBN's professional designation is:", "ACIB", "ACA", "CNA", "CFA"],
  ],
  CFA: [
    ["The CFA charter is awarded by:", "CFA Institute", "AICPA", "ACCA", "The SEC"],
    ["How many exam levels does the CFA Program have?", "Three", "Two", "Four", "Five"],
    ["Because of the time value of money, a naira today is worth:", "More than a naira received in future", "Less than a naira received in future", "Exactly the same as a future naira", "Nothing"],
    ["Standard deviation of returns measures:", "Total risk (volatility)", "Average return", "Liquidity", "Dividend yield"],
    ["Under CAPM, expected return equals:", "Risk-free rate + beta x (market return - risk-free rate)", "Market return x beta", "Risk-free rate - beta", "Dividend yield + growth"],
    ["The beta of the market portfolio is:", "1", "0", "-1", "100"],
    ["A bond's duration measures its price sensitivity to:", "Changes in interest rates", "Changes in exchange rates", "The issuer's profit", "Stock market swings"],
    ["The strong form of the efficient market hypothesis says prices reflect:", "All information, public and private", "Only past prices", "Only public information", "No information"],
    ["The Sharpe ratio is:", "(Portfolio return - risk-free rate) / standard deviation", "Return / beta", "Beta / standard deviation", "Return - inflation"],
    ["A call option gives its holder the right to:", "Buy the asset at the strike price", "Sell the asset at the strike price", "Receive dividends only", "Vote at the AGM"],
    ["Combining two assets with correlation of +1 gives:", "No diversification benefit", "Maximum diversification benefit", "Zero risk", "Negative returns"],
    ["The real interest rate is approximately:", "Nominal rate minus inflation", "Nominal rate plus inflation", "Inflation minus nominal rate", "Always zero"],
  ],
  CPA: [
    ["AICPA stands for:", "American Institute of Certified Public Accountants", "Association of International CPAs", "American Independent Chartered Public Auditors", "Accounting Institute of CPA"],
    ["Who sets US GAAP?", "FASB", "IASB", "PCAOB", "IRS"],
    ["Which of these is a core section of the CPA exam?", "FAR (Financial Accounting and Reporting)", "MKT (Marketing)", "ETH (Ethics Only)", "HRM (Human Resources)"],
    ["The PCAOB oversees:", "Audits of public companies", "Tax collection", "Bank deposits", "Stock prices"],
    ["Which inventory method is allowed under US GAAP but not under IFRS?", "LIFO", "FIFO", "Weighted average", "Specific identification"],
    ["The Sarbanes-Oxley Act was passed in:", "2002", "1933", "1987", "2010"],
    ["Deferred (unearned) revenue is recorded as:", "A liability", "An asset", "Revenue", "Equity"],
    ["The most widely used internal control framework is:", "COSO", "GAAS", "XBRL", "SWIFT"],
    ["Under US GAAP, a loss contingency is recorded when it is:", "Probable and reasonably estimable", "Merely possible", "Remote", "Disclosed by a competitor"],
    ["A statement of cash flows groups cash flows into:", "Operating, investing and financing", "Fixed and variable", "Current and non-current", "Direct and indirect only"],
    ["Treasury stock is:", "A company's own shares that it has bought back", "Government bonds", "Cash held by the treasurer", "Shares of a subsidiary"],
    ["US public companies file their financial statements with:", "The SEC", "FASB", "AICPA", "The Federal Reserve"],
  ],
  CIPM: [
    ["Attracting suitable candidates to apply for a job is called:", "Recruitment", "Selection", "Induction", "Appraisal"],
    ["Choosing the best person from a pool of applicants is:", "Selection", "Recruitment", "Promotion", "Training"],
    ["The most basic level of Maslow's hierarchy of needs is:", "Physiological needs", "Self-actualisation", "Esteem", "Belonging"],
    ["In Herzberg's theory, which is a hygiene factor?", "Salary", "Achievement", "Recognition", "Responsibility"],
    ["Induction (onboarding) is mainly meant to:", "Help new employees settle into the organisation", "Dismiss poor performers", "Negotiate wages", "Audit payroll"],
    ["A 360-degree appraisal gathers feedback from:", "Managers, peers, subordinates and the employee", "The manager only", "Customers only", "The HR director only"],
    ["Job analysis produces:", "A job description and person specification", "A balance sheet", "A pay slip", "A disciplinary letter"],
    ["Collective bargaining is negotiation between:", "Employers and trade unions", "Two competitors", "Banks and borrowers", "Government and the courts"],
    ["Training differs from development because training focuses on:", "Skills for the current job", "Long-term career growth", "Retirement planning", "Company strategy"],
    ["Labour turnover measures:", "The rate at which employees leave", "Total wages paid", "Hours worked", "Sales per employee"],
    ["McGregor's Theory X assumes employees:", "Dislike work and need close control", "Are self-motivated", "Seek responsibility", "Prefer autonomy"],
    ["Nigeria's principal statute on employment conditions is the:", "Labour Act", "Companies and Allied Matters Act", "Banks and Other Financial Institutions Act", "Investments and Securities Act"],
  ],
};

// ICAN questions attach to the existing ICAN programme so the dashboard shows
// them under it; the others are matched by programme code.
const ICAN_PROGRAM_ID = "qXE8sh9l9ncmnb3kWF0z";

// Put the right answer in a different position each time (deterministic, so
// re-running doesn't reshuffle).
function arrange([question, right, ...wrong], n) {
  const pos = (n * 7 + question.length) % 4;
  const options = [...wrong];
  options.splice(pos, 0, right);
  return { question, options, answerIndex: pos };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const nowIso = new Date().toUTCString();
  const writes = [];

  for (const [code, items] of Object.entries(BANK)) {
    items.forEach((item, i) => {
      const { question, options, answerIndex } = arrange(item, i);
      const id = `seed-${code.toLowerCase()}-${String(i + 1).padStart(2, "0")}`;
      writes.push([id, {
        id,
        question,
        options: options.map((text, k) => ({ [`option${k + 1}`]: text })),
        questionAnswer: `option${answerIndex + 1}`,
        program_code: code,
        program_id: code === "ICAN" ? ICAN_PROGRAM_ID : "",
        media: [],
        score: 8,
        status: 1,
        source: "excel-seed",
        dateCreated: nowIso,
        dateModify: nowIso,
      }]);
    });
  }

  const live = await db.collection("gamification").where("status", "==", 1).get();
  const junk = live.docs.filter((d) => d.data().source !== "excel-seed");

  console.log(`${writes.length} questions across ${Object.keys(BANK).length} programmes`);
  console.log(`${junk.length} test questions to unpublish:`);
  junk.forEach((d) => console.log(`  - ${d.id}: ${d.data().question}`));
  if (!apply) return console.log("\nDry run. Re-run with --apply to write.");

  const batch = db.batch();
  for (const [id, data] of writes) batch.set(db.collection("gamification").doc(id), data);
  for (const d of junk) batch.set(d.ref, { status: 0, unpublishedReason: "test data", dateModify: nowIso }, { merge: true });
  await batch.commit();
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
