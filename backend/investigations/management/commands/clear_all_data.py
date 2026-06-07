"""
Management command: clear_all_data

Deletes every investigation record from the database so the app can be
re-seeded from scratch. Django system tables (users, sessions, migrations,
permissions) are left untouched.

Deletion order matters because several models carry
``on_delete=models.RESTRICT`` on their Case FK — Postgres will refuse to
delete a Case row while any of those child rows still reference it.  We
therefore delete children before parents, working from the most-nested
junction tables up to Case itself.

Usage:
    python manage.py clear_all_data --confirm

The --confirm flag is required to prevent accidental runs.
"""

from django.core.management.base import BaseCommand

from investigations.models import (
    Address,
    AuditLog,
    Case,
    Document,
    FinancialInstrument,
    FinancialSnapshot,
    Finding,
    FindingDocument,
    FindingEntity,
    InvestigatorNote,
    OrgAddress,
    Organization,
    OrgDocument,
    Person,
    PersonAddress,
    PersonDocument,
    PersonOrganization,
    Property,
    PropertyTransaction,
    Relationship,
    TransactionChain,
    TransactionChainLink,
)


class Command(BaseCommand):
    help = (
        "Deletes ALL investigation data so the database can be re-seeded. "
        "Preserves Django users and system tables. Requires --confirm."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Required. Pass --confirm to actually delete data.",
        )

    def handle(self, *args, **options):
        if not options["confirm"]:
            self.stdout.write(
                self.style.ERROR(
                    "Aborted. Pass --confirm to delete data.\n"
                    "Run: python manage.py clear_all_data --confirm"
                )
            )
            return

        self.stdout.write(self.style.WARNING("Clearing all investigation data…"))

        # ------------------------------------------------------------------
        # Step 1 — Documents
        # Document.case has on_delete=RESTRICT, so documents must go before
        # cases.  Junction tables that reference Document (PersonDocument,
        # OrgDocument, FindingDocument) use CASCADE, but we delete them
        # explicitly here so the log output is clear.
        # ------------------------------------------------------------------
        count, _ = FindingDocument.objects.all().delete()
        self.stdout.write(f"  Deleted {count} FindingDocument(s)")

        count, _ = FindingEntity.objects.all().delete()
        self.stdout.write(f"  Deleted {count} FindingEntity record(s)")

        count, _ = PersonDocument.objects.all().delete()
        self.stdout.write(f"  Deleted {count} PersonDocument(s)")

        count, _ = OrgDocument.objects.all().delete()
        self.stdout.write(f"  Deleted {count} OrgDocument(s)")

        count, _ = Document.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Document(s)")

        # ------------------------------------------------------------------
        # Step 2 — Persons
        # Person.case has on_delete=RESTRICT.  Clear junction tables that
        # reference Person first (PersonOrganization, PersonAddress,
        # PersonDocument already gone above).
        # ------------------------------------------------------------------
        count, _ = PersonOrganization.objects.all().delete()
        self.stdout.write(f"  Deleted {count} PersonOrganization(s)")

        count, _ = PersonAddress.objects.all().delete()
        self.stdout.write(f"  Deleted {count} PersonAddress(es)")

        count, _ = Person.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Person(s)")

        # ------------------------------------------------------------------
        # Step 3 — Organizations
        # Organization.case has on_delete=RESTRICT.
        # ------------------------------------------------------------------
        count, _ = OrgAddress.objects.all().delete()
        self.stdout.write(f"  Deleted {count} OrgAddress(es)")

        count, _ = Organization.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Organization(s)")

        # ------------------------------------------------------------------
        # Step 4 — Properties
        # Property.case has on_delete=RESTRICT.
        # ------------------------------------------------------------------
        count, _ = TransactionChainLink.objects.all().delete()
        self.stdout.write(f"  Deleted {count} TransactionChainLink(s)")

        count, _ = TransactionChain.objects.all().delete()
        self.stdout.write(f"  Deleted {count} TransactionChain(s)")

        count, _ = PropertyTransaction.objects.all().delete()
        self.stdout.write(f"  Deleted {count} PropertyTransaction(s)")

        count, _ = Property.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Propert(y/ies)")

        # ------------------------------------------------------------------
        # Step 5 — FinancialInstruments
        # FinancialInstrument.case has on_delete=RESTRICT.
        # ------------------------------------------------------------------
        count, _ = FinancialInstrument.objects.all().delete()
        self.stdout.write(f"  Deleted {count} FinancialInstrument(s)")

        # ------------------------------------------------------------------
        # Step 6 — Addresses
        # Address.case has on_delete=RESTRICT (via OrgAddress / PersonAddress,
        # already cleared above).  Delete standalone Address rows now.
        # ------------------------------------------------------------------
        count, _ = Address.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Address(es)")

        # ------------------------------------------------------------------
        # Step 7 — Remaining case-level records before Case itself
        # ------------------------------------------------------------------
        count, _ = Finding.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Finding(s)")

        count, _ = Relationship.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Relationship(s)")

        count, _ = FinancialSnapshot.objects.all().delete()
        self.stdout.write(f"  Deleted {count} FinancialSnapshot(s)")

        count, _ = InvestigatorNote.objects.all().delete()
        self.stdout.write(f"  Deleted {count} InvestigatorNote(s)")

        count, _ = AuditLog.objects.all().delete()
        self.stdout.write(f"  Deleted {count} AuditLog(s)")

        # ------------------------------------------------------------------
        # Step 8 — Cases (root table, deleted last)
        # ------------------------------------------------------------------
        count, _ = Case.objects.all().delete()
        self.stdout.write(f"  Deleted {count} Case(s)")

        self.stdout.write(
            self.style.SUCCESS(
                "\nDone. All investigation data has been cleared.\n"
                "Run `python manage.py seed_demo` to re-populate with demo data."
            )
        )
