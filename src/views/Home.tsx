/**
 * Home — the topic list.
 *
 * M1 lists every topic in the manifest, grouped by domain. M3 replaces this with the
 * skill tree (locked / in progress / mastered) and M6 with the "Start studying"
 * entry point that composes a session to a time budget.
 */

import { manifest } from "../content/loader";
import { DOMAIN_LABELS, type Domain, type ManifestTopic } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { Badge, Card, PageTitle } from "../ui/primitives";

function TopicCard({ topic }: { topic: ManifestTopic }) {
  const minutes = topic.estMinutes + Math.round(topic.questionSeconds / 60);

  return (
    <Card className="flex flex-col p-5 text-left transition-colors hover:border-border-strong">
      <button
        type="button"
        onClick={() => navigate(`topic/${topic.id}`)}
        className="flex flex-1 flex-col text-left"
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {topic.examRelevance.map((exam) => (
            <Badge key={exam} tone={exam === "practical" ? "accent" : "neutral"}>
              {exam === "practical" ? "on the job" : exam}
            </Badge>
          ))}
          {topic.needsReview && <Badge tone="flag">check</Badge>}
        </div>

        <h3 className="text-[17px] font-semibold leading-snug text-fg">{topic.title}</h3>
        <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-fg-muted">{topic.summary}</p>

        <div className="mt-4 flex items-center gap-3 text-[13px] text-fg-subtle tnum">
          <span>~{minutes} min</span>
          <span aria-hidden>·</span>
          <span>
            {topic.questionCount} question{topic.questionCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span className="capitalize">{topic.level}</span>
        </div>
      </button>
    </Card>
  );
}

export function Home() {
  const byDomain = new Map<Domain, ManifestTopic[]>();
  for (const topic of manifest.topics) {
    const list = byDomain.get(topic.domain);
    if (list) list.push(topic);
    else byDomain.set(topic.domain, [topic]);
  }

  const totalQuestions = manifest.topics.reduce((n, t) => n + t.questionCount, 0);

  return (
    <div>
      <PageTitle title="What would you like to learn?">
        Pick a topic to read the lesson, then work through its questions. Every specialist
        term is underlined — tap or hover it for a plain-English definition.
      </PageTitle>

      <p className="mb-8 text-[13px] text-fg-subtle tnum">
        {manifest.topics.length} topics · {totalQuestions} questions · {manifest.glossaryCount}{" "}
        glossary terms
      </p>

      <div className="space-y-10">
        {[...byDomain.entries()].map(([domain, topics]) => (
          <section key={domain}>
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">
              {DOMAIN_LABELS[domain]}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((topic) => (
                <TopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
