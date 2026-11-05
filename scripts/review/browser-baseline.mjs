import { connect } from "./cdp.mjs";
import { writeFile, mkdir } from "node:fs/promises";
const output = process.env.REVIEW_OUTPUT || "/tmp/fine-ledger-browser-review";
await mkdir(output, { recursive: true });
const port = Number(process.argv[2] || 4195),
  label = process.argv[3] || "baseline";
for (const target of await (
  await fetch("http://127.0.0.1:9337/json/list")
).json())
  if (target.type === "page")
    await fetch("http://127.0.0.1:9337/json/close/" + target.id);
const c = await connect("http://127.0.0.1:" + port + "/");
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await c.wait('!!document.querySelector(".start-flow, .app-shell")');
  await c.evaluate(
    `(async()=>{const book=await(await fetch('/__fixture.json')).json();const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fine-ledger-p0-review-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction(['state','outbox','revisions'],'readwrite');tx.objectStore('state').clear();tx.objectStore('state').put(book,'book');tx.objectStore('state').put(false,'sync-enabled');tx.objectStore('state').put(true,'category-icons-repaired-v1');tx.objectStore('outbox').clear();tx.objectStore('revisions').clear();tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close()})()`,
  );
  const previousOrigin = await c.evaluate("performance.timeOrigin");
  await c.send("Page.reload", { ignoreCache: true });
  await c.wait(
    `performance.timeOrigin !== ${previousOrigin} && !!document.querySelector('.app-shell') && document.readyState === 'complete'`,
  );
  console.log(await c.evaluate("document.body.innerText.slice(0,2500)"));
  await c.evaluate(
    `window.reviewLongTasks=[];new PerformanceObserver(list=>window.reviewLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:false})`,
  );
  const click = async (text) => {
    await c.evaluate(
      `(()=>{const buttons=[...document.querySelectorAll('button')];const b=buttons.find(x=>x.textContent.trim()===${JSON.stringify(text)}&&x.getBoundingClientRect().width>0);if(!b)throw Error('missing button '+${JSON.stringify(text)});performance.mark('review-start');b.click()})()`,
    );
  };
  const samples = [];
  for (let round = 0; round < 3; round++) {
    for (const [text, selector] of [
      ["交易", ".transaction-list"],
      ["账户", ".accounts-page"],
      ["报表", ".report-catalog"],
    ]) {
      const before = await c.evaluate("performance.now()");
      await click(text);
      await c.wait(
        text === "交易"
          ? '!!document.querySelector(".transaction-list")'
          : text === "账户"
            ? 'document.querySelector(".workspace[data-active] h1")?.textContent.includes("账户")'
            : 'document.querySelector(".workspace[data-active] h1")?.textContent.includes("报表")',
      );
      const time = await c.evaluate(
        `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now()-performance.getEntriesByName('review-start').at(-1).startTime))))`,
      );
      const tasks = await c.evaluate(
        `window.reviewLongTasks.filter(e=>e.start>=${before})`,
      );
      samples.push({ round, text, ms: time, longTasks: tasks });
    }
  }
  const report = {
    label,
    port,
    chrome: await c.send("Browser.getVersion"),
    cpuThrottle: 4,
    rows: 20000,
    samples,
  };
  await writeFile(
    output + "/" + label + "-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    output + "/" + label + ".png",
    Buffer.from(shot.data, "base64"),
  );
  console.log("tab", c.id);
} finally {
  c.close();
}
