from app.services.protected_terms import BASE_PROTECTED_VERBS, resolve_protected_terms


def test_base_present():
    out = resolve_protected_terms()
    for v in BASE_PROTECTED_VERBS:
        assert v.lower() in out


def test_dedups_case_insensitive():
    out = resolve_protected_terms(user_pinned=["LED", "led", "Led"])
    assert out.count("led") == 1


def test_strips_and_skips_empty():
    out = resolve_protected_terms(user_pinned=["  reduced  ", "", "   "])
    assert "reduced" in out


def test_jd_terms_merged():
    out = resolve_protected_terms(jd_terms=["Kubernetes", "GraphQL"])
    assert "kubernetes" in out
    assert "graphql" in out


def test_sorted_for_stability():
    out = resolve_protected_terms(user_pinned=["zeta", "alpha"])
    assert out == sorted(out)
