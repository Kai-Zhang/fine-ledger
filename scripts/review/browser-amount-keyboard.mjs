import { connect } from "./cdp.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const port = Number(process.argv[2] || 4198);
const width = Number(process.env.REVIEW_WIDTH || 390);
const height = Number(process.env.REVIEW_HEIGHT || 844);
const touch = process.env.REVIEW_TOUCH === "1";
const ios = process.env.REVIEW_IOS === "1";
const theme = process.env.REVIEW_THEME || "light";
const descriptionField = 'input[placeholder="这笔交易是什么"]';
const output =
  process.env.REVIEW_OUTPUT || "/tmp/fine-ledger-amount-keyboard-review";
await mkdir(output, { recursive: true });
const c = await connect();
const frames = () =>
  c.evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
async function tap(selector, inset) {
  await c.evaluate(
    `(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) throw Error('missing ' + ${JSON.stringify(selector)});
      e.scrollIntoView({block:'center'});
    })()`,
  );
  await frames();
  const p = await c.evaluate(
    `(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) throw Error('missing ' + ${JSON.stringify(selector)});
      const r = e.getBoundingClientRect();
      const x = r.x + (${inset ?? "r.width/2"}), y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!e.contains(hit)) throw Error('tap target covered: ' + e.outerHTML.slice(0, 180) + ' at ' + x + ',' + y + ' by ' + hit?.outerHTML.slice(0, 180));
      return {x, y};
    })()`,
  );
  if (touch) {
    await c.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...p, radiusX: 1, radiusY: 1 }],
    });
    await c.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await c.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...p,
      button: "left",
      clickCount: 1,
    });
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...p,
      button: "left",
      clickCount: 1,
    });
  }
  await frames();
}
async function text(text) {
  const sel = await c.evaluate(
    `(()=>{const scope=[...document.querySelectorAll('dialog[open]')].at(-1)||document;const e=[...scope.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width);if(!e)throw Error('missing '+${JSON.stringify(text)});e.setAttribute('data-review-tap','yes');return '[data-review-tap=yes]'})()`,
  );
  await tap(sel);
  await c.evaluate(
    'document.querySelector("[data-review-tap=yes]")?.removeAttribute("data-review-tap")',
  );
}
async function expression(raw) {
  await tap('.amount-keyboard [aria-label="清空"]');
  for (const k of raw) await text(k);
}
async function assertKeypadCentered() {
  const layout = await c.evaluate(`(() => {
    const field = document.querySelector("[data-calculator-active]");
    const editor = field.closest("dialog, .workspace-region, .start-frame").getBoundingClientRect();
    const keypad = document.querySelector(".amount-keyboard").getBoundingClientRect();
    return { editorLeft:editor.left, editorRight:editor.right, left:keypad.left, right:keypad.right, width:keypad.width, height:keypad.height };
  })()`);
  assert.ok(
    Math.abs(
      layout.left + layout.right - layout.editorLeft - layout.editorRight,
    ) <= 1,
    JSON.stringify(layout),
  );
  assert.ok(
    layout.left >= layout.editorLeft - 1 &&
      layout.right <= layout.editorRight + 1,
  );
  assert.ok(layout.width <= 360);
  return layout;
}
async function assertKeypadFollowsVisualViewport() {
  const properties = ["scale", "width", "height", "offsetLeft", "offsetTop"];
  await c.evaluate(`(() => {
    const viewport = window.visualViewport;
    const scale = 1.2;
    const values = { scale, width: innerWidth / scale, height: innerHeight / scale, offsetLeft: 80, offsetTop: 20 };
    for (const [name, value] of Object.entries(values))
      Object.defineProperty(viewport, name, { configurable: true, value });
    viewport.dispatchEvent(new Event("resize"));
  })()`);
  try {
    for (const offset of [80, 115]) {
      await c.evaluate(`(() => {
        const viewport = window.visualViewport;
        Object.defineProperty(viewport, "offsetLeft", { configurable: true, value: ${offset} });
        viewport.dispatchEvent(new Event("scroll"));
      })()`);
      await frames();
      const layout = await c.evaluate(`(() => {
        const viewport = window.visualViewport;
        const pane = document.querySelector(".workspace-region").getBoundingClientRect();
        const keypad = document.querySelector(".amount-keyboard").getBoundingClientRect();
        const key = document.querySelector(".amount-keyboard-keys button").getBoundingClientRect();
        const center = (Math.max(pane.left, viewport.offsetLeft) + Math.min(pane.right, viewport.offsetLeft + viewport.width)) / 2;
        return { center, actualCenter: (keypad.left + keypad.right) / 2,
          bottom: viewport.offsetTop + viewport.height, actualBottom: keypad.bottom,
          displayedWidth: keypad.width * viewport.scale, displayedKeyHeight: key.height * viewport.scale };
      })()`);
      assert.ok(
        Math.abs(layout.actualCenter - layout.center) <= 1,
        JSON.stringify(layout),
      );
      assert.ok(
        Math.abs(layout.actualBottom - layout.bottom) <= 1,
        JSON.stringify(layout),
      );
      assert.ok(
        Math.abs(layout.displayedWidth - 360) <= 1,
        JSON.stringify(layout),
      );
      assert.ok(
        Math.abs(layout.displayedKeyHeight - 44) <= 1,
        JSON.stringify(layout),
      );
    }
  } finally {
    await c.evaluate(`(() => {
      const viewport = window.visualViewport;
      for (const name of ${JSON.stringify(properties)}) delete viewport[name];
      viewport.dispatchEvent(new Event("resize"));
    })()`);
    await frames();
  }
}
async function input(selector, value) {
  await c.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await frames();
}
async function pickDuringDescriptionBlur() {
  await c.evaluate(`(() => {
    const viewport = window.visualViewport;
    Object.defineProperty(viewport, "height", { configurable: true, value: innerHeight - 220 });
    viewport.dispatchEvent(new Event("resize"));
  })()`);
  await c.wait('!!document.querySelector(".description-accessory button")');
  const start = await c.evaluate(`(() => {
    const button = document.querySelector(".description-accessory button");
    const bounds = button.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`);
  await c.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await c.evaluate(`(() => {
    document.querySelector(${JSON.stringify(descriptionField)}).blur();
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  })()`);
  await frames();
  assert.equal(
    await c.evaluate(
      `document.elementFromPoint(${start.x}, ${start.y})?.closest(".description-accessory button")?.textContent`,
    ),
    "地铁通勤",
  );
  await c.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await frames();
}
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 760,
  });
  await c.send("Emulation.setTouchEmulationEnabled", { enabled: touch });
  await c.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: theme }],
  });
  if (ios)
    await c.send("Network.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });
  await c.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
  await c.wait('!!document.querySelector(".start-flow,.app-shell")');
  await c.evaluate(
    `(async()=>{const {exampleBook}=await import('/src/domain/example.ts');const {databases}=await import('/src/storage/repository.ts');const b=exampleBook();b.name='键盘回归测试';b.categories=[{id:'fruit',name:'水果',kind:'expense',icon:'Apple',color:'#608D9D',order:0,archived:false},{id:'snack',name:'零食',kind:'expense',icon:'Cookie',color:'#608D9D',order:1,archived:false},{id:'home',name:'日用品',kind:'expense',icon:'Package',color:'#608D9D',order:2,archived:false}];const at=new Date().toISOString();b.entries=[['超市购物','fruit'],['地铁通勤','snack']].map(([description,categoryId], i)=>({id:'keyboard-history-'+i,kind:'expense',accountId:'bank',amountMinor:'100',description,occurredAt:at,createdAt:at,updatedAt:at,posted:true,revision:1,splits:[{id:'keyboard-history-split-'+i,categoryId,amountMinor:'100'}]}));await databases.personal.state.put(b,'book');await databases.personal.state.put(false,'sync-enabled');})()`,
  );
  const previousOrigin = await c.evaluate("performance.timeOrigin");
  await c.send("Page.reload", { ignoreCache: true });
  await c.wait(
    `performance.timeOrigin !== ${previousOrigin} && !!document.querySelector('.accounts-page') && !document.querySelector('.boot-loading')`,
  );
  await frames();
  await tap('[aria-label="记一笔"]');
  await c.wait('!!document.querySelector("#entry-amount")');
  await frames();

  assert.equal(
    await c.evaluate(
      '!!document.querySelector(".amount-keyboard:popover-open")',
    ),
    true,
  );
  const initialLayout = await assertKeypadCentered();
  assert.ok(initialLayout.height <= 250);
  if (width > 760) {
    await assertKeypadFollowsVisualViewport();
    await assertKeypadCentered();
  }
  assert.equal(
    await c.evaluate(`[".amount-keyboard [data-calculator-key=undo] .lucide-undo-2",
      ".amount-keyboard [data-calculator-key=back] .lucide-delete"
    ].every(s => !!document.querySelector(s))`),
    true,
  );
  assert.equal(
    await c.evaluate('document.querySelector("#entry-amount").inputMode'),
    "none",
  );
  const suggestions = '.suggestions-inline[aria-label="描述候选"]';
  assert.ok(
    await c.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(suggestions)});
      const field = document.querySelector(${JSON.stringify(descriptionField)});
      return !!row?.previousElementSibling?.contains(field);
    })()`),
    "recent history must render below the description on entry",
  );
  assert.equal(
    await c.evaluate(
      `getComputedStyle(document.querySelector(${JSON.stringify(descriptionField)})).fontSize`,
    ),
    "16px",
    "the description must meet the iOS focus zoom threshold at every width",
  );
  const descriptionValue = `document.querySelector(${JSON.stringify(descriptionField)}).value`;
  const selectedCategory =
    'document.querySelector(".category-field .category-choice").textContent.trim()';
  await text("超市购物");
  assert.equal(await c.evaluate(descriptionValue), "超市购物");
  assert.equal(await c.evaluate(selectedCategory), "水果");
  await tap(descriptionField);
  await input(descriptionField, "地铁");
  if (touch) await pickDuringDescriptionBlur();
  else await text("地铁通勤");
  assert.equal(await c.evaluate(descriptionValue), "地铁通勤");
  assert.equal(await c.evaluate(selectedCategory), "零食");
  await c.wait('!!document.querySelector(".amount-keyboard:popover-open")');
  console.log(
    "PASS recent descriptions on entry and category completion across description blur",
  );
  await text("1");
  await tap('.amount-keyboard [aria-label="输入两个零"]');
  assert.equal(
    await c.evaluate('document.querySelector("#entry-amount").value'),
    "100.00",
  );
  if (width > 760) {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await frames();
    assert.equal(await c.evaluate("innerWidth"), 390);
    await assertKeypadCentered();
    assert.equal(
      await c.evaluate('document.querySelector("#entry-amount").value'),
      "100.00",
    );
    await c.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await frames();
    assert.equal(await c.evaluate("innerWidth"), width);
    await assertKeypadCentered();
  }
  await expression("100+");
  assert.equal(
    await c.evaluate(
      'document.querySelector(".amount-keyboard-expression").textContent.trim()',
    ),
    "100 +",
  );
  assert.equal(
    await c.evaluate('!!document.querySelector(".amount-keyboard-error")'),
    false,
  );
  await tap(".workspace[data-active] .page-header h1");
  assert.equal(
    await c.evaluate(
      '!!document.querySelector(".amount-keyboard:popover-open")',
    ),
    true,
  );
  assert.equal(
    await c.evaluate(
      'document.querySelector(".amount-keyboard-expression").textContent.trim()',
    ),
    "100 +",
  );
  if (ios && touch && width <= 760) {
    assert.equal(
      await c.evaluate(
        'document.activeElement === document.querySelector("#entry-amount")',
      ),
      false,
    );
    assert.ok(
      await c.evaluate(
        `Math.abs(document.querySelector('.workspace[data-active]').getBoundingClientRect().bottom - document.querySelector('.amount-keyboard').getBoundingClientRect().top) <= 1`,
      ),
    );
    await c.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 0, y: 153 }],
    });
    await c.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 142, y: 154 }],
    });
    await c.wait('!!document.querySelector(".edge-navigation-active")');
    assert.equal(
      await c.evaluate(
        'getComputedStyle(document.querySelector(".amount-keyboard")).visibility',
      ),
      "hidden",
    );
    await c.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await c.wait('!document.querySelector(".edge-navigation-active")');
    assert.equal(
      await c.evaluate(
        'document.querySelector(".amount-keyboard-expression").textContent.trim()',
      ),
      "100 +",
    );
  }
  if (ios && touch && width <= 760) {
    const keyY = await c.evaluate(`(() => {
      const key = document.querySelector('.amount-keyboard-keys button').getBoundingClientRect();
      return key.top + key.height / 2;
    })()`);
    await c.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 100, y: keyY }],
    });
    await c.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 205, y: keyY }],
    });
    await c.wait('!!document.querySelector(".edge-navigation-active")');
    await c.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await c.wait('!!document.querySelector(".confirmation-dialog[open]")');
    const themeColor = () =>
      c.evaluate(`document.querySelector('meta[name="theme-color"]').content`);
    assert.equal(await themeColor(), theme === "dark" ? "#090c0b" : "#b7bcb9");
    await text("继续填写");
    await c.wait('!document.querySelector("dialog[open]")');
    assert.equal(await themeColor(), theme === "dark" ? "#151b18" : "#f7f8f5");

    // Use the portion of the return button inside iOS's edge reservation.
    await tap("[data-page-back]", 6);
    await c.wait('!!document.querySelector(".confirmation-dialog[open]")');
    await text("继续填写");
    await c.wait('!document.querySelector("dialog[open]")');
    assert.equal(
      await c.evaluate(
        'document.querySelector(".amount-keyboard-expression").textContent.trim()',
      ),
      "100 +",
    );
    assert.equal(
      await c.evaluate(
        'getComputedStyle(document.querySelector(".amount-keyboard")).visibility',
      ),
      "visible",
    );
  }
  const incompleteShot = await c.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    output + `/incomplete-${width}-${theme}.png`,
    Buffer.from(incompleteShot.data, "base64"),
  );
  for (const digit of "68.6") await text(digit);
  assert.equal(
    await c.evaluate('document.querySelector("#entry-amount").value'),
    "168.60",
  );
  const keySizes = await c.evaluate(
    `[...document.querySelectorAll('.amount-keyboard button')].map(e=>({key:e.getAttribute('data-calculator-key'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,left:e.getBoundingClientRect().left}))`,
  );
  assert.equal(keySizes.length, 20);
  assert.equal(keySizes[0].key, "undo");
  assert.equal(keySizes[2].key, "back");
  assert.equal(keySizes[3].key, "÷");
  assert.ok(keySizes.every((k) => k.width >= 44 && k.height === 44));
  assert.equal(keySizes.at(-1).key, "=");
  assert.equal(keySizes.at(-1).left, keySizes[3].left);
  assert.equal(keySizes.at(-1).width, keySizes[3].width);
  assert.equal(
    await c.evaluate(
      `!!document.querySelector('.amount-keyboard-result,.amount-keyboard-heading,.amount-keyboard-tools')`,
    ),
    false,
  );
  await tap('.amount-keyboard [aria-label="退格"]');
  assert.equal(
    await c.evaluate('document.querySelector("#entry-amount").value'),
    "168.00",
  );
  await text("6");
  assert.equal(
    await c.evaluate('document.querySelector("#entry-amount").value'),
    "168.60",
  );
  const totalShot = await c.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    output + `/total-${width}-${theme}.png`,
    Buffer.from(totalShot.data, "base64"),
  );
  await tap(".workspace[data-active] .page-header h1");
  assert.equal(
    await c.evaluate(
      '!!document.querySelector(".amount-keyboard:popover-open")',
    ),
    false,
  );
  assert.equal(
    await c.evaluate('document.querySelector("#entry-amount").value'),
    "168.60",
  );
  await text("拆分类目");
  await text("添加类目");
  // Assign real categories and persist the calculated split amounts.
  for (const [index, name] of ["水果", "零食", "日用品"].entries()) {
    await c.evaluate(
      `document.querySelectorAll('.split-row .category-choice')[${index}].setAttribute('data-select-category','yes')`,
    );
    await tap("[data-select-category=yes]");
    await c.evaluate(
      `document.querySelector('[data-select-category=yes]')?.removeAttribute('data-select-category')`,
    );
    if (ios && touch && index === 0) {
      const start = await c.evaluate(
        `(() => {
          const row = document.querySelector('.picker-parent-row').getBoundingClientRect();
          return { x: row.left + Math.min(75, row.width / 3), y: row.top + 12 };
        })()`,
      );
      await c.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [start],
      });
      await c.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x + 105, y: start.y }],
      });
      await c.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 160));
      assert.equal(
        await c.evaluate(
          `!!document.querySelector('dialog[open] .category-accordion-picker')`,
        ),
        true,
      );
    }
    await text(name);
  }
  await tap('input[placeholder="这笔交易是什么"]');
  assert.equal(
    await c.evaluate(`!!document.querySelector('[aria-label="描述候选"]')`),
    true,
  );
  await input('input[placeholder="这笔交易是什么"]', "计算键盘回归");
  await tap('[aria-label="第 1 个类目金额"]');
  await tap('[aria-label="第 2 个类目金额"]');
  assert.equal(
    await c.evaluate(
      'document.querySelectorAll(".split-row input")[0].disabled',
    ),
    false,
  );
  await tap('[aria-label="第 1 个类目金额"]');
  await expression("12.8+8.9×2");
  assert.equal(
    await c.evaluate('document.querySelectorAll(".split-row input")[0].value'),
    "30.60",
  );
  await tap('[aria-label="第 2 个类目金额"]');
  assert.equal(
    await c.evaluate(
      'document.querySelectorAll(".split-row input")[0].disabled',
    ),
    true,
  );
  await expression("20+5");
  assert.equal(
    await c.evaluate('document.querySelectorAll(".split-row input")[0].value'),
    "30.60",
  );
  assert.equal(
    await c.evaluate('document.querySelectorAll(".split-row input")[2].value'),
    "113.00",
  );
  await tap('.amount-keyboard [aria-label="撤销本次输入"]');
  assert.equal(
    await c.evaluate('document.querySelectorAll(".split-row input")[1].value'),
    "69.00",
  );
  assert.equal(
    await c.evaluate('document.querySelectorAll(".split-row input")[2].value'),
    "69.00",
  );
  await tap('[aria-label="第 2 个类目金额"]');
  await expression("20+5");
  await tap('[aria-label="第 3 个类目金额"]');
  assert.equal(
    await c.evaluate(
      'document.querySelectorAll(".split-row input")[1].disabled',
    ),
    true,
  );
  assert.equal(
    await c.evaluate(
      'document.querySelector("[data-calculator-active]").getAttribute("aria-label")',
    ),
    "第 3 个类目金额",
  );
  const layout = await c.evaluate(
    `(()=>{const p=document.querySelector('.amount-keyboard').getBoundingClientRect();const a=document.querySelector("[data-calculator-active]").getBoundingClientRect();return {viewport:innerWidth,left:p.left,right:p.right,top:p.top,bottom:p.bottom,fieldBottom:a.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`,
  );
  assert.ok(
    layout.left >= 0 && layout.right <= layout.viewport && !layout.overflow,
  );
  assert.ok(
    layout.fieldBottom <= layout.top,
    "focused amount must remain above the keypad",
  );
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    output + `/split-${width}-${theme}.png`,
    Buffer.from(shot.data, "base64"),
  );
  await tap('[aria-label="锁定第 3 个类目金额"]');
  assert.equal(
    await c.evaluate('!!document.querySelector(".amount-keyboard")'),
    false,
  );
  console.log(
    "PASS total calculation, native keyboard suppression, split auto-lock, fixed values and remaining allocation",
  );

  await tap('[aria-label="解锁第 1 个类目金额"]');
  await tap('[aria-label="第 1 个类目金额"]');
  await expression("30.6");
  await tap('[aria-label="锁定第 1 个类目金额"]');
  assert.equal(
    await c.evaluate(
      'document.querySelectorAll(".split-row input")[0].disabled',
    ),
    true,
  );
  console.log(
    "PASS unchanged rows stay unlocked, explicit lock does not toggle twice",
  );
  await text("保存");
  await c.wait('!document.querySelector("#entry-form")');
  const entry = await c.evaluate(
    `(async()=>{const {databases}=await import('/src/storage/repository.ts');const b=await databases.personal.state.get('book');return b.entries.find(e=>e.description==='计算键盘回归')})()`,
  );
  assert.equal(entry.amountMinor, "16860");
  assert.deepEqual(
    entry.splits.map((s) => s.amountMinor),
    ["3060", "2500", "11300"],
  );
  console.log("PASS exact split amounts persisted");
  // Native modal dialog: negative balances, error recovery and cancellation.
  await tap('[aria-label="管理账户"]');
  await tap(".workspace[data-active] .account-main");
  await tap("dialog[open] input[data-amount-input]");
  assert.equal(
    await c.evaluate(
      '!!document.querySelector("dialog[open] .amount-keyboard:popover-open")',
    ),
    true,
  );
  await assertKeypadCentered();
  await expression("0−12.5");
  assert.equal(
    await c.evaluate(
      'document.querySelector("dialog[open] input[data-amount-input]").value',
    ),
    "-12.50",
  );
  await tap('.amount-keyboard [aria-label="切换正负号"]');
  assert.equal(
    await c.evaluate(
      'document.querySelector("dialog[open] input[data-amount-input]").value',
    ),
    "12.50",
  );
  await expression("1÷0");
  await tap("dialog[open] .dialog-head h2");
  assert.equal(
    await c.evaluate(
      'document.querySelector(".amount-keyboard-error").textContent',
    ),
    "除数不能为 0",
  );
  await tap('.amount-keyboard [aria-label="撤销本次输入"]');
  assert.equal(
    await c.evaluate(
      'document.querySelector("dialog[open] input[data-amount-input]").value',
    ),
    "48620.00",
  );
  await tap("dialog[open] input[data-amount-input]");
  await expression("0−12.5");
  await text("保存账户");
  await c.wait('!document.querySelector("dialog[open]")');
  assert.equal(
    await c.evaluate(
      `(async()=>{const {databases}=await import('/src/storage/repository.ts');return (await databases.personal.state.get('book')).accounts[0].openingMinor})()`,
    ),
    "-1250",
  );
  console.log(
    "PASS modal keyboard, sign, division-by-zero guard, cancellation, negative balance saved",
  );
  if (await c.evaluate('!!document.querySelector(".toast")'))
    await tap(".toast");
  await tap('[aria-label="完成账户管理"]');
  // Foreign-currency settlement auto-focuses an amount inside a native dialog.
  await c.evaluate(
    `(async()=>{const {databases}=await import('/src/storage/repository.ts');const b=await databases.personal.state.get('book');const t=new Date().toISOString();b.entries.push({id:'keyboard-pending',kind:'expense',accountId:'bank',amountMinor:'1000',amountCurrency:'USD',description:'外币键盘测试',occurredAt:t,createdAt:t,updatedAt:t,posted:false,revision:1,splits:[{id:'keyboard-pending-split',categoryId:'fruit',amountMinor:'1000'}]});await databases.personal.state.put(b,'book');})()`,
  );
  await text("交易");
  await c.evaluate(
    `const e=[...document.querySelectorAll('.transaction-main')].find(e=>e.textContent.includes('外币键盘测试'));e.setAttribute('data-pending-review','yes');`,
  );
  await tap("[data-pending-review=yes]");
  await text("确认入账");
  await c.wait(
    '!!document.querySelector("dialog[open] .amount-keyboard:popover-open")',
  );
  await expression("70+2.5");
  await text("=");
  assert.equal(
    await c.evaluate(
      '!!document.querySelector(".amount-keyboard:popover-open")',
    ),
    true,
  );
  await text("确认入账");
  await c.wait('!document.querySelector("dialog[open]")');
  const posted = await c.evaluate(
    `(async()=>{const {databases}=await import('/src/storage/repository.ts');return (await databases.personal.state.get('book')).entries.find(e=>e.id==='keyboard-pending')})()`,
  );
  assert.equal(posted.amountMinor, "7250");
  assert.equal(posted.posted, true);
  assert.deepEqual(posted.originalAmount, {
    currency: "USD",
    amountMinor: "1000",
  });
  console.log(
    "PASS autofocus modal keyboard, foreign amount and exact settlement persistence",
  );
  assert.deepEqual(
    c.events.filter((e) => e.method === "Runtime.exceptionThrown"),
    [],
  );
} catch (error) {
  console.log("FAIL", (error.stack || error.message).slice(0, 1000));
  console.log("UI", await c.evaluate("document.body.innerText.slice(-2200)"));
  process.exitCode = 1;
} finally {
  c.close();
}
