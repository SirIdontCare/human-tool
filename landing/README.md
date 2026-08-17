# Human Tool — Public Landing Site (V0)

Static public landing page for Human Tool: human capability as infrastructure for AI agents.

**Scope:** marketing/agent-facing public pages only. This directory is fully static — no build step, no dependencies, no backend, no database, no secrets. It is intentionally independent from the `human-tool` application in the repository root.

## Pages

| Path          | File                | Purpose                                        |
| ------------- | ------------------- | ---------------------------------------------- |
| `/`           | `index.html`        | Homepage with status and task catalogue        |
| `/for-agents` | `for-agents.html`   | Machine-readable specification for AI agents   |
| `/docs`       | `docs.html`         | Conceptual API / MCP interface (private alpha) |
| `/use-cases`  | `use-cases.html`    | Concrete usage scenarios                       |
| `/robots.txt` | `robots.txt`        | Crawler policy                                 |
| `/sitemap.xml`| `sitemap.xml`       | Sitemap                                        |

## Local run

No install required. Serve the directory with any static file server:

```powershell
npx --yes serve landing
# or
python -m http.server 8080 --directory landing
```

Open `http://localhost:8080`.

## Verification

Run the built-in zero-dependency check (Node only, no npm install):

```powershell
node landing/scripts/verify.mjs
```

Checks: all routes return 200, all internal links resolve, robots.txt allows AI/search crawlers, sitemap.xml is valid and lists all pages, every page has a title and meta description, and no secrets are present.

## Deploy to Vercel

The site is a plain static directory. Two options:

### Option A — standalone project (recommended)

Push the `landing/` directory as its own repository, or connect a new Vercel project to this repo and set:

- **Root Directory:** `landing`
- **Framework Preset:** Other (static)

Vercel serves `index.html`, `for-agents.html`, `docs.html`, `use-cases.html`, `robots.txt` and `sitemap.xml` directly with clean paths (`/for-agents`, `/docs`, `/use-cases`).

### Option B — CLI

```powershell
vercel --cwd landing --prod
```

## Before production deploy (must-do)

1. **Domain:** replace `https://domain.example` in `sitemap.xml` with the real domain. There is no canonical URL in the HTML because no domain is configured; add `<link rel="canonical">` once the domain exists.
2. **robots.txt:** optionally add a `Sitemap:` line pointing to the deployed sitemap once the domain is live.

## Deliberate non-features

No login, no dashboard, no database, no API calls, no analytics, no waitlist counter, no JavaScript (apart from embedded JSON-LD data), no third-party libraries. This site must stay build-free.
