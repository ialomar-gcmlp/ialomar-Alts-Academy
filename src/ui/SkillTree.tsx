/**
 * Skill tree — a layered dependency map of every topic.
 *
 * Positions are COMPUTED, not measured: each node has a fixed size, so a node's x/y
 * follows from its tier and index. That means the SVG edges can be drawn from plain
 * arithmetic with no refs, no measurement pass and no layout-thrash loop — the same
 * trap that broke the glossary popover in M1.
 *
 * Tiers come from prerequisite depth, not from domain, so a cross-domain prerequisite
 * (the yield curve needing present value) shows up as a real edge rather than being
 * hidden by a per-domain grouping.
 */

import { useMemo } from "react";

import { type Domain } from "../content/schema";
import type { TopicProgress } from "../state/selectors";
import { DOMAIN_MONOGRAM, DOMAIN_SHORT, domainStyle } from "./domain";
import { Icon } from "./icons";
import { Meter, Monogram } from "./primitives";

const NODE_W = 208;
const NODE_H = 92;
const GAP_X = 28;
const GAP_Y = 60;

type NodeState = "mastered" | "strong" | "in-progress" | "available" | "locked";

function nodeState(t: TopicProgress): NodeState {
  if (t.mastery >= 0.85) return "mastered";
  if (t.mastery >= 0.6) return "strong";
  if (t.started) return "in-progress";
  return t.unlocked ? "available" : "locked";
}

const NODE_STYLES: Record<NodeState, string> = {
  // Mastered nodes are filled with their domain's own colour, so a finished branch
  // of the tree is visible from across the page.
  mastered: "d-border d-tint-strong",
  strong: "d-border d-tint",
  "in-progress": "d-border bg-surface",
  available: "border-border-base bg-surface",
  locked: "border-border-base border-dashed bg-surface-2",
};

const STATE_LABELS: Record<NodeState, string> = {
  mastered: "Mastered",
  strong: "Solid",
  "in-progress": "In progress",
  available: "Ready",
  locked: "Prerequisites first",
};

/** Longest path back to a topic with no prerequisites. */
function depths(topics: TopicProgress[]): Map<string, number> {
  const byId = new Map(topics.map((t) => [t.topic.id, t]));
  const cache = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (id: string): number => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    // Cycles are rejected by content:check, but never trust that in layout code —
    // an infinite recursion here would hang the page rather than log an error.
    if (visiting.has(id)) return 0;

    visiting.add(id);
    const prereqs = byId.get(id)?.topic.prereqs ?? [];
    const value =
      prereqs.length === 0
        ? 0
        : 1 + Math.max(...prereqs.map((p) => (byId.has(p) ? depthOf(p) : -1)));
    visiting.delete(id);

    cache.set(id, Math.max(0, value));
    return Math.max(0, value);
  };

  for (const t of topics) depthOf(t.topic.id);
  return cache;
}

interface PositionedNode {
  topic: TopicProgress;
  x: number;
  y: number;
  state: NodeState;
}

function layout(topics: TopicProgress[]): {
  nodes: PositionedNode[];
  width: number;
  height: number;
  tiers: number;
} {
  if (topics.length === 0) return { nodes: [], width: 0, height: 0, tiers: 0 };

  const depthMap = depths(topics);

  const byTier = new Map<number, TopicProgress[]>();
  for (const t of topics) {
    const d = depthMap.get(t.topic.id) ?? 0;
    const list = byTier.get(d);
    if (list) list.push(t);
    else byTier.set(d, [t]);
  }

  // Stable ordering within a tier, so the map does not reshuffle between renders.
  for (const list of byTier.values()) {
    list.sort(
      (a, b) =>
        a.topic.domain.localeCompare(b.topic.domain) || a.topic.title.localeCompare(b.topic.title),
    );
  }

  const widest = Math.max(...[...byTier.values()].map((l) => l.length));
  const width = widest * NODE_W + (widest - 1) * GAP_X;

  const nodes: PositionedNode[] = [];
  for (const [tier, list] of byTier) {
    const rowWidth = list.length * NODE_W + (list.length - 1) * GAP_X;
    const offset = (width - rowWidth) / 2; // centre each row
    list.forEach((topic, i) => {
      nodes.push({
        topic,
        x: offset + i * (NODE_W + GAP_X),
        y: tier * (NODE_H + GAP_Y),
        state: nodeState(topic),
      });
    });
  }

  const tiers = byTier.size;
  return { nodes, width, height: tiers * NODE_H + (tiers - 1) * GAP_Y, tiers };
}

