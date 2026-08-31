/**
 * Minimal hash router.
 *
 * Deliberately not react-router (CLAUDE.md §3). Hash routing means the built app
 * works from file://, from any static host, and from a subdirectory with no server
 * rewrite rules — which matters for something the user is meant to be able to host
 * anywhere or just open locally.
 */

import { useEffect, useState } from "react";

export interface Route {
  /** Path segments, e.g. ["topic", "quant-tvm-01"]. Empty array is the home route. */
  segments: string[];
  /** Raw hash without the leading '#', for logging and equality checks. */
  raw: string;
}

function readHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return { raw, segments: raw.split("/").filter(Boolean).map(decodeURIComponent) };
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = `#/${path.replace(/^\/+/, "")}`;
  if (options.replace) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readHash);

  useEffect(() => {
    const onChange = (): void => setRoute(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Scrolling to the top on navigation is expected of a page change; without it,
  // moving from a long lesson to a result screen lands you halfway down.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route.raw]);

  return route;
}
