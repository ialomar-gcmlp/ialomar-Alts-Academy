/**
 * Mock exams, one per domain.
 *
 * A locked exam shows **what to do about it**, not a padlock. That is the whole
 * design of this page: "Mastery is 43%, the exam opens at 70%" is a next step;
 * a greyed-out card with a padlock is a wall. The reason comes from
 * `examRequirement`, which picks the nearest one rather than listing all three.
 */

import { useState } from "react";

import { DOMAIN_LABELS, type Domain } from "../content/schema";
import { EXAM } from "../engine/constants";
import { examLength } from "../engine/exam";
import { navigate } from "../lib/hashRouter";
import { domainExams, domainProgress, topicProgress, type DomainExam } from "../state/selectors";
import { useApp } from "../state/store";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import { Badge, Button, Card, Meter, Monogram, PageTitle } from "../ui/primitives";

export function Exams() {
  const progress = useApp((s) => s.progress);
  const startExam = useApp((s) => s.startExam);
  const [starting, setStarting] = useState<string | null>(null);

  const now = Date.now();
  const rows = domainExams(domainProgress(topicProgress(progress, now)), progress);

  // Unlocked first — the point of the page is the exam you can actually sit — then
  // by how close the rest are to opening.
  const ordered = [...rows].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return b.mastery - a.mastery;
  });

  const open = ordered.filter((row) => row.unlocked).length;
  const sat = progress.exams.length;
  const passed = new Set(
    progress.exams.filter((attempt) => attempt.passed).map((attempt) => attempt.domain),
  ).size;

  const begin = async (domain: Domain): Promise<void> => {
    setStarting(domain);
    try {
      const count = await startExam(domain);
      if (count > 0) navigate("exam");
    } finally {
      setStarting(null);
    }
  };

  return (
    <div>
      <PageTitle title="Mock exams" accent>
        One per domain, up to {EXAM.QUESTIONS_MAX} questions at{" "}
        {EXAM.SECONDS_PER_QUESTION} seconds each. Timed on the wall clock, and marked
        only when you submit.
      </PageTitle>

      <div className="mb-7 flex flex-wrap gap-2">
        <Badge tone={open > 0 ? "accent" : "neutral"}>
          {open} of {rows.length} open
        </Badge>
        <Badge tone="neutral">
          {sat} attempt{sat === 1 ? "" : "s"}
        </Badge>
        {passed > 0 && (
          <Badge tone="correct">
            <Icon name="trophy" size={11} />
            {passed} domain{passed === 1 ? "" : "s"} passed
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ordered.map((row) => (
          <ExamCard
            key={row.domain}
            row={row}
            busy={starting === row.domain}
            onStart={() => void begin(row.domain)}
          />
        ))}
      </div>

      <p className="mt-8 max-w-measure text-[13px] leading-relaxed text-fg-subtle">
        An exam records every answer to the scheduler as it goes, so a paper you sit is
        also a review. It does not ask how sure you are — that would break the pace — so
        each answer counts as neutral: right schedules a short interval, wrong is a soft
        lapse rather than the reset a confident miss earns.
      </p>
    </div>
  );
}

function ExamCard({
  row,
  busy,
  onStart,
}: {
  row: DomainExam;
  busy: boolean;
  onStart: () => void;
}) {
  const length = examLength(row.questionsAvailable);
  const minutes = Math.round((length * EXAM.SECONDS_PER_QUESTION) / 60);
  const bestPct =
    row.best === null ? null : Math.round((row.best.correct / row.best.total) * 100);

  return (
    <Card
      className={`d-border overflow-hidden p-0 ${row.unlocked ? "" : "opacity-90"}`}
      style={domainStyle(row.domain)}
    >
      <span className="d-rail block h-1 w-full" aria-hidden />

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Monogram code={DOMAIN_MONOGRAM[row.domain]} size={28} />
            <div className="min-w-0">
              <p className="truncate text-[15.5px] font-bold text-fg">
                {DOMAIN_LABELS[row.domain]}
              </p>
              <p className="text-[12.5px] text-fg-subtle tnum">
                {length} questions · {minutes} min
              </p>
            </div>
          </div>

          {row.best !== null && (
            <Badge tone={row.best.passed ? "correct" : "incorrect"}>
              {row.best.passed ? "passed" : "best"} {bestPct}%
            </Badge>
          )}
        </div>

        {/* Mastery against the threshold, always shown: locked or not, this is the
            number the gate is about. */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-[12px] text-fg-muted tnum">
            <span>
              Mastery {Math.round(row.mastery * 100)}%
              <span className="text-fg-subtle">
                {" "}
                · opens at {Math.round(row.masteryNeeded * 100)}%
              </span>
            </span>
            <span className="text-fg-subtle">
              {row.topicsStarted}/{row.topicsTotal} topics started
            </span>
          </div>
          <Meter
            value={row.mastery / row.masteryNeeded}
            color={row.unlocked ? "var(--d, var(--p-accent))" : "var(--p-border-strong)"}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {row.unlocked ? (
            <Button variant="vivid" onClick={onStart} disabled={busy}>
              <Icon name="target" size={15} />
              {busy ? "Building the paper…" : row.attempts > 0 ? "Sit it again" : "Sit the exam"}
            </Button>
          ) : (
            <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-fg-muted">
              <Icon name="lock" size={14} className="mt-0.5 shrink-0 text-fg-subtle" />
              {row.blockedBy}
            </p>
          )}

          {row.attempts > 1 && (
            <span className="text-[12px] text-fg-subtle tnum">{row.attempts} attempts</span>
          )}
        </div>
      </div>
    </Card>
  );
}
