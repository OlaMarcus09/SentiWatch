# Crisis Agent Developer Note

`services.crisis_agent.process_crisis_brief(crisis_brief_id)` processes one
persisted `crisis_briefs` row. It is intentionally separate from sentiment,
scoring, Groq, scraping, alerts, and email delivery.

## Configuration

- `GOOGLE_API_KEY` is required for the Gemini API.
- `CRISIS_AGENT_MODEL` is optional and defaults to `gemini-3.5-flash`.
- `CRISIS_AGENT_TIMEOUT_SECONDS` is optional and defaults to `45`.
- `CRISIS_AGENT_EVIDENCE_LIMIT` is optional and defaults to `20`.

## Invocation and output

Call `process_crisis_brief(<uuid>)` from a synchronous worker/thread. The
service atomically claims `pending` or `failed` rows. `running` and `completed`
rows are ignored. Failed rows are retried in place, so no second brief is
created.

One Google ADK agent receives the triggering risk snapshot, entity identity,
and bounded high-priority negative evidence. It has no tools. ADK enforces the
`CrisisAgentOutput` Pydantic schema: incident title, summary, high/critical
severity, root-cause hypothesis, evidence summary, recommended actions, draft
public response, confidence from 0 to 1, and known evidence citations.

Timeouts, provider failures, and malformed output set the brief to `failed`
with a generic error code. Raw provider errors and credentials are never stored.

The hourly pipeline calls the internal processing endpoint only after risk
calculation succeeds. Manual analysis keeps its existing behavior and may leave
a crisis brief pending until the next hourly pipeline run.

For a hackathon demo, trigger processing explicitly after analysis and risk
calculation have completed:

```bash
curl --fail --show-error --max-time 75 \
  -X POST "${BACKEND_URL}/internal/process-crisis/${ENTITY_ID}" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"
```

This is a machine-to-machine endpoint. A Supabase user access token does not
authorize it; the request must use the backend's existing `INTERNAL_API_KEY`.

Run the tests with:

```bash
backend/env/bin/python -m unittest discover -s backend/tests -v
```
