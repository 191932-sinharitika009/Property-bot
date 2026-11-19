# Project log

Use this one file for project changes, status, and next steps. Append a dated
entry when changing code or data and update the current status. Generated crawl
and validation reports are evidence, not additional change logs.

## Current status — 2026-11-19

GitHub/hosting preparation: initialized a local `main` repository using the user's
existing Git identity. The current implementation is being grouped into component
commits with real commit timestamps; these are not historical daily checkpoints.
Added Render's free Docker service configuration and GitHub CI for automated tests,
retrieval evaluation, Docker build, health and private-file exclusion. CI and remote
deployment have not run. GitHub repository selection/access and hosting connection
are pending. Only curated records and manifest are included for reproducible builds;
the API key, raw pages and review evidence remain ignored. Secret scan passed.

Sidebar follow-up: replaced the separate sidebar scrollbar with normal document
flow after user feedback. Sidebar and chat now share one page scrollbar. Verified
in Chrome at 1280×500 that the page scrolls, the sidebar has no internal overflow,
and its final snapshot note is reachable.

- Wasalt: 22 distinct listing URLs consolidated from the initial three-page and
  expanded twenty-page runs (one URL overlapped). One pair has matching core
  details, so 22 URLs does not necessarily mean 22 unique real-world properties.
- Validation: 16 Wasalt records passed automated checks; six need review (one
  area conflict and five unusually large apartment areas). Four are rentals
  with explicit periods. Availability is unverified.
- DarGlobal: 13 automatically parsed project records in `data/darglobal/crawl/`.
  Discovery found 32 candidates; 13 are collected, one encountered an access
  block, and 18 remain pending. The crawler is stopped pending access resolution.
- The assisted structured record and local browser snapshot describe the same
  project. Area claims conflict (84–383 versus 86–389 square metres); price is
  absent. A project must remain distinct from an individual unit offer.
- Curated dataset: 35 typed records (22 listings, 13 projects). Nineteen pass
  current checks; sixteen carry explicit caveats, including the duplicate pair.
  Thirteen have area values withheld from numeric filtering (uncertain or absent).
- Retrieval now works against all 35 curated records with structured filters,
  keyword ranking, source links, and limited English question/follow-up parsing.
- Forty-eight automated tests and the 19-question retrieval evaluation pass.
  OpenRouter now returns real cited answers from both sources using
  `nvidia/nemotron-3.5-super-vl:free`. Initial answer checks passed with a prompt
  correction for withheld conflicting values; broader evaluation remains pending.
- Browser interface and Docker packaging are implemented. Fifty-two tests pass;
  desktop/mobile browser smoke checks and one live browser-to-model answer pass.
  Docker is absent locally, so image build/run verification is pending. Hosting
  and a public URL remain unimplemented.

## 2026-11-19 — Browser interface and Docker packaging

- Added a responsive Property Desk interface with four starter questions, text
  composer, loading/errors, cited source cards, collection dates, caveats and reset.
- Added a Node HTTP server, health endpoint, bounded in-memory sessions, HttpOnly
  cookies, per-IP rate limiting, body/question limits, same-origin checks, security
  headers and an explicit static-file allowlist. Model text is rendered as text.
- Tested private-file exclusion, context isolation/reset, invalid/oversized inputs,
  cross-origin rejection and rate limiting. All 52 automated tests passed.
- Chrome smoke checks passed on desktop and 390px mobile: starter, answer, source
  URL, reset, no horizontal overflow and no JavaScript page errors. Screenshots
  remain local under `data/review/`. A real browser request returned the correct
  Les Vagues bedroom options and a clickable DarGlobal citation.
- Added Dockerfile, allowlisted `.dockerignore` and Compose config. Runtime is
  Node 24 Alpine, non-root, with health checks; Compose adds a read-only filesystem
  and injects `.env` only at runtime. No raw pages or secrets are included in image.
- Docker executable is absent from PATH and the standard Docker Desktop location.
  Image build/run verification is outstanding; no claim of a tested container.
- Local start command: `npm.cmd start`; browser address http://localhost:8000.
  Public deployment is a separate remaining milestone.

## 2026-11-19 — Live model validation

- Found the supplied key in `.env.example`; moved configuration into private
  `.env` and cleared the template key without printing credentials.
- The sandbox request failed to connect. An approved external-network request
  reached OpenRouter; Gemma returned HTTP 429. One explicit free-router test
  succeeded and identified `nvidia/nemotron-3.5-super-vl:free` as the responding model.
- Direct NVIDIA-model requests then returned valid citations for Riyadh villa
  sale listings below SAR 2 million and Les Vagues' absent recorded price.
  Wasalt output preserved SAR 880,000 / SAR 1,600,000 prices, bedrooms, area caveats,
  duplicate warnings and unverified availability. This was three source listings,
  not a claim of three distinct properties.
- Added area-question interpretation and a regression test. A live area answer
  initially confused withheld conflicting values with source absence. Strengthened
  the prompt and retested: it now states that conflicting source ranges prevent
  a reliable answer, with no invented numeric value. Some technical phrasing remains.
