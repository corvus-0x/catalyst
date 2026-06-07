# Race-proof the 409-on-double-click check for AI pattern analysis (QA P1).
#
# The view holds a row lock on Case before checking for an in-flight job, but
# the worker flips QUEUED -> RUNNING in a separate transaction outside that
# lock. A partial unique index on (case, job_type) for status in
# (QUEUED, RUNNING) AND job_type='AI_PATTERN_ANALYSIS' ensures that even
# under any race condition, two concurrent enqueues cannot succeed.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('investigations', '0024_document_sha256_unique'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='searchjob',
            constraint=models.UniqueConstraint(
                fields=['case', 'job_type'],
                condition=(
                    models.Q(status__in=['QUEUED', 'RUNNING'])
                    & models.Q(job_type='AI_PATTERN_ANALYSIS')
                ),
                name='uq_one_inflight_ai_pattern_per_case',
            ),
        ),
    ]
