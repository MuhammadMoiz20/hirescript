FROM python:3.12-slim

# Tectonic — single binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    libgraphite2-3 libfontconfig1 libfreetype6 libharfbuzz0b libssl3 \
 && curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net \
    | sh \
 && mv tectonic /usr/local/bin/ \
 && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Node + Claude CLI for claude-agent-sdk
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]"

# Playwright + Chromium for the submit_application runner. We install only
# chromium (not webkit/firefox) to keep the image as small as possible while
# still satisfying the Greenhouse adapter. ``install-deps chromium`` pulls in
# the apt packages Chromium needs to launch headlessly.
RUN python -m playwright install --with-deps chromium

COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
