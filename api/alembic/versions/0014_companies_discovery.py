"""companies: discovered_by + discovery_rationale (agentic discovery)

Revision ID: 0014_companies_discovery
Revises: 0013_agent_submit_fields
"""
from alembic import op
import sqlalchemy as sa


revision = "0014_companies_discovery"
down_revision = "0013_agent_submit_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("discovered_by", sa.Text(), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column("discovery_rationale", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("companies", "discovery_rationale")
    op.drop_column("companies", "discovered_by")
