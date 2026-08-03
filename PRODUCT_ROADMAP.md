# SentiWatch Product Roadmap

Last updated: 2026-08-03

## Product thesis

SentiWatch is Nigeria-first reputation risk intelligence for businesses,
public profiles, and organizations. It turns public conversation into
evidence-backed risk signals and practical response actions.

The product should win on trust, local context, and speed of action. It should
not try to become a smaller copy of Brandwatch or Meltwater.

## Ideal first customers

- Nigerian fintechs, banks, payment providers, and POS networks
- Consumer businesses with active public support conversations
- Real-estate companies exposed to refund, allocation, and delivery complaints
- Agencies and communications teams monitoring several client profiles

## Current baseline

SentiWatch already supports:

- Entity and competitor tracking
- News, web, Reddit, YouTube, X, and Facebook collection where configured
- Relevance filtering and structured sentiment/risk classification
- Severity-aware 0–100 risk scoring with historical snapshots
- Competitor risk comparison
- Recommendations, in-app notifications, email alerts, and daily digests
- Durable pipeline stages, leases, recovery, and scheduled GitHub processing
- Nigerian-specific backstops for fraud, refunds, financial harm, and regulatory language

## North-star outcomes

Track these metrics before adding surface-area features:

- Analyzed coverage: analyzed mentions / collected mentions
- False-safe rate: runs shown as healthy while evidence is incomplete or failed
- Time to detect: first collection to visible risk signal
- Time to explain: time from score change to linked evidence and cause
- Time to respond: alert creation to a recorded response action
- Source freshness: age of the newest successful evidence per source
- Recovery time: time from a negative incident to risk stabilization

## Roadmap

### Now — Data Trust Center and evidence-backed mentions

Goal: make every score explainable and make incomplete analysis impossible to
mistake for a healthy reputation.

Acceptance criteria:

- Show collected, analyzed, pending, rejected, and inconsistent mention counts.
- Show an explicit coverage state: `verified`, `partial`, `degraded`, or `no evidence`.
- Show latest pipeline status, stage, failure message, and last successful run.
- Show source/platform counts and freshness indicators.
- Show a confidence notice beside the risk score when evidence is incomplete.
- Let a user open a mention and see source, URL, published time, evidence text,
  confidence, severity, category, risk, and the reason for classification.
- Pending mentions must never enter the Neutral filter or be used to imply a
  healthy score.
- Add a per-entity “Run analysis now” action with visible progress.

Implementation fit: extend `/insights` and the existing dashboard provider;
add a user-authorized trust aggregation endpoint rather than relying on the
frontend's 200-row mention cap.

### Next — Competitive intelligence

Goal: make competitor tracking useful enough to drive retention and upgrades.

Acceptance criteria:

- Define a 7/30/90-day comparison window.
- Show share of mention volume and positive/negative share for each entity.
- Show risk and mention trends over time.
- Compare source distribution and top complaint/topic categories.
- Link every comparison metric back to its underlying mentions.
- Indicate when a competitor's score is based on partial evidence.

### Then — Incident and response workflow

Goal: turn recommendations into accountable work.

Acceptance criteria:

- Create an incident from a mention, alert, or score spike.
- Assign an owner, due date, status, internal notes, and resolution evidence.
- Provide channel-specific response templates.
- Measure whether risk and negative volume improve after resolution.

### Then — Reporting and configurable alerts

Goal: make SentiWatch useful in weekly operations and executive reporting.

Acceptance criteria:

- CSV export and board-ready PDF report.
- Configurable rules for score thresholds, negative spikes, fraud/regulatory
  categories, source credibility, and competitor deltas.
- Scheduled weekly/monthly reports with delivery history.
- Slack/Teams integration after the alert model is stable.

### Later — Nigeria-specific moat and advanced monitoring

- Nigerian English and Pidgin classification
- EFCC, ICPC, CBN, FCCPC, and NIBSS watchlists
- Naira amount extraction and financial-harm summaries
- Nigerian publisher credibility weighting
- WhatsApp-ready alert summaries
- Custom Boolean topics and exclusions
- Visual/logo monitoring

## Release slices and dependencies

1. Trust aggregation API → Trust Center UI → mention evidence drawer.
2. Historical trend query → competitor benchmark metrics → comparison UI.
3. Incident schema → response workflow → alert-rule triggers.
4. Export/report service → scheduled reports → external integrations.
5. Local-language/regulatory classifiers → watchlists → specialized playbooks.

## Risks and non-goals

- Do not pursue enterprise feature parity before trust and evidence quality are strong.
- Do not treat missing provider data as neutral sentiment.
- Do not add source connectors without deduplication, freshness, and failure visibility.
- Do not create a workflow UI before incidents have durable ownership and status.
- Do not expose service-role credentials or bypass tenant ownership checks.

## Decision log

- 2026-08-03: Prioritize Data Trust Center over additional connectors.
- 2026-08-03: Use Nigeria-first risk interpretation as the product differentiator.
- 2026-08-03: Extend Insights and Competitors before adding new top-level navigation.
- 2026-08-03: Treat partial evidence as a first-class product state.

## Active backlog

- [ ] Add `GET /entities/{entity_id}/trust` with ownership checks and bounded aggregates.
- [ ] Add coverage/freshness state to the dashboard and Insights page.
- [ ] Fix pending mentions in the Insights sentiment filter.
- [ ] Add mention evidence drawer using existing mention and sentiment columns.
- [ ] Add manual per-entity analysis trigger and progress state.
- [ ] Add 7/30/90-day competitor share-of-voice queries.

