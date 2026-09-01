/**
 * Publish the built app to the `gh-pages` branch, which GitHub Pages serves.
 *
 * Run it with `npm run deploy` (that builds first). Content changes on `main` do not
 * reach the live site on their own — this is the step that moves them.
 *
 * Uses a git worktree rather than switching branches in place. Switching to an orphan
 * branch leaves every file from `main` sitting untracked in the working tree, and
 * getting back out means a forced checkout — recoverable, but not something a routine
 * deploy should require. A worktree keeps `main` untouched in the directory you are
 * standing in.
 *
 * Source maps are omitted: they are not needed at runtime, and the source is in the
 * same repository anyway.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const WORKTREE = join(ROOT, ".gh-pages-worktree");
const BRANCH = "gh-pages";

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: options.quiet === true ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  }).trim();
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!existsSync(join(DIST, "index.html"))) {
  fail("No build in dist/. Run `npm run build` first, or use `npm run deploy`.");
}

// Deploying while the source is dirty publishes something that matches no commit,
// which makes "what is live?" unanswerable later. Warn rather than block: a quick
// content fix you have not committed yet is a legitimate thing to preview.
const dirty = git(["status", "--porcelain"], { quiet: true });
const sha = git(["rev-parse", "--short", "HEAD"], { quiet: true });
const branchNow = git(["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
if (dirty !== "") {
  console.warn(
    `  Note: ${branchNow} has uncommitted changes. The site will not match commit ${sha}.`,
  );
}

// A worktree left behind by an interrupted run would fail the add below.
if (existsSync(WORKTREE)) {
  try {
    git(["worktree", "remove", "--force", WORKTREE], { quiet: true });
  } catch {
    rmSync(WORKTREE, { recursive: true, force: true });
  }
}

const remoteHasBranch =
  git(["ls-remote", "--heads", "origin", BRANCH], { quiet: true }).length > 0;

console.log(`  Preparing ${BRANCH} worktree...`);
if (remoteHasBranch) {
  git(["fetch", "origin", BRANCH], { quiet: true });
  git(["worktree", "add", WORKTREE, BRANCH], { quiet: true });
  git(["reset", "--hard", `origin/${BRANCH}`], { cwd: WORKTREE, quiet: true });
} else {
  git(["worktree", "add", "--orphan", "-b", BRANCH, WORKTREE], { quiet: true });
}

// Clear the old site, keeping .git so the worktree stays a worktree.
for (const entry of readdirSync(WORKTREE)) {
  if (entry === ".git") continue;
  rmSync(join(WORKTREE, entry), { recursive: true, force: true });
}

cpSync(DIST, WORKTREE, {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});

// Without this, Pages runs the files through Jekyll, which ignores anything starting
// with an underscore.
writeFileSync(join(WORKTREE, ".nojekyll"), "");
mkdirSync(join(WORKTREE, "assets"), { recursive: true });

git(["add", "--all"], { cwd: WORKTREE, quiet: true });

const staged = git(["status", "--porcelain"], { cwd: WORKTREE, quiet: true });
if (staged === "") {
  console.log("  The built site is identical to what is already published. Nothing to do.");
} else {
  git(
    [
      "commit",
      "-q",
      "-m",
      `Deploy: built app from ${branchNow} @ ${sha}${dirty === "" ? "" : " (with uncommitted changes)"}`,
    ],
    { cwd: WORKTREE, quiet: true },
  );
  console.log("  Pushing...");
  git(["push", "-q", "origin", BRANCH], { cwd: WORKTREE, quiet: true });
  console.log("  Published.");
}

git(["worktree", "remove", "--force", WORKTREE], { quiet: true });

console.log("\n  https://ialomar-gcmlp.github.io/ialomar-Alts-Academy/");
console.log("  Pages usually takes under a minute to serve the new version.\n");
