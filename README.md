# Property chatbot

**Live demo:** https://property-bot-463606904338.asia-south1.run.app/

Public Cloud Run verification succeeded on 19 November 2026: the homepage and
health endpoint returned HTTP 200, and real OpenRouter answers with valid source
citations were returned for both DarGlobal and Wasalt. The snapshot contains 35
records; current availability is unverified. Cold starts and free-model rate limits
can delay responses. Try "Les Vagues bedroom options" or "Annual apartment rentals
in Jeddah". The deployed model is `nvidia/nemotron-3.5-super-vl:free`.

See [PROJECT_LOG.md](PROJECT_LOG.md) for the single project history, current
status, known issues, and next steps. This README covers setup and usage.
See [PLAN.md](PLAN.md) for the implementation milestones and completion criteria.

## Structure

```text
data/
  wasalt/       Consolidated records, CSV, validation, collection reports
    raw/        Original HTML for each retained listing URL
  darglobal/    Les Vagues project, browser page, collection report
    raw/        Original browser HTML
scrapers/       Collection, extraction, and normalization code
test/           Parser and validation tests
PROJECT_LOG.md  Project changes and progress
```

`node_modules/` holds installed dependencies and is ignored by Git. Keep it for
local execution; restore it with `npm.cmd ci --ignore-scripts` if needed.

## Commands

Requires Node.js 22+, curl, and installed Chrome for the browser diagnostic.
No OpenRouter key is needed for collection. `.env.example` is for later AI setup.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test

# Collect a paced Wasalt sample into data/runs/<timestamp>/:
node scrapers/scrape.mjs --source wasalt --limit 20 --spread

# Regenerate the current Wasalt JSONL, CSV, and validation report:
node scrapers/normalize-run.mjs data/wasalt

# Build the combined retrieval dataset from normalized records and review decisions:
npm.cmd run build:dataset

# Discover projects and collect at most five pending URLs, resuming automatically:
node scrapers/darglobal-crawl.mjs --limit 5

# Reparse downloaded DarGlobal HTML without any network requests:
node scrapers/darglobal-reparse.mjs

