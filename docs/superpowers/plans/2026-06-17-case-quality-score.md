# Case Quality Score

## Goal
Add a deterministic, explainable Case quality score based on the existing referral-readiness checklist.

## Tasks
- Extract referral-readiness assembly into a shared backend helper.
- Compute quality score, grade, status, and top issues from readiness items.
- Return quality from referral-readiness and dashboard endpoints.
- Update TypeScript API types.
- Render compact Case quality in the Investigate right panel.
- Update API contract documentation.
- Add/extend backend tests.
- Verify with targeted backend tests and `npx tsc --noEmit`.

## Scoring
Readiness item weights:
- `citation_coverage`: 25
- `evidence_weight`: 20
- `confirmed_angles`: 20
- `failed_extraction`: 15
- `referral_target`: 10
- `pending_connections`: 4
- `pending_extraction`: 3
- `active_jobs`: 3

PASS earns full weight, WARN earns half, FAIL earns zero. Any FAIL caps the score at 69. Any WARN caps the score at 89. All PASS can reach 100.

Status/grade:
- Any FAIL: `BLOCKED` / `Blocked`
- WARN with no FAIL: `NEEDS_REVIEW` / `Review needed`
- All PASS: `READY` / `Strong`

Top issues include only FAIL/WARN, sorted FAIL before WARN while preserving readiness order inside each severity, max three.
