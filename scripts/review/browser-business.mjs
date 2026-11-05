import { connect } from "./cdp.mjs";
import { writeFile, mkdir } from "node:fs/promises";
const output = process.env.REVIEW_OUTPUT || "/tmp/fine-ledger-browser-review";
await mkdir(output, { recursive: true });
import assert from "node:assert/strict";
const port = Number(process.argv[2] || 4196),
  label = process.argv[3] || "optimized";
for (const t of await (await fetch("http://127.0.0.1:9337/json/list")).json())
  if (t.type === "page")
    await fetch("http://127.0.0.1:9337/json/close/" + t.id);
const c = await connect("http://127.0.0.1:" + port + "/");
const result = { checks: [], timings: [] };
const frames = () =>
  c.evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
async function click(text) {
  await c.evaluate(
    `(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0);if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`,
  );
  await frames();
}
async function css(sel) {
  await c.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
  await frames();
}
async function input(sel, value) {
  await c.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('missing '+${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`,
  );
  await frames();
}
async function book() {
  return c.evaluate(
    `new Promise((resolve,reject)=>{const r=indexedDB.open('fine-ledger-p0-review-v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('state').objectStore('state').get('book');q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)}})`,
  );
}
const snap = (b) => ({
  count: b.entries.length,
  live: b.entries.filter((e) => !e.deletedAt).length,
  revision: b.revision,
});
async function save() {
  const start = await c.evaluate("performance.now()");
  await click("保存");
  await c.wait('!document.querySelector("#entry-form")');
  await frames();
  result.timings.push({
    name: "save",
    ms: (await c.evaluate("performance.now()")) - start,
  });
}
try {
  // Replays require the review date (2026-11-06) for fixed report totals.
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await c.wait('!!document.querySelector(".app-shell,.start-flow")');
  await c.evaluate(
    `(async()=>{const book=await(await fetch('/__fixture.json')).json();const db=await new Promise(resolve=>{const r=indexedDB.open('fine-ledger-p0-review-v1');r.onsuccess=()=>resolve(r.result)});await new Promise(resolve=>{const tx=db.transaction(['state','outbox','revisions'],'readwrite');tx.objectStore('state').clear();tx.objectStore('state').put(book,'book');tx.objectStore('state').put(false,'sync-enabled');tx.objectStore('state').put(true,'category-icons-repaired-v1');tx.objectStore('outbox').clear();tx.objectStore('revisions').clear();tx.oncomplete=resolve});db.close()})()`,
  );
  let origin = await c.evaluate("performance.timeOrigin");
  await c.send("Page.reload", { ignoreCache: true });
  await c.wait(
    `performance.timeOrigin!==${origin}&&!!document.querySelector('.accounts-page')`,
  );
  const initial = await book();
  result.before = snap(initial);
  if (!(await c.evaluate('!!document.querySelector("#entry-form")'))) {
    await click("交易");
    await css('button[aria-label="记一笔"]');
  }
  await input("#entry-amount", "12.34");
  await input('input[placeholder="这笔交易是什么"]', "Chrome 回归支出");
  await click("选择类目");
  await click("餐食");
  await save();
  let b = await book(),
    expense = b.entries.find((e) => e.description === "Chrome 回归支出");
  assert.equal(expense.amountMinor, "1234");
  assert.equal(expense.accountId, "a0");
  assert.equal(expense.splits[0].categoryId, "food-0");
  assert.equal(b.entries.length, initial.entries.length + 1);
  result.checks.push("新增支出金额、账户、类目精确落库");
  await input('input[aria-label="搜索交易描述和备注"]', "Chrome 回归支出");
  assert.equal(
    await c.evaluate('document.querySelectorAll(".transaction-row").length'),
    1,
  );
  result.checks.push("搜索仅返回匹配交易");
  await css(".transaction-main");
  await click("退款");
  await input("#entry-amount", "2.34");
  await input('input[placeholder="这笔交易是什么"]', "Chrome 回归退款");
  await save();
  b = await book();
  const refund = b.entries.find((e) => e.description === "Chrome 回归退款");
  assert.equal(refund.amountMinor, "234");
  assert.equal(refund.originalId, expense.id);
  result.checks.push("退款保留原消费关系和金额");
  // Return through the header to transactions, then create split and transfer entries.
  await css('button[aria-label="返回"]');
  await input('input[aria-label="搜索交易描述和备注"]', "");
  await css('button[aria-label="记一笔"]');
  await input("#entry-amount", "10.00");
  await input('input[placeholder="这笔交易是什么"]', "Chrome 回归拆分");
  await click("拆分类目");
  await css(".category-choice");
  await click("餐食");
  await css(".split-row:nth-child(3) .category-choice");
  await click("咖啡茶饮");
  await save();
  b = await book();
  const split = b.entries.find((e) => e.description === "Chrome 回归拆分");
  assert.equal(split.splits.length, 2);
  assert.equal(
    split.splits.reduce((n, s) => n + BigInt(s.amountMinor), 0n),
    1000n,
  );
  result.checks.push("拆分类目合计保持精确");
  await css('button[aria-label="记一笔"]');
  await click("转账");
  await input("#entry-amount", "25.00");
  await input('input[placeholder="可按账户自动生成"]', "Chrome 回归转账");
  await input(".form-surface select:nth-of-type(1)", "a0");
  await c.evaluate(
    `(()=>{const e=[...document.querySelectorAll('.form-surface select')][1];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'a1');e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await frames();
  await save();
  b = await book();
  const transfer = b.entries.find((e) => e.description === "Chrome 回归转账");
  assert.equal(transfer.toAccountId, "a1");
  assert.equal(transfer.receivedMinor, "2500");
  result.checks.push("同币转账两端金额一致");
  await input('input[aria-label="搜索交易描述和备注"]', "Chrome 回归支出");
  await css(".posting-button");
  await c.wait(
    `document.querySelector('.posting-button')?.getAttribute('aria-label')===${JSON.stringify((expense.posted ? "标记已入账" : "标记未入账") + "：Chrome 回归支出")}`,
  );
  b = await book();
  assert.equal(
    b.entries.find((e) => e.id === expense.id).posted,
    !expense.posted,
  );
  result.checks.push("切换入账状态落库并刷新");
  await css(".transaction-main");
  await click("删除交易");
  await click("只删除这笔消费");
  await c.wait(
    '!!document.querySelector(".search-field, .transaction-list, .empty-state")',
  );
  b = await book();
  assert.ok(b.entries.find((e) => e.id === expense.id).deletedAt);
  assert.ok(!b.entries.find((e) => e.id === refund.id).deletedAt);
  result.checks.push("删除消费保留独立退款");
  await click("设置");
  await click("最近删除");
  await css(".transaction-main");
  await click("恢复交易");
  b = await book();
  assert.ok(!b.entries.find((e) => e.id === expense.id).deletedAt);
  result.checks.push("最近删除恢复原记录");
  await css('button[aria-label="返回"]');
  await click("账户");
  await c.wait('!!document.querySelector(".net-summary")');
  const browserNow = await c.evaluate("Date.now()");
  const total =
    b.accounts
      .filter((a) => a.netWorth)
      .reduce((sum, a) => sum + BigInt(a.openingMinor), 0n) +
    b.entries
      .filter(
        (e) =>
          e.posted && !e.deletedAt && Date.parse(e.occurredAt) <= browserNow,
      )
      .reduce(
        (sum, e) =>
          sum +
          (e.kind === "transfer"
            ? 0n
            : e.kind === "expense"
              ? -BigInt(e.amountMinor)
              : BigInt(e.amountMinor)),
        0n,
      );
  const amount = Number(total) / 100;
  const shown = await c.evaluate(
    'document.querySelector(".net-summary").innerText',
  );
  assert.ok(
    shown.includes(
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ),
    shown,
  );
  result.netWorth = { minor: String(total), shown };
  result.checks.push("总净值与独立整数金额计算一致");
  await click("报表");
  await click("支出分类");
  await c.wait(
    '!document.querySelector(".report-loading") && document.body.innerText.includes("分类明细")',
  );
  await frames();
  result.reportText = await c.evaluate("document.body.innerText");
  assert.ok(result.reportText.includes("593.32"));
  assert.ok(result.reportText.includes("595.66"));
  assert.ok(result.reportText.includes("2.34"));
  result.checks.push(
    "分类报表支出595.66、退款2.34、净支出593.32与固定合成数据一致",
  );
  await css('button[aria-label="返回"]');
  await click("交易");
  await input('input[aria-label="搜索交易描述和备注"]', "");
  const first = await c.evaluate(
    'document.querySelectorAll(".transaction-row").length',
  );
  await c.evaluate(
    `[...document.querySelectorAll('button')].find(e=>e.textContent.startsWith('加载更多')).click()`,
  );
  await frames();
  assert.ok(
    (await c.evaluate('document.querySelectorAll(".transaction-row").length')) >
      first,
  );
  result.checks.push("分页加载更多不丢失交易");
  await c.evaluate("navigator.serviceWorker.ready.then(()=>true)");
  if (!(await c.evaluate("!!navigator.serviceWorker.controller"))) {
    origin = await c.evaluate("performance.timeOrigin");
    await c.send("Page.reload");
    await c.wait(
      `performance.timeOrigin!==${origin}&&!!navigator.serviceWorker.controller&&!!document.querySelector('.app-shell')`,
    );
  }
  await c.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  origin = await c.evaluate("performance.timeOrigin");
  await c.send("Page.reload");
  await c.wait(
    `performance.timeOrigin!==${origin}&&!!document.querySelector('.app-shell')`,
  );
  b = await book();
  assert.equal(b.entries.length, initial.entries.length + 4);
  assert.ok(!b.entries.find((e) => e.id === expense.id).deletedAt);
  result.checks.push("断网刷新后账本及修改保留");
  await click("报表");
  await click("支出分类");
  await c.wait(
    '!document.querySelector(".report-loading") && document.body.innerText.includes("分类明细")',
  );
  await frames();
  assert.ok(
    !(await c.evaluate("document.body.innerText")).includes("无法启动报表"),
  );
  result.checks.push("离线报表 Worker 可用");
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    output + "/" + label + "-business.png",
    Buffer.from(shot.data, "base64"),
  );
  await c.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  result.after = snap(await book());
} catch (e) {
  result.error = e.stack;
  result.dom = await c.evaluate("document.body.innerText.slice(-3500)");
  throw e;
} finally {
  result.runtimeErrors = c.events.filter(
    (e) => e.method === "Runtime.exceptionThrown",
  );
  await writeFile(
    output + "/" + label + "-business.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  console.log("tab", c.id);
  c.close();
}
