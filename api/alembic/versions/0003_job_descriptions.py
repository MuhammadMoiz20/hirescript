"""job_descriptions table + resume.job_description_id

Revision ID: 0003_job_descriptions
Revises: 0002_resume_protected_terms
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_job_descriptions"
down_revision = "0002_resume_protected_terms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_descriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("company", sa.String(length=200), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column(
            "parsed_json",
            postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite"),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        "resumes",
        sa.Column(
            "job_description_id",
            sa.Integer(),
            sa.ForeignKey("job_descriptions.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("resumes", "job_description_id")
    op.drop_table("job_descriptions")