- Five successful model responses in this session across four distinct questions,
  including the corrected area retest. These are initial checks, not a full benchmark.
- Set the tested NVIDIA free endpoint as the code, template and private-config
  default. No automatic model fallback or paid requests were introduced.
- Verified 48 automated tests and all 19 retrieval cases. Next: chat interface,
  session/rate-limit handling, followed by Docker and public deployment.

## 2026-11-19 — OpenRouter integration (live verification pending)

- Added `chat/openrouter.mjs`, `chat/answer.mjs`, `scripts/chat.mjs`, and ten tests.
  The `chat` command connects reviewed retrieval to the Chat Completions API.
- Selected Gemma 4 26B A4B's free endpoint as the default candidate, based on its
  current OpenRouter listing. Configuration remains changeable; no model has yet
  been evaluated through a real API request in this project.
- Added bounded prompts, untrusted-source instructions, structured JSON statements,
  per-statement source-ID validation and application-owned source links. Preserved
  quality warnings and snapshot coverage in the response. Citation membership
  validation is not semantic fact verification; manual answer evaluation is pending.
- Enforced free model configuration and zero prompt/completion provider prices,
  timeouts, one in-flight request per instance and no automatic retries/fallbacks.
  Added safe errors for authentication, quota, rate limits, provider failures,
  malformed responses, truncation and invalid citations.
- No-match/clarification responses skip OpenRouter and identify themselves as
  application output. Prior retrieval context supports the existing limited
  follow-up syntax; raw conversation history is not sent to the model.
- Verified 47 tests. Ran the real CLI against Les Vagues: it correctly returned
  `missing_key` after retrieving one source. No `.env` or environment API key exists;
  no authenticated API request was made. No credentials were printed.
- Next: configure the key privately, test real answers from both sources, then
  implement the interface and public-server protections before deployment.

## 2026-11-19 — Retrieval implementation

- Added `retrieval/search.mjs`, `retrieval/question.mjs`, a search CLI, ten retrieval
  tests, and a separate 19-question evaluation against the real curated snapshot.
- Filters cover source, listing/project, city, country, property type, sale/rent,
  currency, rent period, price bounds, bedrooms, area bounds, and one amenity.
  Project area ranges must fit entirely inside requested bounds. Prices are never
  converted across currencies or rental periods. Missing numeric values do not match.
- Blocked fields are withheld defensively before indexing. Results retain stable
  IDs, original URLs, collection times, warnings, duplicate groups, and availability
  limitations. Default result size is five, with a maximum of twenty.
- Added deterministic token matching with title-weighted ranking. All residual
  query terms must match, so unknown places/topics cannot silently broaden results.
  Descriptions remain excluded because no reviewed description field exists yet.
- Bounded English parsing recognizes common filters and explicit follow-ups such
  as `Only 4 bedrooms`. Ambiguous budgets and unsupported exclusions/alternatives
  request clarification. General language understanding is not implemented yet.
- Used an in-memory index for the 35-record snapshot; updated the architecture
  plan to defer SQLite until coverage or measured performance justifies it.
- Verified `npm.cmd test` (37 passed) and `npm.cmd run evaluate:retrieval` (19
  passed). PowerShell blocks npm.ps1 locally; npm.cmd runs without changing policy.
- No collection was attempted; DarGlobal's access stop remains in effect. This
  milestone provides evidence retrieval, not AI-generated answers or deployment.

## 2026-11-19 — Data review and curated dataset

- Reviewed all six flagged Wasalt records, all nine originally flagged DarGlobal
  projects, and the suspected duplicate pair using saved pages, without crawling.
- Corrected Urban Oasis amenity extraction using matching project JSON-LD. Its
  six amenities are now available; DarGlobal parser version is 3.
- Retained actual source conflicts rather than inventing corrected values.
  Large Wasalt apartment areas agree with the pages but remain unverified.
- Found an additional pool-inclusion conflict in Painite Villas' source sections;
  its amenities are withheld from the curated dataset pending clarification.
- The two matching Wasalt records have distinct listing references and ad-license
  identifiers. Kept them separate with a possible-duplicate group, not a claim
  that they represent two distinct physical properties.
- Saved 17 evidence-linked decisions in `data/review/decisions.json`, bound to
  normalized-record and original HTML hashes. New source changes require review.
- Added deterministic combined-dataset generation, JSONL/CSV exports, versioned
  manifest, consistent country aliases, typed listing/project fields, and field
  restrictions. No raw descriptions or contact information enter curated data.
- `data/curated/records.jsonl` is the input for the next retrieval milestone.
  Uncertain area numbers are also removed from searchable/display listing titles;
  originals remain in source datasets. Detailed conflicting claims stay in audit
  evidence rather than retrieval text. Current availability remains unverified.
- Verified 27 tests and a full 35-record build. Collection block is unchanged.

