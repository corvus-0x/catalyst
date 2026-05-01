import { LegalCitation } from "../types";

/**
 * Maps finding rule_id → relevant legal citations.
 *
 * NOTE (April 2026): This file is staged for a citation accuracy review.
 * Several existing entries were written against the pre-14-rule-cut signal
 * set and don't necessarily map to what each active rule actually detects
 * (e.g. SR-006 is now "Schedule L Missing", not the old UCC rule). Entries
 * for cut rules (SR-001, SR-002, SR-007, SR-008, SR-009) have been removed.
 * Active rules without citations here render with no statute pinned to the
 * finding — better than a wrong cite. (QA audit P1 — stale rule references.)
 *
 * Active rule set: SR-003, SR-004, SR-005, SR-006, SR-010, SR-012, SR-013,
 *                  SR-015, SR-017, SR-021, SR-024, SR-025, SR-026, SR-028,
 *                  SR-029.
 */
export const FINDING_CITATIONS: Record<string, LegalCitation[]> = {
    "SR-005": [
        {
            code: "IRC §4941",
            title: "Internal Revenue Code — Taxes on Self-Dealing",
            url: "https://www.law.cornell.edu/uscode/text/26/4941",
        },
        {
            code: "ORC §1702.30",
            title: "Ohio Revised Code — Fiduciary Duty of Directors",
            url: "https://codes.ohio.gov/ohio-revised-code/section-1702.30",
        },
    ],
    "SR-010": [
        {
            code: "IRC §6033",
            title: "Internal Revenue Code — Returns by Exempt Organizations",
            url: "https://www.law.cornell.edu/uscode/text/26/6033",
        },
        {
            code: "IRC §6652(c)",
            title: "Internal Revenue Code — Failure to File Penalty",
            url: "https://www.law.cornell.edu/uscode/text/26/6652",
        },
    ],
    "SR-012": [
        {
            code: "IRS Form 990 Part VI Line 12a",
            title: "IRS Instructions — Conflict of Interest Policy",
            url: "https://www.irs.gov/instructions/i990",
        },
    ],
    "SR-013": [
        {
            code: "IRC §4958",
            title: "Internal Revenue Code — Excess Benefit / Intermediate Sanctions",
            url: "https://www.law.cornell.edu/uscode/text/26/4958",
        },
    ],
    "SR-015": [
        {
            code: "IRC §4941",
            title: "Internal Revenue Code — Taxes on Self-Dealing",
            url: "https://www.law.cornell.edu/uscode/text/26/4941",
        },
        {
            code: "ORC §1702.30",
            title: "Ohio Revised Code — Fiduciary Duty of Directors",
            url: "https://codes.ohio.gov/ohio-revised-code/section-1702.30",
        },
    ],
    "SR-017": [
        {
            code: "ORC §1309",
            title: "Ohio Revised Code — Secured Transactions (UCC Article 9)",
            url: "https://codes.ohio.gov/ohio-revised-code/chapter-1309",
        },
    ],
    "SR-025": [
        {
            code: "IRC §7206",
            title: "Internal Revenue Code — Fraud and False Statements",
            url: "https://www.law.cornell.edu/uscode/text/26/7206",
        },
        {
            code: "IRS Form 990 Part IV Line 28",
            title: "IRS Instructions — Transactions With Interested Persons",
            url: "https://www.irs.gov/instructions/i990",
        },
    ],
    "SR-028": [
        {
            code: "IRS Form 990 Part VI Line 5",
            title: "IRS Instructions — Material Diversion of Assets",
            url: "https://www.irs.gov/instructions/i990",
        },
        {
            code: "IRC §4958",
            title: "Internal Revenue Code — Excess Benefit / Intermediate Sanctions",
            url: "https://www.law.cornell.edu/uscode/text/26/4958",
        },
    ],
    "SR-029": [
        {
            code: "Treas. Reg. §1.501(c)(3)-1(c)(1)",
            title: "Treasury Regulations — Operational Test for Charitable Purpose",
            url: "https://www.law.cornell.edu/cfr/text/26/1.501(c)(3)-1",
        },
    ],
};
