"""Agentic services — autonomous Claude SDK loops with web/tool surfaces.

Each module here owns a narrow agent task with a strict JSON envelope so
the calling job runner can persist the output without further LLM calls.
"""