## 2026-11-19 — Resumable DarGlobal crawler

- Added `darglobal-crawl.mjs`, `darglobal-core.mjs`, `darglobal-store.mjs`, and
  `darglobal-reparse.mjs`, plus tests and the `scrape:darglobal` npm command.
- Live directory discovery found 32 same-site candidates. robots.txt was readable
  in this session and its rules were applied. Collection stops if rules are
  unavailable; earlier one-page diagnostics remain separate historical tests.
- Verified resume across batches of five and eight URLs without refetching
  completed entries. Reparsed saved pages after template corrections.
- Added atomic checkpoints/exports, exclusive-run lock, interrupted-entry
  recovery, bounded transient retries, same-origin navigation, and explicit
  continuation after access blocks. Unknown-layout HTTP responses are not retried.
- Parser handles standard and one-of-one layouts, explicit SQFT-to-SQM conversion,
  bedroom ranges, summary/FAQ conflicts, sparse records, and regional labels.
  Visa-investment amounts are not treated as property prices.
- Current project outputs are in `data/darglobal/crawl/projects.jsonl` and CSV.
  Raw HTML and per-attempt diagnostics link each record to its source snapshot.
- The third batch reached the Qatar landing page. Its first response contained
  an unrecognized layout; a retry under the earlier policy returned a challenge.
  Collection stopped with prior data intact. The revised policy does not retry
  a successful HTTP response merely because its layout is unknown.
- Tested the stop guard locally: a subsequent default invocation refused to
  launch a browser or continue after the recorded block, and released its lock.
- Scope limit: 13 project layouts collected/parsed, not guaranteed full coverage.
  Some records need review. Headless and Docker browser collection remain untested.

## 2026-11-19 — Implementation plan

- Added `PLAN.md` with eight milestones from repeatable collection to a tested
  public Docker deployment, acceptance criteria, dataset targets, and user inputs.
- The plan defines future work; this file remains the single change history.
- No new crawl, application feature, or deployment was performed for this update.

## 2026-11-19 — Organization and cleanup

- Consolidated useful data into `data/wasalt/` and `data/darglobal/`.
- Preserved every distinct collected listing URL, newest overlapping snapshots,
  matching HTML, source URLs, timestamps, and successful collection reports.
- Regenerated Wasalt JSONL, CSV, and validation from the 22 retained pages.
- Removed old run folders, duplicate snapshots/sitemaps, failed challenge
  responses, the superseded headless probe, and temporary consolidation code.
- Consolidated scattered status documents here; README now covers setup/usage.
- Retained dependencies, lockfile, environment template, working code, and tests.
- Previous timestamped file links are obsolete; use the README's source folders.

## 2026-11-19 — DarGlobal investigation

- Direct HTTP to robots.txt and Les Vagues returned a 212-byte Incapsula challenge
  despite HTTP 200. No valid project data came from those requests.
- Headless Chrome timed out after 45 seconds waiting for DOMContentLoaded.
- The browsing tool returned readable content; one assisted record was saved.
- Visible Chrome with document-commit navigation and content checks then
  collected Les Vagues locally (5,217 visible characters). No bypass was used.
- Screenshot capture timed out waiting for fonts; HTML/text collection succeeded.
  The earlier timeout's cause is unproven because browser mode and waiting logic
  both changed. Other project pages have not yet been tested with this method.

## 2026-11-19 — Wasalt expansion

- Collected three initial listings, then twenty evenly spaced sitemap candidates.
- The sitemap contained 60,000 URLs; this is discovery, not verified inventory.
- Added metadata parsing, price/bedroom consistency checks, area comparisons,
  explicit rental periods, review flags, duplicate detection, CSV export, and
  coverage/missing-field reports. Original published values are preserved.
- Added incremental reports so interrupted collection retains progress.

## 2026-11-18 — Setup

- Created JavaScript project with Cheerio and robots-parser. Node.js was available
  while the Python command was not usable.
- Built bounded, paced collection, URL discovery, raw snapshots, provenance, and
  challenge detection. The first interrupted one-page run was later superseded.

## Scope and authorization context

The user stated that the assignment came from the company and instructed public
collection to continue. This is user-provided context, not an independently
verified unrestricted license from both operators. Collection excludes login-only
data and challenge bypass. Wasalt's /search restriction is respected through
sitemap discovery. The HTTP crawler stops when robots.txt cannot be read; the
separate browser diagnostic tests one user-provided URL. Terms reviewed:
https://wasalt.sa/s/terms-of-use and https://darglobal.co.uk/terms-conditions .
Raw snapshots stay local.

## Next steps

1. Expand live answer evaluation, including follow-ups and rental-period questions.
2. Verify the Docker build and container health on a Docker-capable machine.
3. Expand reviewed coverage in parallel with application work when access permits;
   the Wasalt coverage target and fully incremental collection remain outstanding.
4. Package with Docker, deploy, and verify the public URL.
5. Evaluate the deployed chatbot and prepare the assignment demonstration.
