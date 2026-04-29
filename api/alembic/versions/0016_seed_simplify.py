"""seed simplify (github-curated) repos as companies

Adds the two SimplifyJobs community-maintained repos as ``companies`` rows
under ``source='simplify'`` so the periodic ingest scheduler picks them up.

Each row's ``slug`` is the GitHub repo name; the SimplifyJobs adapter
fetches ``raw.githubusercontent.com/SimplifyJobs/<slug>/<branch>/README.md``
and parses every markdown table row into a posting whose ``apply_url``
points to the underlying ATS posting. The existing canonical-key dedup
collapses these against direct ATS ingestion.

Revision ID: 0016_seed_simplify
Revises: 0015_application_research
"""
from alembic import op


revision = "0016_seed_simplify"
down_revision = "0015_application_research"
branch_labels = None
depends_on = None


_SIMPLIFY_COMPANIES: list[tuple[str, str, str]] = [
    # (source, slug, display_name)
    ("simplify", "New-Grad-Positions", "Simplify — New Grad Positions"),
    ("simplify", "Summer2025-Internships", "Simplify — Summer 2025 Internships"),
]


def upgrade() -> None:
    for source, slug, display in _SIMPLIFY_COMPANIES:
        op.execute(
            f"""
            INSERT INTO companies (slug, display_name, source, enabled)
            VALUES ('{slug}', '{display.replace("'", "''")}', '{source}', true)
            ON CONFLICT (slug, source) DO NOTHING
            """
        )


def downgrade() -> None:
    for source, slug, _display in _SIMPLIFY_COMPANIES:
        op.execute(
            f"DELETE FROM companies WHERE slug='{slug}' AND source='{source}'"
        )
