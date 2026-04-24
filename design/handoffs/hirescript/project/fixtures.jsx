// HireScript — seed data
// Plausible software engineer resume + 2 variants + 6 history rows + 3 JDs.

const MASTER_TEX = `\\documentclass[10pt,letterpaper]{article}
\\usepackage[margin=0.5in]{geometry}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
  {\\LARGE \\textbf{Maya Okafor}} \\\\[2pt]
  Software Engineer \\textbullet\\ Brooklyn, NY \\\\
  maya@okafor.dev \\textbullet\\ +1 (646) 555-0139 \\textbullet\\ github.com/maya-ok
\\end{center}

\\section*{Experience}
\\textbf{Senior Software Engineer} \\hfill \\textit{Stratacore} \\\\
\\textit{Aug 2022 -- Present} \\hfill New York, NY
\\begin{itemize}[leftmargin=*,nosep]
  \\item Led migration of the payments ledger from Postgres to a sharded CockroachDB cluster, cutting p99 write latency from 140ms to 38ms.
  \\item Designed the feature-flag service used by 140+ engineers; authored the Go SDK and handled on-call rotation ownership.
  \\item Mentored four engineers through promotion; rewrote the onboarding runbook.
\\end{itemize}

\\textbf{Software Engineer} \\hfill \\textit{Lintern} \\\\
\\textit{Jun 2019 -- Aug 2022} \\hfill Remote
\\begin{itemize}[leftmargin=*,nosep]
  \\item Built the core type-inference engine for the Lintern static analyzer in Rust; shipped to 12k paying seats.
  \\item Owned the VS Code extension; took ratings from 3.8 to 4.7 over 11 months.
\\end{itemize}

\\section*{Projects}
\\textbf{tinyrope} --- a 600-line LaTeX-aware diff tool in Rust. 2.1k stars. \\\\
\\textbf{pdfpeek} --- browser extension for inline PDF annotation, 40k weekly users.

\\section*{Education}
\\textbf{B.S. Computer Science}, Carnegie Mellon University \\hfill 2015 -- 2019

\\section*{Skills}
Go, Rust, TypeScript, Python, Postgres, CockroachDB, Kafka, Kubernetes, Terraform, AWS.

\\end{document}`;

const VARIANT_STRIPE_TEX = MASTER_TEX
  .replace("Software Engineer \\textbullet\\ Brooklyn", "Payments Infrastructure Engineer \\textbullet\\ Brooklyn")
  .replace(
    "Led migration of the payments ledger from Postgres to a sharded CockroachDB cluster, cutting p99 write latency from 140ms to 38ms.",
    "Led migration of the payments ledger to a sharded, idempotent, exactly-once pipeline — cut p99 write latency from 140ms to 38ms and eliminated double-charge incidents."
  )
  .replace(
    "Designed the feature-flag service used by 140+ engineers; authored the Go SDK and handled on-call rotation ownership.",
    "Owned SOC2 evidence collection for the payments perimeter; drove the risk-control framework review with internal audit."
  );

const JD_STRIPE = `Payments Infrastructure Engineer — Stripe (San Francisco / Remote)

We're hiring a senior engineer for the Money Movement team. You will:
- Own reliability for the ledger that moves $1T/yr
- Design idempotent, exactly-once pipelines at 50k writes/sec
- Partner with risk and compliance on SOC2 evidence and controls
- Mentor mid-level engineers through promotion

You have:
- 5+ years on backend distributed systems (Go or Rust preferred)
- Deep experience with Postgres, CockroachDB, Kafka, or similar
- A track record of reducing p99 latency under contention
- Experience with regulated environments (PCI-DSS, SOC2) is a plus`;

const JD_LINEAR = `Staff Product Engineer — Linear (SF)

Linear is looking for a staff engineer who cares as much about design as they do about code.

Responsibilities:
- Ship end-to-end features across React, TypeScript, and our Rust sync engine
- Own the perf bar for large-workspace (50k+ issue) customers
- Collaborate directly with design on low-level interaction work (keyboarding, drag, undo)
- Set the technical direction for one of our product pillars

You bring:
- Taste. We hire for it.
- 8+ years across frontend and at least one backend or systems domain
- Opinions on latency budgets and why 200ms is too slow
- Experience with realtime collaboration or CRDTs a plus`;

const JD_ANTHROPIC = `Senior Software Engineer, Research Infrastructure — Anthropic (SF / Remote)

We're building the infrastructure that trains Claude. We need senior engineers with deep distributed systems experience to help us scale.

You will:
- Improve the performance and reliability of our training stack (Python + Rust)
- Work with researchers to turn experiments into production-grade pipelines
- Own observability for multi-thousand-GPU jobs
- Contribute across the stack — orchestration, storage, networking

You bring:
- 6+ years writing production code, at least 3 in distributed systems
- Python fluency; comfort with Rust or willingness to learn
- A calm bias to action in ambiguous environments`;

