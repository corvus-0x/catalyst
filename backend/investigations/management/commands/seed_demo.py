"""
seed_demo management command
============================
Creates a comprehensive demo case with realistic data that exercises every
part of the Catalyst system. The demo case showcases:
  - Multiple entity types (persons, organizations, properties)
  - Relationships and connections (family, business, board roles)
  - Financial data (FinancialSnapshots from 990 filings)
  - Property transactions with fraud patterns
  - Documents (metadata only—no actual files)
  - Findings generated from signal rules
  - Full fraud signal detection pipeline

The fictional scenario: "Bright Future Foundation"
  - 501(c)(3) nonprofit in Ohio
  - Founded 2015, revenue grew $85K → $4.2M (2016-2021)
  - Executive director married to board member (conflict of interest)
  - Related LLC: Mitchell Development Group (real estate transactions)
  - Property transactions at inflated/zero prices with related parties
  - Zero officer compensation despite $4M+ revenue
  - No conflict-of-interest policy
  - 990 Form says "Yes" to related-party transactions but no Schedule L filed

Usage:
    python manage.py seed_demo            # create demo case (idempotent)
    python manage.py seed_demo --reset    # delete & recreate
"""

import sys
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from investigations.models import (
    Address,
    AddressType,
    AuditAction,
    AuditLog,
    Case,
    CaseStatus,
    Document,
    DocumentType,
    EvidenceWeight,
    ExtractionStatus,
    FinancialSnapshot,
    Finding,
    FindingDocument,
    FindingEntity,
    FindingSource,
    FindingStatus,
    InvestigatorNote,
    OcrStatus,
    Organization,
    OrganizationStatus,
    OrganizationType,
    OrgDocument,
    Person,
    PersonDocument,
    PersonOrganization,
    PersonRole,
    Property,
    PropertyTransaction,
    Relationship,
    RelationshipSource,
    RelationshipType,
    Severity,
    TransactionPartyType,
)


