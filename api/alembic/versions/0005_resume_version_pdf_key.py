"""resume_versions.compiled_pdf_key column

Revision ID: 0005_resume_version_pdf_key
Revises: 0004_resume_versions
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_resume_version_pdf_key"
down_revision = "0004_resume_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resume_versions",
        sa.Column("compiled_pdf_key", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("resume_versions", "compiled_pdf_key")
