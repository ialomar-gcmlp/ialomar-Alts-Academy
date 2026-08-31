/**
 * Per-domain visual identity.
 *
 * Every domain owns a hue (defined and validated in src/styles/tokens.css) and a
 * two-letter monogram. The monogram exists so colour is never the only signal: a
 * reader who cannot separate two hues still has the letters and the section heading.
 *
 * The var names are written out longhand on purpose. A class or var name assembled
 * at runtime — `text-${domain}`, `var(--d-${domain})` — is invisible to Tailwind's
 * scanner and to anyone grepping for where a colour is used (CLAUDE.md §8).
 */

import type { CSSProperties } from "react";

import type { Domain } from "../content/schema";

export const DOMAIN_COLOR: Record<Domain, string> = {
  "quantitative-methods": "var(--d-quantitative-methods)",
  economics: "var(--d-economics)",
  "financial-statement-analysis": "var(--d-financial-statement-analysis)",
  "corporate-issuers": "var(--d-corporate-issuers)",
  "equity-valuation": "var(--d-equity-valuation)",
  "fixed-income": "var(--d-fixed-income)",
  derivatives: "var(--d-derivatives)",
  alternatives: "var(--d-alternatives)",
  "fund-structures": "var(--d-fund-structures)",
  "portfolio-risk": "var(--d-portfolio-risk)",
  ethics: "var(--d-ethics)",
};

/** Unique two-letter codes — the non-colour half of a domain's identity. */
export const DOMAIN_MONOGRAM: Record<Domain, string> = {
  "quantitative-methods": "QM",
  economics: "EC",
  "financial-statement-analysis": "FA",
  "corporate-issuers": "CI",
  "equity-valuation": "EV",
  "fixed-income": "FI",
  derivatives: "DV",
  alternatives: "AL",
  "fund-structures": "FS",
  "portfolio-risk": "PR",
  ethics: "ET",
};

/** Short label for chips and the skill tree, where the full name will not fit. */
export const DOMAIN_SHORT: Record<Domain, string> = {
  "quantitative-methods": "Quant",
  economics: "Economics",
  "financial-statement-analysis": "Financials",
  "corporate-issuers": "Issuers",
  "equity-valuation": "Equity",
  "fixed-income": "Fixed income",
  derivatives: "Derivatives",
  alternatives: "Alternatives",
  "fund-structures": "Fund terms",
  "portfolio-risk": "Portfolio",
  ethics: "Ethics",
};

/**
 * Hands a domain's hue to CSS as `--d`, which the `.d-*` classes in index.css read.
 * One inline custom property, then every colour on the card follows from it.
 */
export function domainStyle(domain: Domain, extra?: CSSProperties): CSSProperties {
  return { ...extra, ["--d" as string]: DOMAIN_COLOR[domain] } as CSSProperties;
}

/** The same trick for anything that is not a domain — XP gold, streak orange. */
export function tintStyle(cssVar: string, extra?: CSSProperties): CSSProperties {
  return { ...extra, ["--d" as string]: cssVar } as CSSProperties;
}
