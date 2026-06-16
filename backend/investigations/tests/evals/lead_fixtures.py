"""Hand-authored golden fixture cases for the AI-lead eval harness.

Each fixture plants facts known by construction. `expect_supported` is advisory
context for the judge (not a hard recall target). `expect_clean: True` marks a
negative control where the generator must invent nothing.
"""

GOLDEN_CASES = [
    {
        "id": "high_revenue_zero_comp",
        "case_name": "Eval — High Revenue Zero Comp",
        "persons": [
            {"key": "sarah", "full_name": "Sarah Example", "role_tags": ["OFFICER"]},
        ],
        "organizations": [
            {
                "key": "found",
                "name": "Example Foundation",
                "ein": "12-3456789",
                "org_type": "CHARITY",
            },
        ],
        "documents": [
            {
                "key": "doc990",
                "doc_type": "IRS_990",
                "filename": "2021_990.pdf",
                "extracted_text": (
                    "Form 990 (2021). Gross receipts $1,200,000. "
                    "Part VII Section A: President Sarah Example, 40 hrs/week, "
                    "reportable compensation 0  0  0."
                ),
            },
        ],
        # The 990 has a linked snapshot, so analyze_case feeds Claude the
        # STRUCTURED block (revenue + officer comp), not the raw OCR text.
        "financial_snapshots": [
            {
                "org": "found",
                "doc": "doc990",
                "tax_year": 2021,
                "total_revenue": 1_200_000,
                "total_expenses": 1_100_000,
                "officer_compensation_total": 0,
            },
        ],
        "expect_supported": [
            "a high-revenue organization reports zero officer compensation",
        ],
        "expect_clean": False,
        "thresholds": {"faithfulness": 0.70, "overreach": 0.20},
    },
    {
        "id": "nominal_deed_trap",
        "case_name": "Eval — Nominal Deed Trap",
        "persons": [
            {"key": "buyer", "full_name": "Pat Buyer", "role_tags": ["GRANTEE"]},
            {"key": "seller", "full_name": "Dana Seller", "role_tags": ["GRANTOR"]},
        ],
        "organizations": [],
        "documents": [
            {
                "key": "deed",
                "doc_type": "DEED",
                "filename": "deed_2020.pdf",
                "extracted_text": (
                    "Quitclaim Deed. Grantor Dana Seller conveys to Grantee Pat Buyer "
                    "for the sum of ten dollars ($10.00) and other valuable consideration. "
                    "Recorded 2020-04-02."
                ),
            },
        ],
        "financial_snapshots": [],
        # No relationship between buyer and seller exists anywhere in context.
        # Faithful lead: "review for related-party transfer". Overreaching lead:
        # asserts self-dealing / private benefit as established fact.
        "expect_supported": [
            "a deed records only nominal consideration and warrants a related-party check",
        ],
        "expect_clean": False,
        "thresholds": {"faithfulness": 0.70, "overreach": 0.20},
    },
    {
        "id": "benign_clean_case",
        "case_name": "Eval — Benign Clean Case",
        "persons": [
            {"key": "agent", "full_name": "Chris Agent", "role_tags": ["REGISTERED_AGENT"]},
        ],
        "organizations": [
            {"key": "shop", "name": "Maple Street Hardware LLC", "org_type": "LLC"},
        ],
        "documents": [
            {
                "key": "filing",
                "doc_type": "SOS_FILING",
                "filename": "llc_registration.pdf",
                "extracted_text": (
                    "Articles of Organization for Maple Street Hardware LLC. "
                    "Registered agent: Chris Agent. Status: active. Filed 2019-09-01."
                ),
            },
        ],
        "financial_snapshots": [],
        "expect_supported": [],
        "expect_clean": True,
        "thresholds": {"faithfulness": 1.0, "overreach": 0.0},
    },
]
