export const OWNER_NAME = "Muhammad_Moiz";

/**
 * Build a download filename from a resume name. Variant resumes are stored
 * as ``{master_name} \u2014 {company}`` (em-dash + company) by the tailor
 * flow, so we use the company portion when present and the full name
 * otherwise. Always sanitized to filesystem-safe characters.
 */
export function downloadFilename(resumeName: string, owner: string = OWNER_NAME): string {
  const trimmed = (resumeName || "").trim();
  const splitMatch = trimmed.split(/\s+[\u2014-]\s+/);
  const tail = splitMatch.length > 1 ? splitMatch[splitMatch.length - 1] : trimmed;
  const slug = (tail || "Resume")
    .replace(/[^A-Za-z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "_") || "Resume";
  return `${owner}_${slug}.pdf`;
}
