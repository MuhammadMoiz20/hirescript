BASE_PROTECTED_VERBS: list[str] = [
    "led","architected","shipped","reduced","migrated","owned","automated",
    "scaled","implemented","designed","negotiated","drove","launched",
    "optimized","integrated","built","engineered","developed","authored",
    "delivered","standardized","cut","translated","refactored","pioneered",
]


def resolve_protected_terms(
    *, user_pinned: list[str] | None = None, jd_terms: list[str] | None = None
) -> list[str]:
    """Return BASE ∪ jd_terms ∪ user_pinned, dedup'd, lowercased, sorted for stability."""
    out: set[str] = {t.lower().strip() for t in BASE_PROTECTED_VERBS}
    if jd_terms:
        out.update(t.lower().strip() for t in jd_terms if t.strip())
    if user_pinned:
        out.update(t.lower().strip() for t in user_pinned if t.strip())
    return sorted(out)
