"""applications: persist verifier output

Revision ID: 0011_application_verify
Revises: 0010_tiers_usage_notifications
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0011_application_verify"
down_revision = "0010_tiers_usage_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "applications",
        sa.Column("verify_ok", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column(
            "verify_issues",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "applications",
        sa.Column("verify_rationale", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("applications", "verify_rationale")
    op.drop_column("applications", "verify_issues")
    op.drop_column("applications", "verify_ok")
