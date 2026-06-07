# Add FuzzyMatchCandidate — persisted near-match queue for investigator
# review (replaces the previous behavior of computing fuzzy candidates
# in entity_resolution and discarding them after a single log line).
# QA audit P1: makes "human-in-the-loop entity resolution" actually true.

import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('investigations', '0025_inflight_ai_pattern_unique'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='FuzzyMatchCandidate',
            fields=[
                (
                    'id',
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    'entity_type',
                    models.CharField(
                        help_text="'person' or 'organization' — matches FindingEntity.entity_type",
                        max_length=20,
                    ),
                ),
                ('incoming_raw', models.CharField(max_length=500)),
                ('incoming_normalized', models.CharField(max_length=500)),
                (
                    'existing_entity_id',
                    models.UUIDField(
                        help_text='The Person.id or Organization.id this candidate was matched against.',
                    ),
                ),
                (
                    'existing_raw',
                    models.CharField(
                        blank=True,
                        default='',
                        help_text='Denormalized name on the existing entity at the time of detection.',
                        max_length=500,
                    ),
                ),
                (
                    'similarity',
                    models.FloatField(
                        help_text='SequenceMatcher ratio (0.0–1.0). >= FUZZY_REVIEW_THRESHOLD.'
                    ),
                ),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('PENDING', 'Pending review'),
                            ('MERGED', 'Accepted — merged into existing entity'),
                            ('DISMISSED', 'Dismissed — not the same entity'),
                        ],
                        default='PENDING',
                        max_length=16,
                    ),
                ),
                ('detected_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                (
                    'case',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='fuzzy_match_candidates',
                        to='investigations.case',
                    ),
                ),
                (
                    'detected_in_document',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='fuzzy_match_candidates',
                        to='investigations.document',
                    ),
                ),
                (
                    'resolved_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='fuzzy_resolutions',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'db_table': 'fuzzy_match_candidates',
                'ordering': ['-detected_at'],
                'indexes': [
                    models.Index(
                        fields=['case', 'status'], name='idx_fuzzy_case_status'
                    ),
                    models.Index(
                        fields=['entity_type'], name='idx_fuzzy_entity_type'
                    ),
                ],
                'constraints': [
                    models.UniqueConstraint(
                        fields=[
                            'case',
                            'entity_type',
                            'existing_entity_id',
                            'incoming_normalized',
                        ],
                        name='uq_fuzzy_per_pair',
                    ),
                ],
            },
        ),
    ]
