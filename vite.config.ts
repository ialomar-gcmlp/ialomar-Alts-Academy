import { resolve } from "node:path";

import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { writeManifest } from "./scripts/build-manifest";
import { reportProblems } from "./scripts/lib/report";

/**
 * Keeps content/manifest.json in step with the files on disk, so "add a topic by
 * dropping in a JSON file" (CLAUDE.md §1.4) actually holds — in dev the new topic
 * appears without restarting, and a build can never ship a stale manifest.
 *
 * Content problems are logged, not thrown: a malformed file should cost you that
 * one topic and a loud warning, not a dev server that refuses to boot.
 */
function contentManifest(): Plugin {
  let regenerate: (reason: string) => void = () => {};

  return {
    name: "alts-academy:content-manifest",

    buildStart() {
      const { manifest, loaded } = writeManifest();
      if (loaded.problems.length > 0) {
        reportProblems(loaded.problems);
        this.warn(
          `${loaded.problems.length} content problem(s) — run \`npm run content:check\`. Affected topics are excluded from the manifest.`,
        );
      }
      this.info?.(`content: ${manifest.topics.length} topic(s), ${manifest.glossaryCount} term(s)`);
    },

    configureServer(server) {
      const contentDir = /[\\/]content[\\/]/;
      const isManifest = /[\\/]content[\\/]manifest\.json$/;

      // Absolute path. A relative "content" is silently ignored by the watcher —
      // which broke the headline promise that dropping in a JSON file is enough,
      // and did so invisibly: no error, the new topic simply never appeared.
      const watchRoot = resolve(server.config.root, "content");

      regenerate = (reason: string) => {
        const { manifest, loaded } = writeManifest();
        if (loaded.problems.length > 0) {
          reportProblems(loaded.problems);
          server.config.logger.warn(
            `content: ${loaded.problems.length} problem(s) after ${reason}`,
          );
        } else {
          server.config.logger.info(
            `content: ${manifest.topics.length} topic(s), ${manifest.glossaryCount} term(s) — ${reason}`,
          );
        }
        server.ws.send({ type: "full-reload" });
      };

      server.watcher.add(watchRoot);
      // "addDir" matters too: a whole new domain folder can arrive at once.
      for (const event of ["add", "change", "unlink", "addDir", "unlinkDir"] as const) {
        server.watcher.on(event, (file: string) => {
          // Ignore our own write, or the watcher loops forever.
          if (!contentDir.test(file) || isManifest.test(file)) return;
          regenerate(`${event} ${file.split(/[\/]/).pop() ?? ""}`);
        });
      }

      server.config.logger.info(`content: watching ${watchRoot}`);
    },
  };
}

export default defineConfig({
  plugins: [contentManifest(), react(), tailwindcss()],

  /**
   * Relative asset paths, not absolute.
   *
   * The default `/assets/...` only works when the app is served from a domain root.
   * With `./` the same `dist/` opens from `file://`, from a subdirectory of a static
   * host, and from a server root — which is the whole reason this app uses hash
   * routing. M7 caught the claim being false: the paths were absolute.
   */
  base: "./",

  build: {
    // Static output, hostable anywhere, openable from file:// (hash routing).
    target: "es2022",
    sourcemap: true,
  },

  test: {
    // Engine, storage and content tests are all pure logic — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    reporters: ["default"],
  },
});