export function SkillTree({
  topics,
  onSelect,
}: {
  topics: TopicProgress[];
  onSelect: (id: string) => void;
}) {
  const { nodes, width, height } = useMemo(() => layout(topics), [topics]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.topic.topic.id, n])), [nodes]);

  if (nodes.length === 0) return null;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="relative" style={{ width, height, minWidth: "100%" }}>
        {/* Edges, behind the nodes */}
        <svg
          className="pointer-events-none absolute inset-0 text-border-strong"
          width={width}
          height={height}
          aria-hidden
        >
          {nodes.flatMap((node) =>
            node.topic.topic.prereqs.map((prereqId) => {
              const from = byId.get(prereqId);
              if (!from) return null;

              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const x2 = node.x + NODE_W / 2;
              const y2 = node.y;
              const mid = (y1 + y2) / 2;

              // Solid once the prerequisite is satisfied, dashed while it still gates.
              const satisfied = !node.topic.blockedBy.includes(prereqId);

              return (
                <path
                  key={`${prereqId}->${node.topic.topic.id}`}
                  d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray={satisfied ? undefined : "4 4"}
                  opacity={satisfied ? 0.9 : 0.5}
                />
              );
            }),
          )}
        </svg>

        {nodes.map((node) => {
          const { topic, mastery, dueCount } = node.topic;
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => onSelect(topic.id)}
              title={`${topic.title} — ${STATE_LABELS[node.state]}`}
              className={`press absolute flex flex-col justify-between rounded-lg border-2 p-2.5 text-left ${NODE_STYLES[node.state]}`}
              style={domainStyle(topic.domain, {
                left: node.x,
                top: node.y,
                width: NODE_W,
                height: NODE_H,
              })}
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-1.5">
                  <Monogram code={DOMAIN_MONOGRAM[topic.domain]} size={18} />
                  <span className="d-text truncate text-[10px] font-bold uppercase tracking-wider">
                    {DOMAIN_SHORT[topic.domain]}
                  </span>
                  {node.state === "mastered" && (
                    <Icon name="trophy" size={11} className="d-text ml-auto" />
                  )}
                  {dueCount > 0 && (
                    <span className="ml-auto shrink-0 text-[10px] font-bold text-flag tnum">
                      {dueCount} due
                    </span>
                  )}
                </div>
                <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-fg">
                  {topic.title}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex-1">
                  <Meter value={mastery} color="var(--d)" height={4} />
                </span>
                <span className="shrink-0 text-[10px] font-semibold text-fg-muted tnum">
                  {Math.round(mastery * 100)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One domain stands in for all eleven in the legend: the legend is about node STATE,
 * and picking a colour there would imply the state and the colour were related.
 */
const LEGEND_DOMAIN: Domain = "alternatives";

/** Legend, so the node states are not a guessing game. */
export function SkillTreeLegend() {
  const states: NodeState[] = ["mastered", "strong", "in-progress", "available", "locked"];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-fg-muted">
      {states.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span
            aria-hidden
            style={domainStyle(LEGEND_DOMAIN)}
            className={`inline-block h-3 w-3 rounded border-2 ${NODE_STYLES[state]}`}
          />
          {STATE_LABELS[state]}
        </li>
      ))}
    </ul>
  );
}
