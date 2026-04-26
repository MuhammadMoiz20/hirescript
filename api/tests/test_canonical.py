"""Tests for app.services.canonical.canonicalize."""

from __future__ import annotations

from app.services.canonical import canonicalize


def test_canonicalize_strips_inc():
    assert canonicalize("Anthropic, Inc.", "https://x.com/y") == canonicalize(
        "Anthropic", "https://x.com/y"
    )


def test_canonicalize_strips_llc_and_ltd():
    a = canonicalize("Foo LLC", "https://x.com/y")
    b = canonicalize("Foo Ltd.", "https://x.com/y")
    c = canonicalize("Foo", "https://x.com/y")
    assert a == c
    assert b == c


def test_canonicalize_lowercases_company():
    assert canonicalize("ANTHROPIC", "https://x.com/y") == canonicalize(
        "anthropic", "https://x.com/y"
    )


def test_canonicalize_strips_query_params():
    a = canonicalize("Foo", "https://x.com/y?utm_source=email")
    b = canonicalize("Foo", "https://x.com/y")
    assert a == b


def test_canonicalize_strips_gh_jid_param():
    a = canonicalize("Foo", "https://boards.greenhouse.io/foo/jobs/123?gh_jid=4567")
    b = canonicalize("Foo", "https://boards.greenhouse.io/foo/jobs/123")
    assert a == b


def test_canonicalize_strips_fragment():
    a = canonicalize("Foo", "https://x.com/y#apply")
    b = canonicalize("Foo", "https://x.com/y")
    assert a == b


def test_canonicalize_strips_trailing_slash():
    assert canonicalize("F", "https://x.com/y/") == canonicalize(
        "F", "https://x.com/y"
    )


def test_canonicalize_preserves_path():
    a = canonicalize("F", "https://x.com/jobs/eng/123")
    assert "jobs/eng/123" in a


def test_canonicalize_handles_no_company():
    out = canonicalize(None, "https://x.com/y")
    assert "::" not in out or out.startswith("::")
    assert "x.com/y" in out


def test_canonicalize_handles_empty_company():
    assert canonicalize("", "https://x.com/y") == canonicalize(
        None, "https://x.com/y"
    )


def test_canonicalize_separator_present_when_both_provided():
    out = canonicalize("Foo", "https://x.com/y")
    assert "foo::" in out


def test_canonicalize_distinct_companies_distinct_keys():
    assert canonicalize("Foo", "https://x.com/y") != canonicalize(
        "Bar", "https://x.com/y"
    )