# Optional one-page diagnostic:
node scrapers/browser-diagnostic.mjs
```

New collection runs use temporary folders under `data/runs/`. Review them before
promoting records to the source folders. Repeated runs do not automatically
expand the consolidated Wasalt dataset. DarGlobal's multi-project crawler keeps
its resumable queue and outputs in `data/darglobal/crawl/`.

## DarGlobal crawler operation

The crawler uses installed Chrome visibly, reads robots.txt, discovers same-site
project candidates from `/projects`, and makes paced sequential requests. A run
visits at most `--limit` pending URLs; successful records are skipped on resume.
It retries only transient navigation/server failures once, with a delay.

- `--discover`: refresh directory discovery without discarding existing records.
- `--urls path.json`: add an explicit JSON array of same-site project URLs.
- `--retry-failed`: explicitly requeue transient/insufficient-content failures.
- `--headless`: optional experiment; unattended operation is not validated.
- `--resume-after-stop`: explicit continuation after resolving a previous access
  block. Inspect the report first. Blocked URLs are not automatically retried.

Unavailable crawling rules, challenge pages, and rate limits stop live collection.
No stealth configuration, login, or challenge bypass is used. Unknown templates
are saved for review rather than filled with guessed data. Pending work remains
in the checkpoint. An interrupted entry is requeued on the next successful start.
A lock prevents simultaneous runs; after a hard process kill, inspect whether
that process still exists before manually removing a stale `.lock` file.

`state.json` is the authoritative checkpoint; do not edit it during a run.
`projects.jsonl`, `projects.csv`, and `summary.json` are regenerated exports.
Parser-only updates use `darglobal-reparse.mjs` and do not download pages again.
The browser is closed on normal completion, handled failure, or interruption.
Exit codes: 0 for a completed batch/queue, 1 for execution/preflight errors,
2 for a stopped crawl, and 130 for an interrupted run.

## Data files

### Browser application

Run `npm.cmd start` from the project folder, then open http://localhost:8000.
On macOS/Linux use `npm start`. The server reads the private `.env` file. The UI
supports starter questions, Enter to send (Shift+Enter for a new line), source cards,
loading/error states, and New conversation. It renders model text as text, not HTML.

The server listens on `0.0.0.0` using `PORT` (default 8000). `/health` reports
readiness and the record count without secrets. Conversation context is stored in
memory behind HttpOnly, SameSite cookies, expires after 30 minutes, and resets on
restart. Sessions are bounded to 1,000. Requests are limited to 12 per minute per
socket IP, 2,000 question characters and 8 KB bodies. One model request runs at a
time per server. For HTTPS deployment set `COOKIE_SECURE=true`; configure trusted
proxy handling and distributed rate/session storage before scaling beyond one
instance. The current server intentionally ignores forwarded IP headers, so users
behind a reverse proxy may share the same request limit.

Browser smoke check (requires installed Chrome and development dependencies):
`node scripts/check-browser.mjs`. It uses a simulated answer to check interactions
without spending model quota. A separate real browser-to-OpenRouter request was
verified successfully for Les Vagues on 19 November 2026.

### Docker packaging

### GitHub and Render deployment

### Google Cloud Run (selected hosting target)

Use Google Cloud Shell with a project linked to your trial billing account. From
the repository root, run `bash scripts/deploy-cloud-run.sh`. The script defaults to
project `project-1275534d-53d6-4c08-b10` and Mumbai (`asia-south1`); optional arguments
override the project and region. It requires permission to enable APIs, create a
service account, grant build/secret access, create secrets and deploy public services.

It enables Cloud Run, Cloud Build, Artifact Registry, Secret Manager and IAM;
grants a dedicated build account the Cloud Run Builder role; creates a
dedicated runtime account with access only to the chatbot secret; and prompts for
the OpenRouter key without echoing it. No key is passed in command-line arguments.
Each run creates a new secret version and pins that version in the deployment.

Cloud Build builds the existing Dockerfile. The `.gcloudignore` allowlist excludes
local keys, raw pages and unrelated files from the uploaded build context. The
service allows public access, uses 1 CPU/512 MiB, request-based billing, zero minimum
instances and a maximum of one instance per revision. Scaling limits reduce usage
but are not a hard spending cap. Builds, stored images and secrets can also consume
trial credits. Set billing budget alerts in the console; alerts do not stop spending.
Sessions live in memory and can reset when the service scales down or restarts.

The script prints the HTTPS URL and checks `/health`. After the user performed the
Cloud Shell deployment, the public homepage, health endpoint and real cited answers
from both sources were verified. Cloud Build logs and IAM settings have not been
independently inspected from this workspace.

### Render alternative

The current implementation is organized into component commits created when the
repository was initialized; commit dates are not a reconstructed development timeline.
`PROJECT_LOG.md` records the implementation work and its verification history.

Push `main` to your GitHub repository. The workflow in `.github/workflows/verify.yaml`
runs tests, retrieval evaluation, a Docker build and a container health check without
an OpenRouter key. No image or API secret is published by this workflow.

For Render, create a Blueprint from that repository and use `render.yaml`. It
selects the Docker runtime and free plan, `/health`, secure cookies, and the tested
free model. Enter `OPENROUTER_API_KEY` privately in Render when prompted; its value
is intentionally absent from the repository. Wait for the build and deployment to
succeed, then verify a real cited answer at the provided HTTPS URL. Free services
may sleep when idle, and in-memory conversations are lost on restart. Do not claim
deployment complete until the actual URL and answer have been checked.

See [Render Docker hosting](https://render.com/docs/docker),
[Blueprint configuration](https://render.com/docs/blueprint-spec), and
[free-service limitations](https://render.com/docs/free).

### Run Docker locally

Prerequisites: a running Docker installation, the reviewed
`data/curated/records.jsonl` snapshot, and a private `.env` with the API key.
The reviewed records and manifest are tracked in Git for reproducible builds.
Raw source snapshots, review evidence and CSV exports remain local and ignored.

```powershell
docker compose up --build -d
docker compose ps
docker compose logs --tail 50
```

Open http://localhost:8000. Stop an existing local `npm start` first to free port
8000. Stop the container with `docker compose down`.

Without Compose:

```powershell
docker build -t property-chatbot .
docker run --rm --env-file .env -e PORT=8000 -p 8000:8000 property-chatbot
```

The Node 24 Alpine image runs as a non-root user and has an HTTP health check.
Only runtime code, browser assets and the curated JSONL are copied. `.dockerignore`
uses an allowlist: keys, raw pages, reviews, local node_modules and crawler/browser
dependencies are excluded. The runtime uses Node built-ins and needs no npm install.
Compose injects secrets at runtime and uses a read-only filesystem, dropped Linux
capabilities and no-new-privileges. Never copy `.env` into the image.

Verification limit: Docker is not installed in the current workspace machine.
Packaging has been reviewed, but an actual image build and container health check
still need to run on a Docker-capable machine. No public deployment is included yet.

### OpenRouter answers

Copy `.env.example` to `.env` if `.env` does not already exist, then edit `.env`
privately to set `OPENROUTER_API_KEY`. Never paste the key into chat or commit it.
The default model is `nvidia/nemotron-3.5-super-vl:free`, tested with real cited
answers from both sources. Gemma's free endpoint returned a rate-limit error in
the live check. You may configure another `:free` model or `openrouter/free`.

```powershell
npm.cmd run chat -- "Les Vagues bedroom options"
```

This command retrieves evidence and makes one real OpenRouter request when a key
is present. Missing keys produce an explicit error. No-match and clarification
responses come from application code and do not call the model. No local response
is presented as an AI answer. Model responses must be JSON statements with valid
source IDs; URLs and source cards come from the dataset. The output reports both
requested and returned model IDs. The CLI is stateless; `createChat` accepts the
previous result's retrieval context for supported follow-ups, not raw chat history.

Requests use at most five evidence records, a 45,000-character evidence payload,
2,400 output tokens, reasoning disabled, a strict response schema, a 30-second total
deadline, and one concurrent request per chat instance. Empty/truncated responses
allow one recovery within that same deadline; authentication, quota, rate limits and
deadline expiry are not retried. There are no paid-model fallbacks. Requests restrict
provider prompt/completion prices to zero. Quota, authentication, timeout, incomplete
output and invalid-citation failures return safe messages without upstream details.
Failures also include retrieved source records labelled as evidence, not an AI answer.

The browser's four starter questions use reviewed, saved OpenRouter answers in
`data/curated/starter-answers.json`. They require no live model calls while the
dataset, prompt and configured model match the saved fingerprint. Changed data,
prompts, models or invalid citations invalidate the cache. Sources and conversation
filters are rebuilt from current retrieval on every request. The UI labels saved
answers; arbitrary questions and follow-ups still use the live model.
To regenerate, run `node scripts/cache-starters.mjs` (four live requests, with up to
one recovery per request), then review the saved claims before deploying. The cache
is packaged with Docker and persists across service restarts. Failed generation
leaves the previous file intact. The CLI chat command remains uncached.

To publish updates to an existing Cloud Run service from Cloud Shell:

```bash
cd ~/Property-bot
git pull --ff-only origin main
bash scripts/update-cloud-run.sh
```

The update script retains the existing service configuration and secret; it does
not ask for your API key again. GitHub pushes alone do not redeploy Cloud Run.

Citation checks verify source membership and response format; they do not prove
that every generated claim is supported. Initial live checks covered missing prices,
area conflicts and suspected duplicates; broader answer-quality evaluation remains
required. The model can still use technical phrasing despite prompt instructions.
Treat returned statement text as plain text in the future UI; never insert it as
HTML. Public-server rate limiting and session handling belong to the next milestone.

Reference: [OpenRouter API](https://openrouter.ai/docs/api/reference/overview),
[error handling](https://openrouter.ai/docs/api/reference/errors-and-debugging).

### Try retrieval locally

From the project folder in PowerShell:

```powershell
npm.cmd run search -- "Riyadh villas for sale below SAR 2 million"
npm.cmd run search -- "Annual apartment rentals in Jeddah"
npm.cmd run search -- "Les Vagues bedroom options"
npm.cmd run search -- "DarGlobal projects with a swimming pool"
npm.cmd run evaluate:retrieval
npm.cmd test
```

These commands search the reviewed snapshot and print JSON evidence; they do not
call an AI model. `status` is `matches`, `no_matches`, or `clarification_required`.
`total` counts matching source records before the result limit (five by default),
including suspected duplicate listings. Each result carries the source URL,
collection time, quality warnings, and published status. Availability is unverified.

Application code can import `loadRecords` and `createSearch` from
`retrieval/search.mjs`, then call the returned search function:

```javascript
const result = search({
  filters: { city: 'Riyadh', transaction: 'sale', currency: 'SAR',
    property_type: 'villa', max_price: 2000000, bedrooms: 4 },
  limit: 5
});
```

Supported structured filters: `source`, `record_type`, `city`, `country`,
`property_type`, `transaction`, `currency`, `period`, `min_price`, `max_price`,
`min_price_exclusive`, `max_price_exclusive`, `bedrooms`, `min_area`, `max_area`,
and `amenity`. Area is in square metres. Ordinary price bounds are inclusive;
exclusive bounds support “below/above.” No currency or rent-period conversion is
performed. Project area ranges must fit entirely within the area bounds.

`answerSearch(question, records, search, previousContext)` from
`retrieval/question.mjs` adds bounded English interpretation. Pass its returned
`context` to the next call. Follow-ups beginning with “and,” “what about,” “only,”
“under,” “below,” “with,” or “instead” retain earlier filters; other questions start
a fresh search. For example, “Only 4 bedrooms” narrows the Riyadh villa query.
The CLI is stateless. A future chat API will keep this context per conversation.

The English parser is deliberately limited: one city, type, currency, and amenity
per search; no exclusions, OR searches, arbitrary numeric comparisons, or general
conversation understanding. Missing budget units require clarification. Unrecognized
words remain mandatory search terms, which can cause no matches for unsupported
paraphrases. Use structured filters for exact searches, including area bounds.
Only reviewed titles, locations, types, and amenities are indexed; raw descriptions
are not searched. The evaluation command checks 19 cases against the current
35-record snapshot and should be reviewed when the dataset changes.

- `data/curated/records.jsonl`: combined, typed dataset used by the retrieval
  layer. Uncertain numeric fields are null; warnings and source links are retained.
- `data/curated/records.csv`: combined dataset for inspection in Excel.
- `data/curated/manifest.json`: version hash, counts, input files, and limitations.
- `data/review/decisions.json`: snapshot- and record-hash-bound review decisions.
  The build refuses stale decisions and changed source snapshots. Review newly
  flagged data before editing these decisions; do not automatically reapprove it.
- `scripts/record-review.mjs` records the initial inspected snapshots and refuses
  to overwrite existing decisions. It is not an automatic validator for new data.

- `data/wasalt/properties.jsonl`: one normalized property record per line.
- `data/wasalt/properties.csv`: the same records for Excel, with review flags.
- `data/wasalt/validation.json`: completeness, consistency, and duplicate checks.
- `data/darglobal/crawl/projects.jsonl`: current automatically collected projects.
- `data/darglobal/crawl/projects.csv`: current project export for Excel.
- `data/darglobal/crawl/summary.json`: collection outcomes and review flags.
- `data/darglobal/projects.jsonl`: initial assisted reference record; retained as
  provenance, not an additional project or the current dataset.
- `data/darglobal/pages.jsonl`: the same project's independently collected local
  browser page. This is evidence, not another project.
- Each source retains collection reports and original HTML for auditing.

Normalized property fields exclude agent/contact information. Raw pages may
contain it and must not be used directly as chatbot context. Collected data is
ignored by Git except for the curated deployment records and manifest. Missing
values remain null and conflicts are flagged. Passing
checks does not establish current availability.
