/**
 * Investigation checklist templates per finding rule_id.
 *
 * Framed as "Investigators typically..." — these are guidance, not
 * prescriptive recommendations. Checklist completion state per case is
 * stored in localStorage.
 *
 * Updated April 2026 to match the active 15-rule signal set after the
 * Session 32 cuts. Entries for cut rules (SR-001/002/007/008/009)
 * removed; entries added for the previously-uncovered active rules
 * SR-012, SR-013, SR-015, SR-017, SR-021, SR-024, SR-025, SR-026,
 * SR-028, SR-029. (QA audit P1 — stale rule references.)
 */

export interface ChecklistTemplate {
    id: string;
    label: string;
}

export const SIGNAL_CHECKLISTS: Record<string, ChecklistTemplate[]> = {
    "SR-003": [
        { id: "sr003-1", label: "Obtain independent appraisal / fair market value" },
        { id: "sr003-2", label: "Compare purchase price to county-assessed value" },
        { id: "sr003-3", label: "Check parcel transaction history at the auditor portal" },
        { id: "sr003-4", label: "Identify both parties to the transaction (grantor / grantee)" },
        { id: "sr003-5", label: "Verify whether either party is a related insider" },
    ],
    "SR-004": [
        { id: "sr004-1", label: "Pull all UCC filings from Ohio SOS for the debtor" },
        { id: "sr004-2", label: "Trace the chain of amendments — same master file number?" },
        { id: "sr004-3", label: "Check for circular assignments / reassignments" },
        { id: "sr004-4", label: "Verify collateral descriptions for consistency across amendments" },
    ],
    "SR-005": [
        { id: "sr005-1", label: "Pull board meeting minutes for vote on transaction" },
        { id: "sr005-2", label: "Check Form 990 Part IV Line 28 / Schedule L for disclosure" },
        { id: "sr005-3", label: "Search county recorder for related-party transfers" },
        { id: "sr005-4", label: "Compare transaction value to fair market value" },
        { id: "sr005-5", label: "Identify all board members at time of transaction" },
    ],
    "SR-006": [
        { id: "sr006-1", label: "Pull the 990 and read Part IV Lines 25-29 for Yes answers" },
        { id: "sr006-2", label: "Verify whether Schedule L is actually attached to the filing" },
        { id: "sr006-3", label: "Identify the related-person counterparty named in Part IV" },
        { id: "sr006-4", label: "Document any loans, grants, or business transactions" },
    ],
    "SR-010": [
        { id: "sr010-1", label: "Search IRS Tax Exempt Organization Search (TEOS)" },
        { id: "sr010-2", label: "Check Ohio Secretary of State business filings" },
        { id: "sr010-3", label: "Verify if EIN was revoked, never issued, or filing was missed" },
        { id: "sr010-4", label: "Compare against ProPublica Nonprofit Explorer history" },
    ],
    "SR-012": [
        { id: "sr012-1", label: "Pull 990 Part VI Line 12a and confirm 'No' answer" },
        { id: "sr012-2", label: "Check meeting minutes for any conflict-of-interest discussions" },
        { id: "sr012-3", label: "Identify whether other governance policies are also missing" },
        { id: "sr012-4", label: "Cross-reference officers against transaction counterparties" },
    ],
    "SR-013": [
        { id: "sr013-1", label: "Read 990 Part VII compensation table line by line" },
        { id: "sr013-2", label: "Check Schedule J for compensation from related orgs" },
        { id: "sr013-3", label: "Review hours-per-week column — full-time officers at $0?" },
        { id: "sr013-4", label: "Look for hidden compensation in expense detail" },
    ],
    "SR-015": [
        { id: "sr015-1", label: "Pull the deed from the county recorder for the transaction" },
        { id: "sr015-2", label: "Verify grantor and grantee identities through SOS / SSN" },
        { id: "sr015-3", label: "Identify all charity officers at the transaction date" },
        { id: "sr015-4", label: "Map family / business relationships between officers and parties" },
        { id: "sr015-5", label: "Compare transaction price to assessed value" },
    ],
    "SR-017": [
        { id: "sr017-1", label: "Pull the UCC filing from Ohio SOS for full collateral text" },
        { id: "sr017-2", label: "Check whether the debtor entity holds charitable assets" },
        { id: "sr017-3", label: "Identify the secured party — bank, insider, or related org?" },
        { id: "sr017-4", label: "Review charity board minutes for lien-authorizing votes" },
    ],
    "SR-021": [
        { id: "sr021-1", label: "Compare 3+ years of 990s for revenue line items" },
        { id: "sr021-2", label: "Identify whether the spike is from contributions, program, or other" },
        { id: "sr021-3", label: "Check for related new programs that could explain growth" },
        { id: "sr021-4", label: "Review revenue recognition methodology disclosure" },
    ],
    "SR-024": [
        { id: "sr024-1", label: "Trace the full property transaction chain (every grantor/grantee)" },
        { id: "sr024-2", label: "Check 990 Schedule L for any related-party disclosures" },
        { id: "sr024-3", label: "Compare each chain step's price to fair market value" },
        { id: "sr024-4", label: "Identify which chain step transferred value to an insider" },
    ],
    "SR-025": [
        { id: "sr025-1", label: "Pull the 990 Part IV Line 28 answer and Schedule L absence" },
        { id: "sr025-2", label: "Document the contradicting evidence (deeds, relationships)" },
        { id: "sr025-3", label: "Identify the named officer/insider on both sides" },
        { id: "sr025-4", label: "Preserve a copy of the filed 990 for evidentiary purposes" },
    ],
    "SR-026": [
        { id: "sr026-1", label: "Pull 990 Part IV Line 25 and Schedule J independent-contractor data" },
        { id: "sr026-2", label: "Compare to building permits, vendor lists, or trade publications" },
        { id: "sr026-3", label: "Identify the contractor and any insider connection" },
        { id: "sr026-4", label: "Document the work performed and the value involved" },
    ],
    "SR-028": [
        { id: "sr028-1", label: "Read the Schedule O written explanation for Part VI Line 5" },
        { id: "sr028-2", label: "Identify the dollar amount of the diversion / misuse" },
        { id: "sr028-3", label: "Determine whether law enforcement or auditors were notified" },
        { id: "sr028-4", label: "Request governance documents related to the diversion event" },
    ],
    "SR-029": [
        { id: "sr029-1", label: "Compute true program-services ratio from Part IX functional expenses" },
        { id: "sr029-2", label: "Compare to peer organizations in the same NTEE code" },
        { id: "sr029-3", label: "Identify what 'other expenses' actually contains" },
        { id: "sr029-4", label: "Check whether expense growth tracks program growth" },
    ],
};

/* ── localStorage helpers for checklist state ──────────────── */

const STORAGE_KEY = "catalyst_checklist_state";

interface ChecklistState {
    [caseId_ruleId_itemId: string]: boolean;
}

function loadChecklistState(): ChecklistState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveChecklistState(state: ChecklistState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // localStorage full or unavailable — fail silently
    }
}

export function getChecklistItemChecked(caseId: string, ruleId: string, itemId: string): boolean {
    const state = loadChecklistState();
    return !!state[`${caseId}:${ruleId}:${itemId}`];
}

export function setChecklistItemChecked(
    caseId: string,
    ruleId: string,
    itemId: string,
    checked: boolean,
): void {
    const state = loadChecklistState();
    const key = `${caseId}:${ruleId}:${itemId}`;
    if (checked) {
        state[key] = true;
    } else {
        delete state[key];
    }
    saveChecklistState(state);
}
