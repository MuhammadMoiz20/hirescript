"""tiers + claude_usage + notifications

Revision ID: 0010_tiers_usage_notifications
Revises: 0009_postings_applications
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_tiers_usage_notifications"
down_revision = "0009_postings_applications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tiers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.Text(), nullable=False, unique=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("min_fit_score", sa.Integer(), nullable=False),
        sa.Column("daily_cap", sa.Integer(), nullable=False),
        sa.Column("default_mode", sa.Text(), nullable=False),
        sa.Column("tailor_model", sa.Text(), nullable=False),
        sa.Column(
            "classify_model",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'haiku-4.5'"),
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )

    # Seed the four canonical tiers. 999 is the "effectively unlimited"
    # sentinel for `dream`; `skip` uses 0 to disable A-mode entirely.
    op.bulk_insert(
        sa.table(
            "tiers",
            sa.column("slug", sa.Text()),
            sa.column("display_name", sa.Text()),
            sa.column("min_fit_score", sa.Integer()),
            sa.column("daily_cap", sa.Integer()),
            sa.column("default_mode", sa.Text()),
            sa.column("tailor_model", sa.Text()),
            sa.column("classify_model", sa.Text()),
            sa.column("enabled", sa.Boolean()),
        ),
        [
            {
                "slug": "dream",
                "display_name": "Dream",
                "min_fit_score": 85,
                "daily_cap": 999,
                "default_mode": "B",
                "tailor_model": "opus-4.7",
                "classify_model": "haiku-4.5",
                "enabled": True,
            },
            {
                "slug": "targeted",
                "display_name": "Targeted",
                "min_fit_score": 65,
                "daily_cap": 20,
                "default_mode": "A",
                "tailor_model": "sonnet-4.6",
                "classify_model": "haiku-4.5",
                "enabled": True,
            },
            {
                "slug": "wide_net",
                "display_name": "Wide net",
                "min_fit_score": 40,
                "daily_cap": 50,
                "default_mode": "A",
                "tailor_model": "sonnet-4.6",
                "classify_model": "haiku-4.5",
                "enabled": True,
            },
            {
                "slug": "skip",
                "display_name": "Skip",
                "min_fit_score": 0,
                "daily_cap": 0,
                "default_mode": "B",
                "tailor_model": "haiku-4.5",
                "classify_model": "haiku-4.5",
                "enabled": True,
            },
        ],
    )

    op.create_table(
        "claude_usage",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("client", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("task_kind", sa.Text(), nullable=False),
        sa.Column(
            "input_tokens",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "output_tokens",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_claude_usage_client_started",
        "claude_usage",
        ["client", sa.text("started_at DESC")],
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "delivered_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "read_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_notifications_user_created",
        "notifications",
        ["user_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_claude_usage_client_started", table_name="claude_usage")
    op.drop_table("claude_usage")
    op.drop_table("tiers")
