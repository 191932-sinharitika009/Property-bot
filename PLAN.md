# Property chatbot implementation plan

Prepared: 19 November 2026

Deliver a publicly testable chatbot that answers from collected DarGlobal and
Wasalt data, uses a free OpenRouter model, and runs as a deployed Docker
application. Every factual answer should link to its supporting records.

This file defines future work and acceptance criteria. Record implementation
changes in `PROJECT_LOG.md`; keep setup commands in `README.md`.

## Starting point

| Component | Current state |
| --- | --- |
| Wasalt collection | Working HTTP scraper; 22 distinct listing URLs retained |
| Wasalt validation | 16 records passed automated checks; six flagged; one suspected duplicate pair |
| DarGlobal collection | One successful visible-Chrome collection of Les Vagues |
| DarGlobal structured data | One assisted project record; automated normalization still needed |
| Tests | Nine passing tests at the last implementation check |
| Chatbot and deployment | Not implemented |

Crawling feasibility has been demonstrated on both sites. DarGlobal repeatability
and unattended operation still need testing. A project describes several unit
options; a Wasalt listing describes a particular offer. Keep that distinction.

## Proposed architecture

```text
Public source pages
  -> separate Wasalt and DarGlobal collectors
  -> raw snapshots and collection reports
  -> normalization, validation, and duplicate review
  -> approved versioned dataset
  -> structured filters and text retrieval
  -> selected records + question sent to OpenRouter
  -> answer + source links displayed in chat
```

Use the existing Node.js project. Serve a small web interface and API from one
application container. The initial retrieval implementation loads reviewed JSONL
into an in-memory token index with numeric filters and deterministic text ranking.
With 35 records this avoids an extra database dependency. Reconsider a generated
SQLite/full-text index as coverage grows. Add semantic retrieval only if evaluation
shows that keyword search misses important questions. No model training is needed.

Collection runs separately from the chat server. Package a validated dataset
snapshot into the deployment so a user request does not depend on either source
website being reachable. Preserve source URLs and original collection times.

## Milestone 1 Repeatable collection

### DarGlobal

- Turn the working browser diagnostic into a collector accepting a URL list.
- Discover project detail links from the public project directory; deduplicate
  URLs and exclude forms, account pages, and unrelated navigation.
- Validate three to five different projects using the working visible-browser
  method. Capture HTML and failure reports even when navigation times out.
- Stop on access challenges and record the failure without bypassing them.
- Extract project name, location, property types, bedroom options, area ranges,
  amenities, status, completion claims, and published prices where available.
- Preserve conflicting statements as evidence. Do not choose an area range for
  Les Vagues while the page gives two different ranges.
- Test repeatability in the intended collection environment. Browser collection
  may remain a local preparation step if unattended hosting is unreliable.

### Wasalt

- Add resumable URL queues, incremental collection, and bounded batches so a new
  run expands the dataset instead of repeatedly collecting the same URLs.
- Sample across cities, property types, and sale/rent categories. Measure actual
  coverage; evenly spaced sitemap URLs alone do not guarantee representation.
- Retry only transient failures with bounded delays. Stop rather than repeatedly
  retry access blocks or rate-limit responses.

**Completion check:** repeated collection succeeds on several detail pages from
each source, and every attempted URL has a recorded outcome.

## Milestone 2 Normalize and validate

Use separate record types with shared provenance fields:

| Shared fields | Listing fields | Project fields |
| --- | --- | --- |
| ID, source, URL, collection time, method, validation status | Sale/rent, amount, currency, rental period, bedrooms, area and area type | Bedroom options, area ranges, development status, amenities, completion claims |

- Implement a repeatable DarGlobal parser using locally collected HTML.
- Review the six flagged Wasalt records. Keep unresolved fields marked as such;
  exclude ambiguous numeric fields from filtering or comparison.
- Resolve the suspected duplicate pair where possible. Similar details alone do
  not prove two listings represent the same unit; retain source identities.
- Keep currencies separate and distinguish monthly/yearly rent from sale prices.
- Exclude agents, phone numbers, and unrelated page content from chatbot input.
- Report missing fields, conflicts, duplicate candidates, and coverage.
- Generate JSONL for processing and CSV for review, with a dataset version and
  manifest containing source counts, collection dates, and parser version.

**Completion check:** each included fact is traceable to a page; unknown values
remain empty; flagged data cannot silently influence numeric recommendations.

## Milestone 3 Expand useful coverage

Provisional assignment-sized targets are 100–200 Wasalt listings and 10–20
DarGlobal projects, or all accessible relevant projects if fewer are available.
These are planning targets, not claims that the pages are available or a minimum
needed for the software to work. Expand only after parser checks pass.

- Collect in manageable batches and check quality after each batch.
- Prioritize varied locations, price ranges, bedroom counts, and property types.
- Keep the newest record per source URL while retaining collection provenance.
- Freeze a reviewed dataset version for evaluation and submission.

**Completion check:** the report shows meaningful coverage from both sources,
actual record counts, and any unmet collection targets. No fabricated records.

## Milestone 4 Build retrieval

Retrieval finds the evidence before the model writes an answer.