window.FIXTURES = {
  user: { email: "maya@okafor.dev", name: "Maya Okafor" },
  master: {
    id: "r_master",
    name: "Master — Maya Okafor",
    template: "jakes",
    pageCount: 1,
    lastEditedAt: "2026-04-23T14:12:00Z",
    createdAt: "2025-11-02T10:00:00Z",
    tex: MASTER_TEX,
    isMaster: true,
  },
  variants: [
    {
      id: "r_stripe",
      parent: "r_master",
      name: "Stripe — Payments Infra",
      template: "jakes",
      pageCount: 1,
      lastEditedAt: "2026-04-22T18:40:00Z",
      createdAt: "2026-04-22T17:55:00Z",
      tex: VARIANT_STRIPE_TEX,
      jdId: "jd_stripe",
    },
    {
      id: "r_linear",
      parent: "r_master",
      name: "Linear — Staff Product Eng",
      template: "jakes",
      pageCount: 2, // overflow!
      lastEditedAt: "2026-04-24T09:20:00Z",
      createdAt: "2026-04-24T08:45:00Z",
      tex: MASTER_TEX.replace("Maya Okafor", "Maya Okafor\\\\ (extra line to force overflow)"),
      jdId: "jd_linear",
    },
  ],
  jds: [
    { id: "jd_stripe", company: "Stripe", title: "Payments Infrastructure Engineer", url: "https://stripe.com/jobs/listing/123", addedAt: "2026-04-22T17:50:00Z", variants: 1, text: JD_STRIPE },
    { id: "jd_linear", company: "Linear", title: "Staff Product Engineer", url: "https://linear.app/careers", addedAt: "2026-04-24T08:40:00Z", variants: 1, text: JD_LINEAR },
    { id: "jd_anthropic", company: "Anthropic", title: "Senior SWE, Research Infra", url: "https://anthropic.com/careers", addedAt: "2026-04-18T11:10:00Z", variants: 0, text: JD_ANTHROPIC },
  ],
  history: [
    { id: "v8", at: "2026-04-24T09:20:00Z", source: "ai", model: "sonnet", prompt: "Tighten the Lintern bullet — too many adjectives.", pageCount: 2, resume: "r_linear" },
    { id: "v7", at: "2026-04-24T08:58:00Z", source: "ai", model: "opus", prompt: "Tailor this resume to the Linear Staff Product Engineer JD I pasted.", pageCount: 1, resume: "r_linear" },
    { id: "v6", at: "2026-04-23T14:12:00Z", source: "manual", prompt: null, pageCount: 1, resume: "r_master" },
    { id: "v5", at: "2026-04-22T18:40:00Z", source: "ai", model: "sonnet", prompt: "Rewrite the Stratacore bullets to emphasize ledger / compliance work for Stripe.", pageCount: 1, resume: "r_stripe" },
    { id: "v4", at: "2026-04-22T18:12:00Z", source: "ai", model: "haiku", prompt: "Extract protected keywords from the Stripe JD.", pageCount: 1, resume: "r_stripe" },
    { id: "v3", at: "2026-04-22T17:55:00Z", source: "ai", model: "sonnet", prompt: "Tailor to JD: Stripe — Payments Infrastructure Engineer.", pageCount: 1, resume: "r_stripe" },
  ],
  protectedTerms: ["idempotent", "exactly-once", "p99 latency", "SOC2", "CockroachDB", "distributed systems", "Rust", "Go"],
  // A specific diff used on the diff-viewer screen
  diff: {
    model: "sonnet",
    iterations: 2,
    tokensCached: 12840,
    tokensFresh: 1920,
    wallMs: 4200,
    finalPageCount: 1,
    removedProtected: [],
    preservedProtected: ["idempotent", "exactly-once", "p99 latency", "SOC2"],
    // Unified diff by line: {type: 'ctx'|'del'|'add', text}
    lines: [
      { type: "ctx", text: "\\section*{Experience}" },
      { type: "ctx", text: "\\textbf{Senior Software Engineer} \\hfill \\textit{Stratacore} \\\\" },
      { type: "ctx", text: "\\textit{Aug 2022 -- Present} \\hfill New York, NY" },
      { type: "ctx", text: "\\begin{itemize}[leftmargin=*,nosep]" },
      { type: "del", text: "  \\item Led migration of the payments ledger from Postgres to a sharded CockroachDB cluster, cutting p99 write latency from 140ms to 38ms." },
      { type: "add", text: "  \\item Led migration of the payments ledger to a sharded, \\textbf{idempotent, exactly-once} pipeline --- cut \\textbf{p99} write latency from 140ms to 38ms and eliminated double-charge incidents.", hotspot: 1 },
      { type: "del", text: "  \\item Designed the feature-flag service used by 140+ engineers; authored the Go SDK and handled on-call rotation ownership." },
      { type: "add", text: "  \\item Owned \\textbf{SOC2} evidence collection for the payments perimeter; drove the risk-control framework review with internal audit.", hotspot: 2 },
      { type: "ctx", text: "  \\item Mentored four engineers through promotion; rewrote the onboarding runbook." },
      { type: "ctx", text: "\\end{itemize}" },
    ],
  },
};
