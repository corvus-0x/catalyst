# Document SHA-256 dedup constraint (QA audit P0 #4).
#
# Re-uploading the same file on the same case previously created a fresh
# Document row, re-ran the entity-extraction pipeline, and produced
# duplicate Persons / Organizations / Findings. This adds a uniqueness
# guarantee at the DB layer; the view also short-circuits before saving
# the file.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('investigations', '0023_ai_source_and_jobtype'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='document',
            constraint=models.UniqueConstraint(
                fields=['case', 'sha256_hash'],
                name='uq_documents_case_sha256',
            ),
        ),
    ]