- Create a searchable index from validated fields and permitted descriptions.
- Apply explicit city, type, budget, bedroom, and sale/rent filters in code.
- Search project descriptions and amenities for descriptive questions.
- Return a small ranked set of records, with stable source IDs and URLs.
- Interpret follow-up questions using limited conversation context while retaining
  earlier filters; ask for clarification when currency or rental period is unclear.
- Return no matches when appropriate. Do not claim complete market coverage.

Example checks: Riyadh villas below a stated SAR budget; annual apartment rentals
in Jeddah; Les Vagues bedroom options; projects with a swimming pool.

**Completion check:** a fixed question set retrieves the intended evidence from
both sources, and numeric constraints are met without relying on model arithmetic.

## Milestone 5 Integrate OpenRouter

- Select and test an available free model at implementation time. Keep its ID
  configurable and document the actual model used during evaluation.
- Store the API key only in a local environment file or hosting secret.
- Send the question, limited history, and retrieved records to the model.
- Instruct it to use only supplied evidence, cite source IDs, acknowledge missing
  or conflicting information, and ignore instructions embedded in scraped text.
- Validate citation IDs against the retrieved set; render source URLs from the
  dataset rather than trusting model-generated links.
- Handle quota errors, timeouts, and unavailable models clearly; do not silently
  switch to a paid model or disguise local search as an AI response.
- Limit input size and requests to protect the free-model allowance.

**Completion check:** real OpenRouter requests produce grounded answers with
valid citations. Unsupported questions receive an explicit limitation.

## Milestone 6 Build the chat interface

- Provide a responsive chat page, starter questions, send/loading/error states,
  and a reset conversation action.
- Show source cards, source site, and collection date with each relevant answer.
- Clearly distinguish projects from individual listings and disclose incomplete
  source coverage. Do not present old snapshots as live availability.
- Make missing prices and conflicting values understandable to a visitor.
- Escape generated content and keep credentials out of browser responses.

**Completion check:** a new visitor can ask questions about either source,
follow citations, and understand failures without developer assistance.

## Milestone 7 Docker and public deployment

- Add Dockerfile and `.dockerignore`; include only application code, required
  dependencies, and the validated dataset/index. Exclude raw pages and secrets.
- Add a health endpoint and configurable port; listen on all container interfaces.
- Build and run the image locally when Docker is available. Docker was absent
  during the earlier environment check and must be checked again.
- Choose a Docker-capable host using the user's account and current hosting terms.
  A static-only preview does not fulfill the deployed Docker requirement.
- Configure OpenRouter through hosting secrets and deploy the actual container.
- Test the public HTTPS URL from a fresh browser session, including a real AI
  response. Document any hosting cold starts or demo usage limits.

**Completion check:** another person can open the URL and successfully test the
chatbot without local installation. A Dockerfile alone is not completion.

## Milestone 8 Evaluation and submission

Recommendations reviewed on 19 November: prioritize strict answer schemas and
one bounded recovery for empty/truncated model responses. All starter answers must
be generated live; saved-answer caching was withdrawn by the user. Keep
retrieved evidence visible and labelled when generation fails. Do not equate source
conflicts with merely unverified values. Evaluate alias/bilingual support and numeric
claim checking next. Compare keyword retrieval against hybrid semantic retrieval
and RRF on a manually checked suite before adopting embeddings or rerankers. The
proposed 20 candidates, RRF constant 61 and five final records are experimental;
SQL, embeddings, rerankers and any alternative free models require measured benefit
and availability checks. The current 35-record implementation uses in-memory filters,
not SQLite. No vector database is needed at this stage.

Create 15–20 questions with expected evidence, including both sources, numeric
filters, follow-ups, source conflicts, no-match cases, and unrelated questions.

- Verify retrieval correctness separately from answer quality.
- Verify every cited source belongs to the retrieved set.
- Test API failure handling, input validation, and the deployed interface.
- Provide the working URL, source repository, setup/deployment instructions,
  data summary, architecture, actual model configuration, and limitations.
- Prepare a short demonstration explaining one question from retrieval through
  evidence selection to the final cited answer.

**Completion check:** all assignment requirements have demonstrable evidence,
including real data from both sources, free-model use, Docker, and a working URL.

## User inputs and responsibilities

| Input | Needed when |
| --- | --- |
| Assignment deadline and any required dataset size | Before finalizing collection targets |
| OpenRouter key entered privately in `.env` | Real model integration testing |
| Hosting account access and acceptable hosting budget | Deployment |
| Docker availability or an approved remote build environment | Container verification |
| Company access assistance if DarGlobal becomes blocked again | Only if repeated access fails |

Implementation, validation, and documentation can proceed without model or hosting
credentials until their respective milestones. Never paste secret keys into chat.

## Immediate work order

1. Generalize the successful DarGlobal browser collector.
2. Collect and normalize three to five different DarGlobal projects.
3. Review the Wasalt quality flags and establish the shared record contract.
4. Begin retrieval against the existing data while collection grows in batches.
5. Add the model, interface, Docker, and deployment in that order.

After each milestone, update `PROJECT_LOG.md` with changed files, data counts,
verification results, remaining issues, and the next concrete task.
