"""LaTeX preamble shim that surfaces soft-wrapped resume content as
parseable warnings in Tectonic's log.

`compile_latex` injects WRAP_SHIM into every document before
\\documentclass executes (alongside the existing pdfTeX compatibility
shim). The shim:

  * Defines \\hsMeasureLine{<text>} which measures the rendered width of
    <text> and, if it exceeds \\linewidth minus a 2pt slack, emits a
    single line of the form

        HS_WRAP: line=<n> over=<pt>pt limit=<pt>pt text=<<<...>>>

    via \\typeout. \\detokenize is used so the captured text is a flat
    string a downstream parser/model can read.

  * After \\AtBeginDocument runs the document's preamble, redefines
    \\resumeItem (if defined) so each bullet is measured before it
    renders. Failure modes (undefined macro, measurement errors) are
    swallowed so the shim never breaks compilation.

  * Defines \\skillRow{label}{items} for use in Skills blocks so each
    row is measured the same way bullets are.

The shim is a single string constant; tests against compile output
exercise its behavior end-to-end.
"""

WRAP_SHIM = r"""
\makeatletter
\newdimen\hs@dim
\newdimen\hs@limit
% Tolerance: declare overflow only when content exceeds \linewidth by >2pt.
\def\hs@slack{2pt}

% Measure <text> against current \linewidth. On overflow, emit one
% HS_WRAP: line to the log via \typeout. \detokenize turns the
% argument into a flat token string suitable for log scraping.
\long\def\hsMeasureLine#1{%
  \begingroup
    \settowidth{\hs@dim}{#1}%
    \hs@limit=\linewidth
    \advance\hs@limit by -\hs@slack
    \ifdim\hs@dim>\hs@limit
      \edef\hs@over{\strip@pt\dimexpr\hs@dim-\linewidth\relax}%
      \edef\hs@lim{\strip@pt\linewidth}%
      \typeout{HS_WRAP: line=\the\inputlineno\space over=\hs@over pt limit=\hs@lim pt text=<<<\detokenize{#1}>>>}%
    \fi
  \endgroup
}

% Wrap \resumeItem after the user's preamble has defined it. We define
% the redefinition logic in its own macro so that \AtBeginDocument's
% argument-expansion doesn't mangle the #1 parameter tokens of the
% inner \renewcommand body.
\newcommand{\hs@wrapResumeItem}{%
  \@ifundefined{resumeItem}{}{%
    \let\hs@oldResumeItem\resumeItem
    \renewcommand{\resumeItem}[1]{\hsMeasureLine{##1}\hs@oldResumeItem{##1}}%
  }%
}
\AtBeginDocument{\hs@wrapResumeItem}

% \skillRow{label}{items}: typeset the row and measure it. Templates
% adopt this in place of raw \textbf{Label}{: items} \\ rows so wrap
% detection works in Skills blocks too.
\newcommand{\skillRow}[2]{%
  \textbf{#1}{: #2}%
  \hsMeasureLine{\textbf{#1}: #2}%
  \\%
}
\makeatother
""".lstrip("\n")
