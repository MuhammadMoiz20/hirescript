"""application_research table — dream-tier research briefs

Revision ID: 0015_application_research
Revises: 0014_companies_discovery
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0015_application_research"
down_revision = "0014_companies_discovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_research",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "application_id",
            sa.Integer(),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("brief_md", sa.Text(), nullable=False),
        sa.Column(
            "signals_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("application_research")
