import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Living World entry experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>苔原｜Living World MVP<\/title>/);
  assert.match(html, /LIVING WORLD \/ BLOCKWORLD MVP/);
  assert.match(html, /世界历史/);
  assert.match(html, /aria-label="可以移动和编辑的方块世界"/);
  assert.match(html, /规则：怪物只能走草地或火把格；墙体会改变它的路线。/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the client as a viewer of the authoritative world service", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const API_BASE = "\/api"/);
  assert.match(page, /fetch\(`\$\{API_BASE\}\/snapshot/);
  assert.match(page, /fetch\(`\$\{API_BASE\}\/command/);
  assert.match(page, /rule_missions\?: RuleMissionEvent\[\]/);
  assert.match(page, /规则回执/);
  assert.match(page, /世界服务尚未连接/);
  assert.match(layout, /title: "苔原｜Living World MVP"/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});