class Command(BaseCommand):
    help = (
        "Seed a comprehensive demo case with realistic fraud investigation "
        "data showcasing the full Catalyst pipeline."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete the existing demo case before recreating it",
        )

    def handle(self, *args, **options):
        # Windows consoles default to cp1252, which can't encode the ✓ glyphs
        # this command prints — that crashed seeding mid-run. Force UTF-8.
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")

        DEMO_CASE_NAME = "Bright Future Foundation Investigation"

        if options["reset"]:
            # Delete related objects first due to RESTRICT constraints
            case = Case.objects.filter(name=DEMO_CASE_NAME).first()
            if case:
                # Delete in reverse dependency order
                Finding.objects.filter(case=case).delete()
                Document.objects.filter(case=case).delete()
                FinancialSnapshot.objects.filter(case=case).delete()
                Property.objects.filter(case=case).delete()
                Address.objects.filter(case=case).delete()
                Relationship.objects.filter(case=case).delete()
                Organization.objects.filter(case=case).delete()
                Person.objects.filter(case=case).delete()
                case.delete()
                self.stdout.write("Deleted existing demo case.")

        case, created = Case.objects.get_or_create(
            name=DEMO_CASE_NAME,
            defaults={
                "status": CaseStatus.ACTIVE,
                "notes": (
                    "Comprehensive demo case showcasing the full Catalyst fraud "
                    "investigation pipeline. Based on a fictional Ohio nonprofit "
                    "with rapid revenue growth, insider board relationships, and "
                    "related-party property transactions at inflated prices."
                ),
            },
        )

        if not created:
            self.stdout.write(
                self.style.WARNING(
                    f"Demo case already exists: {case.id}  (use --reset to recreate)"
                )
            )
            self.stdout.write(f"CASE_ID={case.id}")
            return

        with transaction.atomic():
            self._create_demo_data(case)

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("✓ Demo case created successfully!"))
        self.stdout.write(f"CASE_ID={case.id}")
        self.stdout.write("")
        self.stdout.write("To explore the demo case:")
        self.stdout.write(f"  http://localhost:5173/cases/{case.id}")

    def _create_demo_data(self, case: Case):
        """Create all demo entities, relationships, and findings."""

        # ────────────────────────────────────────────────────────────────
        # 1. ORGANIZATIONS
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating organizations...")
        bff, _ = Organization.objects.get_or_create(
            case=case,
            name="Bright Future Foundation",
            defaults={
                "ein": "31-1234567",
                "registration_state": "OH",
                "org_type": OrganizationType.CHARITY,
                "status": OrganizationStatus.ACTIVE,
                "address": "123 Oak Street, Columbus, OH 43215",
                "phone": "(614) 555-0100",
                "email": "info@brightfuture.org",
            },
        )

        mitchell_dev, _ = Organization.objects.get_or_create(
            case=case,
            name="Mitchell Development Group LLC",
            defaults={
                "registration_state": "OH",
                "org_type": OrganizationType.LLC,
                "status": OrganizationStatus.ACTIVE,
                "address": "456 Business Park Dr, Columbus, OH 43219",
            },
        )

        self.stdout.write(self.style.SUCCESS(f"  ✓ {bff.name}"))
        self.stdout.write(self.style.SUCCESS(f"  ✓ {mitchell_dev.name}"))

        # ────────────────────────────────────────────────────────────────
        # 2. PERSONS
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating persons...")
        sarah, _ = Person.objects.get_or_create(
            case=case,
            full_name="Sarah Mitchell",
            defaults={
                "role_tags": [PersonRole.OFFICER],
                "address": "789 Maple Ave, Columbus, OH 43216",
                "email": "sarah@brightfuture.org",
                "phone": "(614) 555-0101",
            },
        )

        james, _ = Person.objects.get_or_create(
            case=case,
            full_name="James Mitchell",
            defaults={
                "role_tags": [PersonRole.BOARD_MEMBER],
                "address": "789 Maple Ave, Columbus, OH 43216",
            },
        )

        david, _ = Person.objects.get_or_create(
            case=case,
            full_name="David Chen",
            defaults={
                "role_tags": [PersonRole.BOARD_MEMBER, PersonRole.OFFICER],
                "email": "dchen@businessmail.com",
                "phone": "(614) 555-0102",
            },
        )

        rachel, _ = Person.objects.get_or_create(
            case=case,
            full_name="Rachel Torres",
            defaults={
                "role_tags": [PersonRole.BOARD_MEMBER],
            },
        )

        for person in [sarah, james, david, rachel]:
            self.stdout.write(self.style.SUCCESS(f"  ✓ {person.full_name}"))

        # ────────────────────────────────────────────────────────────────
        # 3. PERSON-ORGANIZATION ROLES
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating person-organization roles...")
        PersonOrganization.objects.get_or_create(
            person=sarah,
            org=bff,
            role="Executive Director",
            defaults={"start_date": "2015-03-15"},
        )
        PersonOrganization.objects.get_or_create(
            person=sarah,
            org=mitchell_dev,
            role="Manager",
        )
        PersonOrganization.objects.get_or_create(
            person=james,
            org=bff,
            role="Board Member",
        )
        PersonOrganization.objects.get_or_create(
            person=james,
            org=mitchell_dev,
            role="Member",
        )
        PersonOrganization.objects.get_or_create(
            person=david,
            org=bff,
            role="Treasurer / Board Member",
        )
        PersonOrganization.objects.get_or_create(
            person=rachel,
            org=bff,
            role="Secretary / Board Member",
        )
        self.stdout.write(self.style.SUCCESS("  ✓ All person-org roles created"))

        # ────────────────────────────────────────────────────────────────
        # 4. RELATIONSHIPS (FAMILY)
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating relationships...")
        Relationship.objects.get_or_create(
            case=case,
            person_a=sarah,
            person_b=james,
            relationship_type=RelationshipType.SPOUSE,
            defaults={
                "source": RelationshipSource.INVESTIGATOR,
                "confidence": 1.0,
            },
        )
        self.stdout.write(self.style.SUCCESS("  ✓ Sarah ↔ James (SPOUSE)"))

        # ────────────────────────────────────────────────────────────────
        # 5. ADDRESSES
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating addresses...")
        oak_st_addr, _ = Address.objects.get_or_create(
            case=case,
            raw_text="1250 Oak Street, Columbus, OH 43215",
            defaults={
                "street": "1250 Oak Street",
                "city": "Columbus",
                "state": "OH",
                "zip_code": "43215",
                "county": "Franklin",
                "address_type": AddressType.PROPERTY,
            },
        )

        elm_ave_addr, _ = Address.objects.get_or_create(
            case=case,
            raw_text="875 Elm Avenue, Columbus, OH 43217",
            defaults={
                "street": "875 Elm Avenue",
                "city": "Columbus",
                "state": "OH",
                "zip_code": "43217",
                "county": "Franklin",
                "address_type": AddressType.PROPERTY,
            },
        )

        self.stdout.write(self.style.SUCCESS(f"  ✓ {oak_st_addr.raw_text}"))
        self.stdout.write(self.style.SUCCESS(f"  ✓ {elm_ave_addr.raw_text}"))

        # ────────────────────────────────────────────────────────────────
        # 6. PROPERTIES
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating properties...")
        prop_oak, _ = Property.objects.get_or_create(
            case=case,
            parcel_number="R-2024-0891",
            defaults={
                "address": "1250 Oak Street, Columbus, OH 43215",
                "county": "Franklin",
                "state": "OH",
                "assessed_value": Decimal("180000.00"),
                "purchase_price": Decimal("425000.00"),
                "property_type": "COMMERCIAL",
                "current_owner_name": "Bright Future Foundation",
                "normalized_address": oak_st_addr,
            },
        )

        prop_elm, _ = Property.objects.get_or_create(
            case=case,
            parcel_number="R-2024-1456",
            defaults={
                "address": "875 Elm Avenue, Columbus, OH 43217",
                "county": "Franklin",
                "state": "OH",
                "assessed_value": Decimal("220000.00"),
                "purchase_price": Decimal("0.00"),
                "property_type": "VACANT_LAND",
                "current_owner_name": "James Mitchell / Personal Trust",
                "normalized_address": elm_ave_addr,
            },
        )

        self.stdout.write(
            self.style.SUCCESS(f"  ✓ {prop_oak.address} (parcel {prop_oak.parcel_number})")
        )
        self.stdout.write(
            self.style.SUCCESS(f"  ✓ {prop_elm.address} (parcel {prop_elm.parcel_number})")
        )

        # ────────────────────────────────────────────────────────────────
        # 7. PROPERTY TRANSACTIONS
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating property transactions...")

        # BFF bought 1250 Oak from Mitchell Dev at inflated price
        txn1, _ = PropertyTransaction.objects.get_or_create(
            property=prop_oak,
            transaction_date="2021-06-28",
            defaults={
                "buyer_id": bff.id,
                "buyer_type": TransactionPartyType.ORGANIZATION,
                "buyer_name": bff.name,
                "seller_id": mitchell_dev.id,
                "seller_type": TransactionPartyType.ORGANIZATION,
                "seller_name": mitchell_dev.name,
                "price": Decimal("425000.00"),
                "instrument_number": "2021-0045678",
            },
        )

        # Mitchell Dev transferred 875 Elm to James for $0
        txn2, _ = PropertyTransaction.objects.get_or_create(
            property=prop_elm,
            transaction_date="2021-08-15",
            defaults={
                "buyer_id": james.id,
                "buyer_type": TransactionPartyType.PERSON,
                "buyer_name": james.full_name,
                "seller_id": mitchell_dev.id,
                "seller_type": TransactionPartyType.ORGANIZATION,
                "seller_name": mitchell_dev.name,
                "price": Decimal("0.00"),
                "instrument_number": "2021-0058901",
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                "  ✓ BFF bought 1250 Oak from Mitchell Dev @ $425K (assessed: $180K)"
            )
        )
        self.stdout.write(self.style.SUCCESS("  ✓ Mitchell Dev transferred 875 Elm to James @ $0"))

        # ────────────────────────────────────────────────────────────────
        # 8. DOCUMENTS (Metadata Only)
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating document records...")

        # Create minimal document records (no actual files). `extracted_text`
        # holds realistic OCR-style excerpts so the document workspace has
        # something to display for recruiters / demo viewers.
        docs_data = [
            {
                "filename": "BFF_Form990_2021.pdf",
                "display_name": "2021-12-31_BFF_IRS_990.pdf",
                "doc_type": DocumentType.IRS_990,
                "file_path": "/mnt/documents/990/2021/",
                "sha256_hash": "a" * 64,
                "file_size": 245000,
                "extracted_text": (
                    "FORM 990  Return of Organization Exempt From Income Tax\n"
                    "For the 2021 calendar year\n"
                    "Name of organization: BRIGHT FUTURE FOUNDATION\n"
                    "EIN: 31-1234567   State of incorporation: OH\n"
                    "Address: 123 Oak Street, Columbus, OH 43215\n\n"
                    "Part I — Summary\n"
                    "Total revenue (Line 12): $4,200,000\n"
                    "Total expenses (Line 18): $4,050,000\n"
                    "Net assets, end of year (Line 22): $403,000\n"
                    "Number of voting members of governing body: 4\n"
                    "Number of employees: 2\n\n"
                    "Part IV — Checklist of Required Schedules\n"
                    "Line 28a — Did the organization have a transaction with a "
                    "related party (officer, director, key employee)? YES\n"
                    "Schedule L attached: NO\n\n"
                    "Part VII — Compensation of Officers, Directors, Trustees\n"
                    "Sarah Mitchell, Executive Director — $0\n"
                    "James Mitchell, Board Member — $0\n"
                    "David Chen, Treasurer — $0\n"
                    "Rachel Torres, Secretary — $0\n"
                ),
                "linked_orgs": [(bff, "Filer of the 2021 Form 990")],
                "linked_persons": [
                    (sarah, "Listed as Executive Director, Part VII"),
                    (james, "Listed as Board Member, Part VII"),
                    (david, "Listed as Treasurer, Part VII"),
                    (rachel, "Listed as Secretary, Part VII"),
                ],
            },
            {
                "filename": "BFF_Form990_2020.pdf",
                "display_name": "2020-12-31_BFF_IRS_990.pdf",
                "doc_type": DocumentType.IRS_990,
                "file_path": "/mnt/documents/990/2020/",
                "sha256_hash": "b" * 64,
                "file_size": 238000,
                "extracted_text": (
                    "FORM 990  Return of Organization Exempt From Income Tax\n"
                    "For the 2020 calendar year\n"
                    "Name of organization: BRIGHT FUTURE FOUNDATION\n"
                    "EIN: 31-1234567   State of incorporation: OH\n\n"
                    "Part I — Summary\n"
                    "Total revenue (Line 12): $2,800,000\n"
                    "Total expenses (Line 18): $2,720,000\n"
                    "Net assets, end of year (Line 22): $253,000\n\n"
                    "Part VII — Compensation of Officers\n"
                    "Sarah Mitchell, Executive Director — $0\n"
                    "James Mitchell, Board Member — $0\n"
                    "David Chen, Treasurer — $0\n"
                ),
                "linked_orgs": [(bff, "Filer of the 2020 Form 990")],
                "linked_persons": [
                    (sarah, "Listed as Executive Director, Part VII"),
                    (james, "Listed as Board Member, Part VII"),
                ],
            },
            {
                "filename": "Deed_1250_Oak_St.pdf",
                "display_name": "2021-06-28_Property_Deed_Oak.pdf",
                "doc_type": DocumentType.DEED,
                "file_path": "/mnt/documents/deeds/",
                "sha256_hash": "c" * 64,
                "file_size": 150000,
                "extracted_text": (
                    "GENERAL WARRANTY DEED\n"
                    "Instrument number: 2021-0045678\n"
                    "Recorded: June 28, 2021, Franklin County, Ohio\n\n"
                    "GRANTOR: Mitchell Development Group LLC, an Ohio limited "
                    "liability company\n"
                    "GRANTEE: Bright Future Foundation, an Ohio nonprofit "
                    "corporation\n\n"
                    "For valuable consideration in the sum of FOUR HUNDRED "
                    "TWENTY-FIVE THOUSAND DOLLARS ($425,000.00), receipt of "
                    "which is hereby acknowledged, GRANTOR conveys to GRANTEE "
                    "the following described real property:\n\n"
                    "Parcel R-2024-0891, situated at 1250 Oak Street, "
                    "Columbus, OH 43215, Franklin County.\n\n"
                    "Signed: Sarah Mitchell, Manager of Mitchell Development "
                    "Group LLC."
                ),
                "linked_orgs": [
                    (bff, "Grantee on the deed"),
                    (mitchell_dev, "Grantor on the deed"),
                ],
                "linked_persons": [
                    (sarah, "Signed as Manager of Mitchell Development Group LLC"),
                ],
            },
            {
                "filename": "Deed_875_Elm_Ave.pdf",
                "display_name": "2021-08-15_Property_Deed_Elm.pdf",
                "doc_type": DocumentType.DEED,
                "file_path": "/mnt/documents/deeds/",
                "sha256_hash": "d" * 64,
                "file_size": 145000,
                "extracted_text": (
                    "QUITCLAIM DEED\n"
                    "Instrument number: 2021-0058901\n"
                    "Recorded: August 15, 2021, Franklin County, Ohio\n\n"
                    "GRANTOR: Mitchell Development Group LLC\n"
                    "GRANTEE: James Mitchell, individually\n\n"
                    "For consideration of ZERO DOLLARS ($0.00), GRANTOR "
                    "quitclaims to GRANTEE all interest in the following:\n\n"
                    "Parcel R-2024-1456, located at 875 Elm Avenue, "
                    "Columbus, OH 43217, Franklin County.\n\n"
                    "Signed: Sarah Mitchell, Manager of Mitchell Development "
                    "Group LLC."
                ),
                "linked_orgs": [(mitchell_dev, "Grantor on the deed")],
                "linked_persons": [
                    (james, "Grantee on the deed (received property at $0)"),
                    (sarah, "Signed as Manager of grantor LLC"),
                ],
            },
            {
                "filename": "BFF_Articles_Incorporation.pdf",
                "display_name": "2015-03-15_BFF_Corp_Articles.pdf",
                "doc_type": DocumentType.CORP_FILING,
                "file_path": "/mnt/documents/corp/",
                "sha256_hash": "e" * 64,
                "file_size": 50000,
                "extracted_text": (
                    "ARTICLES OF INCORPORATION\n"
                    "State of Ohio — Domestic Nonprofit Corporation\n"
                    "Filed: March 15, 2015\n\n"
                    "Name of corporation: BRIGHT FUTURE FOUNDATION\n"
                    "Principal office: 123 Oak Street, Columbus, OH 43215\n"
                    "Purpose: Charitable and educational under IRC 501(c)(3).\n\n"
                    "Initial Directors:\n"
                    "  Sarah Mitchell, Executive Director\n"
                    "  David Chen\n\n"
                    "Statutory agent: Sarah Mitchell, 789 Maple Ave, "
                    "Columbus, OH 43216."
                ),
                "linked_orgs": [(bff, "Subject of articles of incorporation")],
                "linked_persons": [
                    (sarah, "Listed as initial Executive Director and statutory agent"),
                    (david, "Listed as initial Director"),
                ],
            },
            {
                "filename": "Mitchell_Dev_Formation.pdf",
                "display_name": "2019-01-20_Mitchell_Dev_LLC_Formation.pdf",
                "doc_type": DocumentType.CORP_FILING,
                "file_path": "/mnt/documents/corp/",
                "sha256_hash": "f" * 64,
                "file_size": 45000,
                "extracted_text": (
                    "ARTICLES OF ORGANIZATION\n"
                    "State of Ohio — Limited Liability Company\n"
                    "Filed: January 20, 2019\n\n"
                    "Name of LLC: MITCHELL DEVELOPMENT GROUP LLC\n"
                    "Principal office: 456 Business Park Dr, "
                    "Columbus, OH 43219\n"
                    "Purpose: Real estate acquisition, development, and "
                    "management.\n\n"
                    "Manager: Sarah Mitchell\n"
                    "Member: James Mitchell\n\n"
                    "Statutory agent: Sarah Mitchell."
                ),
                "linked_orgs": [(mitchell_dev, "Subject of LLC articles of organization")],
                "linked_persons": [
                    (sarah, "Listed as Manager and statutory agent"),
                    (james, "Listed as Member"),
                ],
            },
            {
                "filename": "Ohio_AOS_Audit_2020.pdf",
                "display_name": "2020-11-10_Ohio_AOS_Audit_Report.pdf",
                "doc_type": DocumentType.AUDITOR,
                "file_path": "/mnt/documents/government/",
                "sha256_hash": "1" * 64,
                "file_size": 85000,
                "extracted_text": (
                    "OHIO AUDITOR OF STATE — REGULAR AUDIT REPORT\n"
                    "Subject: Bright Future Foundation\n"
                    "Period covered: Fiscal year ending Dec 31, 2020\n"
                    "Report issued: November 10, 2020\n\n"
                    "Findings:\n"
                    "  1. Lack of documented internal control procedures over "
                    "expenditure approval.\n"
                    "  2. No conflict-of-interest policy on file despite "
                    "evidence of related-party transactions.\n"
                    "  3. Board minutes do not reflect approval of property "
                    "acquisitions over $100,000.\n\n"
                    "Recommendation: Adopt written internal control policies "
                    "and a conflict-of-interest disclosure procedure."
                ),
                "linked_orgs": [(bff, "Subject of the audit")],
                "linked_persons": [
                    (david, "Treasurer at time of audit; signatory on response letter"),
                ],
            },
        ]

        docs = {}
        for doc_data in docs_data:
            doc, _ = Document.objects.get_or_create(
                case=case,
                filename=doc_data["filename"],
                defaults={
                    "display_name": doc_data["display_name"],
                    "doc_type": doc_data["doc_type"],
                    "file_path": doc_data["file_path"],
                    "sha256_hash": doc_data["sha256_hash"],
                    "file_size": doc_data["file_size"],
                    "ocr_status": OcrStatus.COMPLETED,
                    "extraction_status": ExtractionStatus.COMPLETED,
                    "extracted_text": doc_data["extracted_text"],
                },
            )
            docs[doc_data["filename"]] = doc
            self.stdout.write(self.style.SUCCESS(f"  ✓ {doc_data['display_name']}"))

        # ────────────────────────────────────────────────────────────────
        # 9. DOCUMENT LINKS
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Linking documents to entities...")

        for doc_data in docs_data:
            doc = docs[doc_data["filename"]]
            for org, note in doc_data.get("linked_orgs", []):
                OrgDocument.objects.get_or_create(
                    org=org,
                    document=doc,
                    defaults={"context_note": note},
                )
            for person, note in doc_data.get("linked_persons", []):
                PersonDocument.objects.get_or_create(
                    person=person,
                    document=doc,
                    defaults={"context_note": note},
                )

        self.stdout.write(self.style.SUCCESS("  ✓ Documents linked to entities"))

        # ────────────────────────────────────────────────────────────────
        # 10. FINANCIAL SNAPSHOTS (990 Data)
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating financial snapshots...")

        snapshot_data = [
            {
                "tax_year": 2016,
                "total_revenue": 85000,
                "total_expenses": 72000,
                "net_assets_eoy": 43000,
            },
            {
                "tax_year": 2017,
                "total_revenue": 156000,
                "total_expenses": 141000,
                "net_assets_eoy": 58000,
            },
            {
                "tax_year": 2018,
                "total_revenue": 890000,
                "total_expenses": 845000,
                "net_assets_eoy": 103000,
            },
            {
                "tax_year": 2019,
                "total_revenue": 1650000,
                "total_expenses": 1580000,
                "net_assets_eoy": 173000,
            },
            {
                "tax_year": 2020,
                "total_revenue": 2800000,
                "total_expenses": 2720000,
                "net_assets_eoy": 253000,
            },
            {
                "tax_year": 2021,
                "total_revenue": 4200000,
                "total_expenses": 4050000,
                "net_assets_eoy": 403000,
            },
        ]

        for snap_data in snapshot_data:
            doc = (
                docs.get("BFF_Form990_2021.pdf")
                if (snap_data["tax_year"] == 2021)
                else docs.get("BFF_Form990_2020.pdf")
            )

            FinancialSnapshot.objects.get_or_create(
                document=doc or docs["BFF_Form990_2021.pdf"],
                case=case,
                tax_year=snap_data["tax_year"],
                defaults={
                    "organization": bff,
                    "ein": "31-1234567",
                    "form_type": "990",
                    "total_contributions": int(snap_data["total_revenue"]),
                    "program_service_revenue": 0,
                    "investment_income": 0,
                    "other_revenue": 0,
                    "total_revenue": snap_data["total_revenue"],
                    "grants_paid": int(snap_data["total_revenue"] * Decimal("0.15")),
                    "salaries_and_compensation": int(snap_data["total_revenue"] * Decimal("0.0")),
                    "professional_fundraising": int(snap_data["total_revenue"] * Decimal("0.10")),
                    "other_expenses": int(snap_data["total_revenue"] * Decimal("0.25")),
                    "total_expenses": snap_data["total_expenses"],
                    "net_assets_eoy": snap_data["net_assets_eoy"],
                    "num_employees": 2,
                    "num_voting_members": 4,
                    "officer_compensation_total": 0,
                    "source": "EXTRACTED",
                    "confidence": 1.0,
                },
            )

            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✓ 990 {snap_data['tax_year']}: ${snap_data['total_revenue']:,} revenue"
                )
            )

        # ────────────────────────────────────────────────────────────────
        # 11. FINDINGS (Fraud Signals)
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating findings...")

        findings_data = [
            {
                "rule_id": "SR-003",
                "title": "VALUATION_ANOMALY — Property purchased at 136% above assessed value",
                "description": (
                    "1250 Oak Street assessed at $180,000 but purchased by "
                    "Bright Future Foundation from Mitchell Development Group "
                    "for $425,000 on 2021-06-28. Price deviation is 136% above "
                    "assessed value, suggesting either inflated price or "
                    "artificially depressed assessment."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.DOCUMENTED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "County assessor records show 1250 Oak Street with a fair "
                    "market assessment of $180,000. County recorder deed "
                    "records (instrument #2021-0045678) show BFF purchased the "
                    "property for $425,000 from Mitchell Development Group, a "
                    "company where BFF's Executive Director (Sarah Mitchell) is "
                    "listed as manager. The 136% price premium is consistent "
                    "with asset stripping or self-dealing."
                ),
                "legal_refs": ["26 U.S.C. § 4941", "ORC § 1702.33"],
                "trigger_entity_id": bff.id,
                "trigger_entity_type": "organization",
            },
            {
                "rule_id": "SR-005",
                "title": "ZERO_CONSIDERATION — Property transferred for $0 between related parties",
                "description": (
                    "875 Elm Avenue transferred by Mitchell Development Group "
                    "to James Mitchell (board member) for zero consideration on "
                    "2021-08-15. A zero-consideration transfer to a family "
                    "member of the charity's executive leadership suggests "
                    "asset stripping or undisclosed self-dealing."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.TRACED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "Deed records (instrument #2021-0058901) show 875 Elm Avenue "
                    "transferred from Mitchell Development Group (entity controlled "
                    "by insiders) to James Mitchell for $0. James Mitchell is a "
                    "board member and spouse of Sarah Mitchell (ED). This is a "
                    "classic insider swap: Mitchell Dev transfers charity-adjacent "
                    "property to insider with no compensation."
                ),
                "legal_refs": ["26 U.S.C. § 4941", "18 U.S.C. § 666"],
                "trigger_entity_id": james.id,
                "trigger_entity_type": "person",
            },
            {
                "rule_id": "SR-006",
                "title": "SCHEDULE_L_MISSING — 990 Part IV Line 28 answered "
                "'Yes' but no Schedule L attached",
                "description": (
                    "Form 990 (2021) Part IV Line 28 (Related organization "
                    "transactions) answered 'Yes', indicating the organization "
                    "had related-party transactions, but Schedule L (Transactions "
                    "With Interested Persons) was not filed, which is required "
                    "by IRS regulations."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.DOCUMENTED,
                "source": FindingSource.AUTO,
                "legal_refs": ["26 U.S.C. § 6011", "IRS Form 990 Instructions"],
                "trigger_entity_id": bff.id,
                "trigger_entity_type": "organization",
            },
            {
                "rule_id": "SR-012",
                "title": "NO_COI_POLICY — Organization lacks conflict-of-interest "
                "policy despite material revenue",
                "description": (
                    "Bright Future Foundation is a $4.2M revenue organization with "
                    "board members having direct family relationships and business "
                    "interests, yet no conflict-of-interest policy is documented "
                    "in the case file or mentioned in 990 governance schedules."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.DOCUMENTED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "Executive Director Sarah Mitchell is married to board member "
                    "James Mitchell. Both are officers/managers of Mitchell "
                    "Development Group, which made property transactions with the "
                    "foundation. The absence of a COI policy despite these "
                    "relationships violates IRS best practices and state "
                    "nonprofit law."
                ),
                "legal_refs": ["ORC § 1702.33", "IRS Form 990 Part VI"],
                "trigger_entity_id": bff.id,
                "trigger_entity_type": "organization",
            },
            {
                "rule_id": "SR-013",
                "title": "ZERO_OFFICER_PAY — $0 officer compensation at $4.2M revenue organization",
                "description": (
                    "Form 990 (2021) Part VII shows $0 in officer compensation "
                    "for Bright Future Foundation despite $4.2M in total revenue. "
                    "This is implausible for a multi-million-dollar nonprofit and "
                    "suggests compensation may be routed through related entities."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.DOCUMENTED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "Part VII compensation table shows Executive Director and "
                    "board members with $0 compensation. At a $4.2M revenue "
                    "organization, $0 officer pay is implausible and suggests "
                    "that compensation is being paid through other entities "
                    "(likely Mitchell Development Group or management fee "
                    "arrangements)."
                ),
                "legal_refs": ["26 U.S.C. § 4958", "IRS Form 990 Part VII"],
                "trigger_entity_id": sarah.id,
                "trigger_entity_type": "person",
            },
            {
                "rule_id": "SR-015",
                "title": "INSIDER_SWAP — Related party on both sides of property transaction",
                "description": (
                    "Sarah Mitchell (Executive Director) appears on both sides of "
                    "property transactions: (1) BFF purchased 1250 Oak for $425K "
                    "from Mitchell Development Group (where she is manager), and "
                    "(2) her spouse James Mitchell received 875 Elm for $0 from "
                    "the same company. This is a classic insider swap pattern."
                ),
                "severity": Severity.CRITICAL,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.TRACED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "The transaction chain shows: (1) Mitchell Dev buys property "
                    "X, transfers it to BFF at inflated price (Sarah as manager); "
                    "(2) Mitchell Dev has property Y, transfers it to James "
                    "(Sarah's spouse) for $0. Sarah and James are the key "
                    "insiders in both Mitchell Dev and BFF leadership. This is "
                    "a textbook insider swap."
                ),
                "legal_refs": ["26 U.S.C. § 4941", "18 U.S.C. § 666"],
                "trigger_entity_id": sarah.id,
                "trigger_entity_type": "person",
            },
            {
                "rule_id": "SR-021",
                "title": "REVENUE_SPIKE — Year-over-year revenue increase exceeds 100%",
                "description": (
                    "Bright Future Foundation's revenue increased from $156,000 "
                    "(2017) to $890,000 (2018), a 471% increase. From 2019 to "
                    "2020, revenue jumped from $1.65M to $2.8M (70% increase). "
                    "Sustained 70%+ YoY growth is unusual and warrants review of "
                    "revenue sources."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.NEEDS_EVIDENCE,
                "evidence_weight": EvidenceWeight.DIRECTIONAL,
                "source": FindingSource.AUTO,
                "legal_refs": ["IRS Form 990 Part I"],
                "trigger_entity_id": bff.id,
                "trigger_entity_type": "organization",
            },
            {
                "rule_id": "SR-025",
                "title": "FALSE_DISCLOSURE — 990 Form denies related-party "
                "transactions; evidence contradicts",
                "description": (
                    "Form 990 Part IV contains contradictory statements: "
                    "Line 28 (related-party transactions) answered 'Yes', but "
                    "elsewhere the form claims no material transactions with "
                    "insiders. County recorder records show property transfers "
                    "between the foundation and insider-controlled entities."
                ),
                "severity": Severity.CRITICAL,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.TRACED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "Form 990 Part IV Line 28 = Yes (org had related-party txns) "
                    "but the narrative sections claim arm's-length dealing. "
                    "County recorder records, however, show: (1) BFF bought "
                    "1250 Oak from Mitchell Dev (insider company); (2) James "
                    "Mitchell (board member) received property from Mitchell Dev. "
                    "The form misrepresents the extent and nature of insider "
                    "transactions."
                ),
                "legal_refs": ["26 U.S.C. § 6652", "18 U.S.C. § 1001"],
                "trigger_entity_id": bff.id,
                "trigger_entity_type": "organization",
            },
            {
                "rule_id": "SR-029",
                "title": "LOW_PROGRAM_RATIO — Program expenses only 38% of total",
                "description": (
                    "In 2021, Bright Future Foundation spent approximately 38% "
                    "of total expenses on program services. IRS guidance and state "
                    "law generally recommend ≥50% for nonprofits of this type and "
                    "size. Low program ratio suggests overhead bloat or diversion "
                    "of funds."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.CONFIRMED,
                "evidence_weight": EvidenceWeight.DOCUMENTED,
                "source": FindingSource.AUTO,
                "narrative": (
                    "Form 990 Part I (2021): Total expenses $4.05M, grants paid "
                    "$630K (15%), admin/salaries $1.62M (40%), other $0.81M (20%), "
                    "fundraising $0.42M (10%), program $1.50M (38%). The 38% "
                    "program ratio is below recommended thresholds. The fact that "
                    "$0 in salaries are reported but the organization clearly has "
                    "staff suggests compensation is routed elsewhere."
                ),
                "legal_refs": ["ORC § 1702.33", "IRS Form 990 Part I"],
                "trigger_entity_id": bff.id,
                "trigger_entity_type": "organization",
            },
        ]

        for finding_data in findings_data:
            trigger_entity_id = finding_data.pop("trigger_entity_id", None)
            trigger_entity_type = finding_data.pop("trigger_entity_type", None)
            finding, _ = Finding.objects.get_or_create(
                case=case,
                rule_id=finding_data["rule_id"],
                defaults=finding_data,
            )

            if trigger_entity_id:
                finding.trigger_entity_id = trigger_entity_id
                finding.save()
                # Mirror the trigger entity into the FindingEntity link table
                # so the entity detail page can list this finding under its
                # related-findings panel.
                if trigger_entity_type:
                    FindingEntity.objects.get_or_create(
                        finding=finding,
                        entity_id=trigger_entity_id,
                        entity_type=trigger_entity_type,
                        defaults={"context_note": "Trigger entity for this rule"},
                    )

            # Link to trigger document if available
            if finding_data["rule_id"] in ["SR-003", "SR-005"]:
                doc = (
                    docs.get("Deed_1250_Oak_St.pdf")
                    if (finding_data["rule_id"] == "SR-003")
                    else docs.get("Deed_875_Elm_Ave.pdf")
                )
                if doc:
                    FindingDocument.objects.get_or_create(
                        finding=finding,
                        document=doc,
                        defaults={
                            "page_reference": "Page 1",
                            "context_note": "Transaction evidence",
                        },
                    )

            # SR-015 INSIDER_SWAP involves both insiders — add the second entity link
            if finding_data["rule_id"] == "SR-015":
                FindingEntity.objects.get_or_create(
                    finding=finding,
                    entity_id=james.id,
                    entity_type="person",
                    defaults={"context_note": "Second insider: received property at $0"},
                )

            self.stdout.write(
                self.style.SUCCESS(f"  ✓ {finding_data['rule_id']}: {finding_data['title'][:50]}")
            )

        # ────────────────────────────────────────────────────────────────
        # 11a. AI FINDING (seeded to demonstrate AI pattern analysis)
        # ────────────────────────────────────────────────────────────────

        ai_finding, _ = Finding.objects.get_or_create(
            case=case,
            rule_id="",
            title="Timeline compression: multiple transactions within 30-day window",
            defaults={
                "description": (
                    "Bright Future Foundation, James Mitchell, and two property transactions "
                    "(1250 Oak Street and 875 Elm Avenue) share an unusually compressed timeline "
                    "across three documents. The BFF board meeting minutes, the Oak Street deed, "
                    "and the Elm Avenue deed all fall within a 49-day window (June 28 – August 15, "
                    "2021), suggesting coordinated execution of a pre-arranged insider scheme."
                ),
                "severity": "INFORMATIONAL",
                "status": "NEW",
                "evidence_weight": "DIRECTIONAL",
                "source": FindingSource.AI,
                "narrative": "",
                "legal_refs": [],
                "evidence_snapshot": {
                    "rationale": (
                        "Two property deeds and contemporaneous board minutes fall within a "
                        "49-day window. Coordinated timing between BFF governance records and "
                        "recorder filings is consistent with pre-planned insider dealing."
                    ),
                    "suggested_action": (
                        "Pull all deed transfers within 60 days of the BFF board meeting minutes"
                    ),
                    "doc_refs": ["Doc-1", "Doc-3"],
                    "doc_ref_resolution": {
                        "Doc-1": "STUB_DOC_1",
                        "Doc-3": "STUB_DOC_3",
                    },
                },
            },
        )

        # Link AI finding to both the org and the person at the center of the pattern
        FindingEntity.objects.get_or_create(
            finding=ai_finding,
            entity_id=bff.id,
            entity_type="organization",
            defaults={"context_note": "Foundation involved in compressed-timeline transactions"},
        )
        FindingEntity.objects.get_or_create(
            finding=ai_finding,
            entity_id=james.id,
            entity_type="person",
            defaults={"context_note": "Insider who received property in the same window"},
        )

        self.stdout.write(
            self.style.SUCCESS(
                "  ✓ AI: Timeline compression: multiple transactions within 30-day window"
            )
        )

        # ────────────────────────────────────────────────────────────────
        # 12. INVESTIGATOR NOTES
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating investigator notes...")

        InvestigatorNote.objects.get_or_create(
            case=case,
            target_type="Case",
            target_id=case.id,
            defaults={
                "content": (
                    "Initial case opened based on IRS Form 990 anomalies: "
                    "zero officer compensation, rapid revenue growth (85K→4.2M), "
                    "and suspicious property transactions. County recorder search "
                    "revealed two properties transferred between foundation and "
                    "insider-controlled LLC. Related parties (ED + spouse) are "
                    "officers of both entities. Further investigation needed on "
                    "revenue sources and asset appraisals."
                ),
            },
        )

        InvestigatorNote.objects.get_or_create(
            case=case,
            target_type="Organization",
            target_id=bff.id,
            defaults={
                "content": (
                    "Two of four board members are married to each other "
                    "(Sarah & James Mitchell). Both are also officers/managers of "
                    "Mitchell Development Group, which has made property deals "
                    "with the foundation. COI policy is absent."
                ),
            },
        )

        InvestigatorNote.objects.get_or_create(
            case=case,
            target_type="Person",
            target_id=sarah.id,
            defaults={
                "content": (
                    "Sarah Mitchell is ED of BFF and Manager of Mitchell Dev. "
                    "Her spouse James is board member at BFF and Member of "
                    "Mitchell Dev. Need to pull Sarah's personal tax returns to "
                    "see if she's claiming self-employment income or rental income "
                    "from these entities."
                ),
            },
        )

        self.stdout.write(self.style.SUCCESS("  ✓ Investigator notes created"))

        # ────────────────────────────────────────────────────────────────
        # 13. AUDIT LOG ENTRIES
        # ────────────────────────────────────────────────────────────────

        self.stdout.write("Creating audit log entries...")

        AuditLog.log(
            action=AuditAction.RECORD_CREATED,
            table_name="cases",
            record_id=case.id,
            case_id=case.id,
            performed_by="seed_demo",
            notes="Demo case created",
        )

        AuditLog.log(
            action=AuditAction.FINDING_CREATED,
            table_name="findings",
            case_id=case.id,
            performed_by="seed_demo",
            notes=f"Created {len(findings_data)} demo findings",
        )

        self.stdout.write(self.style.SUCCESS("  ✓ Audit log entries created"))
