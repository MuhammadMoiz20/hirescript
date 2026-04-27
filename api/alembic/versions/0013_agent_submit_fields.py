"""applications: agent submit session + awaiting-confirmation fields

Revision ID: 0013_agent_submit_fields
Revises: 0012_seed_lever_ashby_workable
"""
from alembic import op
import sqlalchemy as sa


revision = "0013_agent_submit_fields"
down_revision = "0012_seed_lever_ashby_workable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "applications",
        sa.Column("agent_session_id", sa.Text(), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column(
            "awaiting_user_confirmation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("applications", "awaiting_user_confirmation")
    op.drop_column("applications", "agent_session_id")
