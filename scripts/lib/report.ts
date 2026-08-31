/**
 * Terminal reporting for content problems.
 *
 * Grouped by file with the field path shown, because the usual failure is a typo in
 * one field of one topic and the fastest fix is knowing exactly which line to open.
 */

import type { Problem } from "./content-fs";

const supportsColour = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const paint = (code: string, s: string): string =>
  supportsColour ? `\x1b[${code}m${s}\x1b[0m` : s;

export const red = (s: string): string => paint("31", s);
export const green = (s: string): string => paint("32", s);
export const yellow = (s: string): string => paint("33", s);
export const dim = (s: string): string => paint("2", s);
export const bold = (s: string): string => paint("1", s);

export function reportProblems(problems: Problem[]): void {
  if (problems.length === 0) return;

  const byFile = new Map<string, Problem[]>();
  for (const p of problems) {
    const list = byFile.get(p.file);
    if (list) list.push(p);
    else byFile.set(p.file, [p]);
  }

  for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`\n${bold(file)}`);
    for (const p of list) {
      const where = p.path ? dim(`  ${p.path}`) : "";
      console.log(`  ${red("x")}${where}  ${p.message}`);
    }
  }
}
