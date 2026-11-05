import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { blankBook } from "../../src/domain/ledger.ts";
const root = process.argv[2],
  port = Number(process.argv[3]);
const book = blankBook("CNY", "性能回归合成账本");
book.id = "browser-review-book";
book.createdAt = "2020-01-01T00:00:00Z";
book.timeZone = "Asia/Shanghai";
book.settings.timeZoneMode = "fixed";
book.accounts = Array.from({ length: 19 }, (_, i) => ({
  id: "a" + i,
  name: "测试账户 " + i,
  type: i === 18 ? "credit" : "bank",
  currency: "CNY",
  groupId: i === 18 ? "credit" : "daily",
  openingMinor: i === 18 ? "0" : "10000000",
  openingAt: book.createdAt,
  icon: "Wallet",
  order: i,
  archived: false,
  netWorth: true,
}));
const expense = book.categories.filter(
    (c) => c.kind === "expense" && c.parentId,
  ),
  income = book.categories.filter((c) => c.kind === "income" && c.parentId);
book.projects = Array.from({ length: 8 }, (_, i) => ({
  id: "p" + i,
  name: "项目 " + i,
  archived: false,
}));
book.entries = Array.from({ length: 20000 }, (_, i) => {
  const date = new Date(
      Date.parse("2026-11-06T00:00:00Z") - i * 9000000,
    ).toISOString(),
    kind = i % 10 === 0 ? "income" : "expense";
  return {
    id: "e" + i,
    kind,
    accountId: "a" + (i % 19),
    amountMinor: String(100 + (i % 10000)),
    description: (kind === "income" ? "工资" : "日常消费") + " " + (i % 400),
    note: "合成数据",
    posted: i % 31 !== 0,
    occurredAt: date,
    createdAt: date,
    updatedAt: date,
    revision: 1,
    splits: [
      {
        id: "s" + i,
        categoryId: (kind === "income" ? income : expense)[
          i % (kind === "income" ? income : expense).length
        ].id,
        amountMinor: String(100 + (i % 10000)),
        projectId: "p" + (i % 8),
      },
    ],
  };
});
const fixture = JSON.stringify(book);
http
  .createServer(async (req, res) => {
    try {
      if (req.url === "/__fixture.json") {
        res.setHeader("Content-Type", "application/json");
        return res.end(fixture);
      }
      const pathname = new URL(req.url, "http://localhost").pathname;
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      const body = await readFile(file);
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".html": "text/html",
          ".css": "text/css",
          ".json": "application/json",
          ".webmanifest": "application/manifest+json",
          ".png": "image/png",
          ".svg": "image/svg+xml",
        }[path.extname(file)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log("synthetic review server", port),
  );
