"""companies + job_postings + applications + answer_cache

Revision ID: 0009_postings_applications
Revises: 0008_kb_tables
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_postings_applications"
down_revision = "0008_kb_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.Text(), nullable=False, unique=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'greenhouse'"),
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "job_postings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_job_id", sa.Text(), nullable=False),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("apply_url", sa.Text(), nullable=False),
        sa.Column("description_html", sa.Text(), nullable=True),
        sa.Column("description_text", sa.Text(), nullable=False),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("tier", sa.Text(), nullable=True),
        sa.Column("fit_score", sa.Integer(), nullable=True),
        sa.Column("classification_rationale", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'new'"),
        ),
        sa.Column("canonical_key", sa.Text(), nullable=True),
        sa.Column(
            "ingested_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id",
            "source",
            "source_job_id",
            name="uq_job_postings_user_source_job",
        ),
    )
    op.create_index(
        "ix_job_postings_user_status_ingested",
        "job_postings",
        ["user_id", "status", sa.text("ingested_at DESC")],
    )

    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "posting_id",
            sa.Integer(),
            sa.ForeignKey("job_postings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mode",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'B'"),
        ),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "resume_variant_id",
            sa.Integer(),
            sa.ForeignKey("resumes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cover_letter_text", sa.Text(), nullable=True),
        sa.Column(
            "form_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("confirmation_html", sa.Text(), nullable=True),
        sa.Column("confirmation_screenshot_path", sa.Text(), nullable=True),
        sa.Column("canonical_key", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "prepared_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_applications_user_canonical_key",
        "applications",
        ["user_id", "canonical_key"],
        unique=True,
    )
    op.create_index(
        "ix_applications_user_status_prepared",
        "applications",
        ["user_id", "status", sa.text("prepared_at DESC")],
    )

    op.create_table(
        "answer_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("question_hash", sa.Text(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=False),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id", "question_hash", name="uq_answer_cache_user_qhash"
        ),
    )


def downgrade() -> None:
    op.drop_table("answer_cache")
    op.drop_index(
        "ix_applications_user_status_prepared", table_name="applications"
    )
    op.drop_index("ix_applications_user_canonical_key", table_name="applications")
    op.drop_table("applications")
    op.drop_index(
        "ix_job_postings_user_status_ingested", table_name="job_postings"
    )
    op.drop_table("job_postings")
    op.drop_table("companies")
