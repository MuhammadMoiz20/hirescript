"""resume one_line_per_bullet

Revision ID: 0901de54f319
Revises: 0016_seed_simplify
Create Date: 2026-05-13 19:05:02.183610

Adds ``resumes.one_line_per_bullet`` (Boolean NOT NULL, server_default
``true``). Server default of ``true`` means existing rows backfill to
``true`` so today's strict one-line behavior is preserved on upgrade;
the Python-side ORM default for newly constructed Resume instances is
``False`` (per the one-line opt-in design — new resumes start lax).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0901de54f319'
down_revision: Union[str, None] = '0016_seed_simplify'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'resumes',
        sa.Column(
            'one_line_per_bullet',
            sa.Boolean(),
            server_default=sa.text('true'),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('resumes', 'one_line_per_bullet')
