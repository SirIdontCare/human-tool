import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const PAGES = ["/", "/for-agents", "/docs", "/use-cases"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const failures = [];
const ok = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      const file = normalize(join(ROOT, rel));
      const candidate = statSync(file, { throwIfNoEntry: false })?.isFile()
        ? file
        : statSync(file + ".html", { throwIfNoEntry: false })?.isFile()
          ? file + ".html"
          : null;
      if (!candidate || !candidate.startsWith(ROOT)) {
        res.writeHead(404).end("not found");
        return;
      }
      const ext = candidate.slice(candidate.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(readFileSync(candidate));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function assertStatus(name, code) {
  const pass = code === 200;
  pass ? ok(`${name} returns 200`) : fail(`${name} expected 200, got ${code}`);
}

function getLinks(html, base) {
  const links = new Set();
  const re = /(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
    links.add(new URL(href, base).pathname);
  }
  return links;
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;

console.log("1) Public routes");
for (const p of PAGES) assertStatus(p, (await fetch(base + p)).status);
assertStatus("/robots.txt", (await fetch(base + "/robots.txt")).status);
assertStatus("/sitemap.xml", (await fetch(base + "/sitemap.xml")).status);
assertStatus("/assets/style.css", (await fetch(base + "/assets/style.css")).status);

console.log("2) Internal links resolve");
const allFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".html")) allFiles.push(full);
  }
})(ROOT);
for (const file of allFiles) {
  const html = readFileSync(file, "utf8");
  for (const target of getLinks(html, base)) {
    const code = (await fetch(base + target)).status;
    if (code !== 200) fail(`${file}: broken link ${target} (${code})`);
  }
}
ok(`${allFiles.length} HTML files, all internal links verified`);

console.log("3) robots.txt allows required crawlers");
const robots = readFileSync(join(ROOT, "robots.txt"), "utf8");
for (const ua of ["OAI-SearchBot", "GPTBot", "ClaudeBot", "PerplexityBot"]) {
  const re = new RegExp(`User-agent: ${ua}\\s*\\nAllow: /`);
  re.test(robots) ? ok(`${ua} allowed`) : fail(`robots.txt missing ${ua}`);
}
if (/Disallow: \/$/.test(robots)) fail("robots.txt disallows root for some agent");
else ok("no blanket Disallow: /");

console.log("4) sitemap.xml valid and complete");
const sitemap = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const p of PAGES) {
  locs.some((l) => new URL(l).pathname === p)
    ? ok(`sitemap contains ${p}`)
    : fail(`sitemap missing ${p}`);
}
const doc = sitemap.includes("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">") && sitemap.trim().endsWith("</urlset>");
doc ? ok("well-formed urlset wrapper") : fail("sitemap structure invalid");

console.log("5) Each page has title and meta description");
for (const p of PAGES) {
  const html = await (await fetch(base + p)).text();
  const hasTitle = /<title>[^<]+<\/title>/.test(html);
  const hasDesc = /<meta name="description" content="[^"]+"/.test(html);
  const hasLang = /<html lang="en">/.test(html);
  hasTitle ? ok(`${p} has <title>`) : fail(`${p} missing <title>`);
  hasDesc ? ok(`${p} has meta description`) : fail(`${p} missing meta description`);
  hasLang ? ok(`${p} has lang="en"`) : fail(`${p} missing lang attribute`);
}

console.log("6) No secrets in this directory");
const secretPatterns = [
  /DATABASE_URL/i,
  /NEON/i,
  /PGPASSWORD/i,
  /POSTGRES/i,
  /sk-[A-Za-z0-9]{20,}/,
  /api[_-]?key\s*[:=]\s*["'][^"']+["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /bearer\s+[A-Za-z0-9._-]{20,}/i,
];
let secretHits = 0;
(function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "scripts") continue;
      scan(full);
    } else {
      const content = readFileSync(full, "utf8");
      for (const re of secretPatterns) {
        if (re.test(content)) {
          secretHits++;
          fail(`possible secret pattern ${re.source} in ${full}`);
        }
      }
    }
  }
})(ROOT);
secretHits === 0 && ok("no secret-like content found");

server.close();
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
