const { test } = require("node:test");
const assert = require("node:assert");
const KO = require("../lib.js");

const SIZES = [
  { id: "1L", label: "1 L", price: 8, deposit: 0 },
  { id: "270ml", label: "270 ml", price: 4.5, deposit: 1 },
];

const DELIVS = [
  { customerId: "A", date: "2026-06-03",
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 2 }], empties: [] },
  { customerId: "A", date: "2026-06-10",
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 2 },
            { sizeId: "270ml", flavourId: "lem", quantity: 10 }], empties: [] },
  { customerId: "B", date: "2026-06-15",
    items: [{ sizeId: "270ml", flavourId: "gin", quantity: 4 }], empties: [] },
  { customerId: "A", date: "2026-07-01",
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 1 }], empties: [] },
];

const CUSTS = [
  { id: "A", name: "Alice", type: "restaurant" },
  { id: "B", name: "Bob", type: "private" },
];

test("formatMoney formats to two decimals", () => {
  assert.strictEqual(KO.formatMoney(16), "16.00");
  assert.strictEqual(KO.formatMoney(4.5), "4.50");
  assert.strictEqual(KO.formatMoney(0), "0.00");
  assert.strictEqual(KO.formatMoney(86), "86.00");
});

test("sizeById finds a size or returns undefined", () => {
  assert.strictEqual(KO.sizeById(SIZES, "1L").price, 8);
  assert.strictEqual(KO.sizeById(SIZES, "nope"), undefined);
});

test("deliveryRevenue sums qty x price", () => {
  const d = {
    items: [
      { sizeId: "1L", flavourId: "f1", quantity: 2 },
      { sizeId: "270ml", flavourId: "f2", quantity: 10 },
    ],
    empties: [],
  };
  assert.strictEqual(KO.deliveryRevenue(d, SIZES), 61); // 2*8 + 10*4.5
});

test("deliveryDepositRefund sums qty x deposit", () => {
  const d = { items: [], empties: [{ sizeId: "270ml", quantity: 7 }, { sizeId: "1L", quantity: 3 }] };
  assert.strictEqual(KO.deliveryDepositRefund(d, SIZES), 7); // 7*1 + 3*0
});

test("monthKey / inMonth / dayOfMonth", () => {
  assert.strictEqual(KO.monthKey("2026-06-03"), "2026-06");
  assert.strictEqual(KO.inMonth("2026-06-03", "2026-06"), true);
  assert.strictEqual(KO.inMonth("2026-07-01", "2026-06"), false);
  assert.strictEqual(KO.dayOfMonth("2026-06-03"), 3);
});

test("monthName is English", () => {
  assert.strictEqual(KO.monthName("2026-06"), "June");
  assert.strictEqual(KO.monthName("2026-01"), "January");
});

test("recentMonthKeys returns n keys oldest-first ending at endMk", () => {
  assert.deepStrictEqual(KO.recentMonthKeys("2026-02", 4), [
    "2025-11", "2025-12", "2026-01", "2026-02",
  ]);
});

test("monthlyRevenue sums only the month", () => {
  assert.strictEqual(KO.monthlyRevenue(DELIVS, SIZES, "2026-06"), 16 + 61 + 18);
});

test("revenueByCustomer sorted desc", () => {
  assert.deepStrictEqual(KO.revenueByCustomer(DELIVS, SIZES, "2026-06"), [
    { customerId: "A", amount: 77 },
    { customerId: "B", amount: 18 },
  ]);
});

test("monthlyRevenueSeries follows the key order", () => {
  assert.deepStrictEqual(
    KO.monthlyRevenueSeries(DELIVS, SIZES, ["2026-05", "2026-06", "2026-07"]),
    [{ monthKey: "2026-05", amount: 0 },
     { monthKey: "2026-06", amount: 95 },
     { monthKey: "2026-07", amount: 8 }]
  );
});

test("flavourCounts sorted desc", () => {
  assert.deepStrictEqual(KO.flavourCounts(DELIVS, "2026-06"), [
    { flavourId: "lem", quantity: 10 },
    { flavourId: "gin", quantity: 8 },
  ]);
});

test("outstandingByCustomer nets delivered minus returned per size", () => {
  const ds = [
    { customerId: "A", date: "2026-06-03",
      items: [{ sizeId: "270ml", flavourId: "x", quantity: 10 },
              { sizeId: "1L", flavourId: "y", quantity: 2 }],
      empties: [{ sizeId: "270ml", quantity: 7 }] },
    { customerId: "A", date: "2026-06-10",
      items: [], empties: [{ sizeId: "1L", quantity: 2 }] },
  ];
  assert.deepStrictEqual(KO.outstandingByCustomer(ds, SIZES), [
    { customerId: "A", perSize: { "270ml": 3 }, depositHeld: 3 },
  ]); // 270ml: 10-7=3 (deposit 3); 1L: 2-2=0 omitted
});

test("generateRecibo matches the June example exactly", () => {
  const ds = [
    { customerId: "C", date: "2026-06-03",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 }],
      empties: [{ sizeId: "270ml", quantity: 7 }] },
    { customerId: "C", date: "2026-06-10",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 },
              { sizeId: "270ml", flavourId: "b", quantity: 10 }],
      empties: [] },
    { customerId: "C", date: "2026-06-24",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 }], empties: [] },
    { customerId: "OTHER", date: "2026-06-05",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 99 }], empties: [] },
  ];
  const expected = [
    "OUT - Kombucha Produto",
    "",
    "June 3:  2x 1L = 16.00",
    "June 10: 2x 1L + 10x 270ml = 61.00",
    "June 24: 2x 1L = 16.00",
    "Return June 3: 7x 270ml = -7.00",
    "----------------------------------",
    "Total: 86.00 Euro",
  ].join("\n");
  assert.strictEqual(
    KO.generateRecibo(ds, "C", "2026-06", SIZES, "OUT - Kombucha Produto"),
    expected
  );
});

test("generateRecibo with no deliveries", () => {
  assert.strictEqual(
    KO.generateRecibo([], "C", "2026-06", SIZES, "OUT - Kombucha Produto"),
    "OUT - Kombucha Produto\n\nTotal: 0.00 Euro"
  );
});

test("barChartSVG renders one rect per datum", () => {
  const svg = KO.barChartSVG([{ label: "Jun", value: 10 }, { label: "Jul", value: 5 }]);
  assert.ok(svg.startsWith("<svg"));
  assert.strictEqual((svg.match(/<rect/g) || []).length, 2);
  assert.ok(svg.includes("Jun"));
  assert.ok(svg.includes("Jul"));
});

test("barChartSVG handles empty data", () => {
  const svg = KO.barChartSVG([]);
  assert.ok(svg.startsWith("<svg"));
  assert.strictEqual((svg.match(/<rect/g) || []).length, 0);
});

test("barChartSVG adds a hover <title> and tappable data-tip per bar", () => {
  const svg = KO.barChartSVG([{ label: "A", value: 5 }]);
  assert.ok(svg.includes("<title>A: 5</title>"));
  assert.ok(svg.includes('data-tip="A: 5"'));
});

test("barChartSVG title uses opts.format and an optional full title", () => {
  const svg = KO.barChartSVG(
    [{ label: "Pal", title: "Palm Spot", value: 64 }],
    { format: (v) => "€" + v.toFixed(2) }
  );
  assert.ok(svg.includes("<title>Palm Spot: €64.00</title>"));
  assert.ok(svg.includes(">Pal</text>")); // axis label stays short
});

test("barChartSVG rotate option rotates x labels 90deg clockwise", () => {
  const plain = KO.barChartSVG([{ label: "A", value: 5 }]);
  assert.doesNotMatch(plain, /rotate\(90/); // default: no rotation
  const svg = KO.barChartSVG([{ label: "Sun Spot Cafe", value: 5 }], { rotate: true });
  assert.match(svg, /transform="rotate\(90 /);       // labels rotated clockwise
  assert.match(svg, /text-anchor="start"/);          // hang downward from the axis
  assert.ok(svg.includes(">Sun Spot Cafe</text>"));  // label text preserved (caller truncates)
});

test("revenueByCustomerType groups by customer type, default restaurant", () => {
  const customers = [
    { id: "A", name: "Palm Spot", type: "restaurant" },
    { id: "B", name: "Nina", type: "private" },
  ];
  assert.deepStrictEqual(
    KO.revenueByCustomerType(DELIVS, SIZES, customers, "2026-06"),
    [{ type: "restaurant", amount: 77 }, { type: "private", amount: 18 }]
  );
});

test("revenueByCustomerType defaults missing/unknown type to restaurant", () => {
  const customers = [{ id: "A", name: "Palm Spot" }]; // no type; B not listed at all
  assert.deepStrictEqual(
    KO.revenueByCustomerType(DELIVS, SIZES, customers, "2026-06"),
    [{ type: "restaurant", amount: 95 }]
  );
});

test("generateRecibo includes a NIF line under the header when provided", () => {
  const ds = [
    { customerId: "C", date: "2026-06-10",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 }], empties: [] },
  ];
  const out = KO.generateRecibo(ds, "C", "2026-06", SIZES, "OUT - Kombucha Produto", "511073712");
  assert.ok(out.startsWith("OUT - Kombucha Produto\nNIF: 511073712\n\n"));
  assert.ok(out.endsWith("Total: 16.00 Euro"));
});

test("generateRecibo omits the NIF line when nif is empty/missing", () => {
  const ds = [
    { customerId: "C", date: "2026-06-10",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 }], empties: [] },
  ];
  const noArg = KO.generateRecibo(ds, "C", "2026-06", SIZES, "OUT - Kombucha Produto");
  const emptyArg = KO.generateRecibo(ds, "C", "2026-06", SIZES, "OUT - Kombucha Produto", "  ");
  assert.ok(!noArg.includes("NIF:"));
  assert.ok(!emptyArg.includes("NIF:"));
  assert.ok(noArg.startsWith("OUT - Kombucha Produto\n\n"));
});

test("orderItemsSummary joins items with size label and flavour name", () => {
  const order = { items: [
    { sizeId: "1L", flavourId: "gin", quantity: 8 },
    { sizeId: "270ml", flavourId: "hib", quantity: 6 },
  ] };
  const names = { gin: "Ginger", hib: "Hibiscus" };
  const out = KO.orderItemsSummary(order, SIZES, (id) => names[id] || id);
  assert.strictEqual(out, "8x 1 L Ginger, 6x 270 ml Hibiscus");
});

test("orderItemsSummary falls back to raw ids when size/flavour unknown", () => {
  const order = { items: [{ sizeId: "500ml", flavourId: "xyz", quantity: 2 }] };
  assert.strictEqual(KO.orderItemsSummary(order, SIZES), "2x 500ml xyz");
});

test("orderItemsSummary returns empty string for no items", () => {
  assert.strictEqual(KO.orderItemsSummary({}, SIZES), "");
  assert.strictEqual(KO.orderItemsSummary({ items: [] }, SIZES), "");
});

test("orderStatusLabel maps statuses", () => {
  assert.strictEqual(KO.orderStatusLabel("requested"), "⏳ Requested");
  assert.strictEqual(KO.orderStatusLabel("delivered"), "✅ Delivered");
  assert.strictEqual(KO.orderStatusLabel("cancelled"), "✖ Cancelled");
  assert.strictEqual(KO.orderStatusLabel("weird"), "⏳ Requested");
});

test("monthKeysBetween is inclusive and ascending, across year boundary", () => {
  assert.deepStrictEqual(KO.monthKeysBetween("2026-01", "2026-03"), ["2026-01", "2026-02", "2026-03"]);
  assert.deepStrictEqual(KO.monthKeysBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepStrictEqual(KO.monthKeysBetween("2026-05", "2026-05"), ["2026-05"]);
});

test("monthKeysBetween returns [endMk] when start is after end", () => {
  assert.deepStrictEqual(KO.monthKeysBetween("2026-08", "2026-03"), ["2026-03"]);
});

test("inWindow includes the range endpoints", () => {
  assert.strictEqual(KO.inWindow("2026-06-15", "2026-06", "2026-07"), true);
  assert.strictEqual(KO.inWindow("2026-07-01", "2026-06", "2026-07"), true);
  assert.strictEqual(KO.inWindow("2025-05-31", "2026-06", "2026-07"), false);
  assert.strictEqual(KO.inWindow("2026-08-01", "2026-06", "2026-07"), false);
});

test("revenueInWindow sums deliveries across the window", () => {
  // DELIVS: A 2026-06-03 (2x1L=16), A 2026-06-10 (2x1L+10x270ml=16+45=61),
  //         B 2026-06-15 (4x270ml=18), A 2026-07-01 (1x1L=8)
  assert.strictEqual(KO.revenueInWindow(DELIVS, SIZES, "2026-06", "2026-06"), 95);
  assert.strictEqual(KO.revenueInWindow(DELIVS, SIZES, "2026-06", "2026-07"), 103);
  assert.strictEqual(KO.revenueInWindow(DELIVS, SIZES, "2026-08", "2026-09"), 0);
});

test("revenueByCustomerInWindow groups and sorts desc", () => {
  const out = KO.revenueByCustomerInWindow(DELIVS, SIZES, "2026-06", "2026-07");
  // A: 16+61+8=85, B: 18
  assert.deepStrictEqual(out, [{ customerId: "A", amount: 85 }, { customerId: "B", amount: 18 }]);
});

test("flavourCountsInWindow counts quantities in the window, sorted desc", () => {
  const out = KO.flavourCountsInWindow(DELIVS, "2026-06", "2026-06");
  // June items: gin 2 + gin 2 + lem 10 + gin 4 => gin 8? A6/3 gin2, A6/10 gin2+lem10, B6/15 gin4
  const gin = out.find((x) => x.flavourId === "gin");
  const lem = out.find((x) => x.flavourId === "lem");
  assert.strictEqual(gin.quantity, 8);
  assert.strictEqual(lem.quantity, 10);
  assert.strictEqual(out[0].quantity >= out[out.length - 1].quantity, true);
});

test("windowLabel formats single month, same-year range, and cross-year range", () => {
  assert.strictEqual(KO.windowLabel("2026-07", "2026-07"), "Jul 2026");
  assert.strictEqual(KO.windowLabel("2026-01", "2026-07"), "Jan–Jul 2026");
  assert.strictEqual(KO.windowLabel("2025-11", "2026-02"), "Nov 2025–Feb 2026");
});

test("revenueByTypeInWindow splits private vs restaurant", () => {
  // Window 2026-06..2026-07: A(restaurant)=16+61+8=85, B(private)=18
  const out = KO.revenueByTypeInWindow(DELIVS, SIZES, CUSTS, "2026-06", "2026-07");
  assert.deepStrictEqual(out, { private: 18, restaurant: 85, total: 103 });
});

test("revenueByTypeInWindow treats unknown/missing type as restaurant", () => {
  const custs = [{ id: "A", name: "Alice" }]; // no type => restaurant; B absent => restaurant
  const out = KO.revenueByTypeInWindow(DELIVS, SIZES, custs, "2026-06", "2026-07");
  assert.deepStrictEqual(out, { private: 0, restaurant: 103, total: 103 });
});

test("revenueTypeSeries returns one entry per month key, in order", () => {
  const out = KO.revenueTypeSeries(DELIVS, SIZES, CUSTS, ["2026-06", "2026-07"]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { monthKey: "2026-06", private: 18, restaurant: 77, total: 95 });
  assert.deepStrictEqual(out[1], { monthKey: "2026-07", private: 0, restaurant: 8, total: 8 });
});

test("revenueTypeByYear aggregates per year ascending", () => {
  const out = KO.revenueTypeByYear(DELIVS, SIZES, CUSTS);
  assert.deepStrictEqual(out, [{ year: "2026", private: 18, restaurant: 85, total: 103 }]);
});

test("stackedBarChartSVG renders an svg with a rect per segment and the tip", () => {
  const bars = [
    { label: "Jun", tip: "Jun 2026 — Total €95", segments: [
      { value: 18, color: "#3d6b8c" }, { value: 77, color: "#4a7c59" }] },
    { label: "Jul", tip: "Jul 2026 — Total €8", segments: [
      { value: 0, color: "#3d6b8c" }, { value: 8, color: "#4a7c59" }] },
  ];
  const svg = KO.stackedBarChartSVG(bars, { width: 320, height: 160 });
  assert.match(svg, /^<svg /);
  assert.strictEqual((svg.match(/<rect/g) || []).length, 4); // 2 bars x 2 segments
  assert.match(svg, /data-tip="Jun 2026 — Total €95"/);
  assert.match(svg, /fill="#4a7c59"/);
  assert.match(svg, /fill="#3d6b8c"/);
  assert.match(svg, />Jun</);
});

test("stackedBarChartSVG escapes the tip text", () => {
  const svg = KO.stackedBarChartSVG(
    [{ label: "X", tip: "a & b <c>", segments: [{ value: 1, color: "#000" }] }], {});
  assert.match(svg, /data-tip="a &amp; b &lt;c&gt;"/);
  assert.doesNotMatch(svg, /data-tip="a & b <c>"/);
});

test("stackedBarChartSVG tolerates empty data", () => {
  const svg = KO.stackedBarChartSVG([], {});
  assert.match(svg, /^<svg /);
  assert.strictEqual((svg.match(/<rect/g) || []).length, 0);
});

test("resolveWindow this-month (and unknown preset) returns current month", () => {
  assert.deepStrictEqual(KO.resolveWindow("this-month", null, null, "2026-07"), { startMk: "2026-07", endMk: "2026-07" });
  assert.deepStrictEqual(KO.resolveWindow("bogus", null, null, "2026-07"), { startMk: "2026-07", endMk: "2026-07" });
});

test("resolveWindow last-month crosses the January boundary", () => {
  assert.deepStrictEqual(KO.resolveWindow("last-month", null, null, "2026-01"), { startMk: "2025-12", endMk: "2025-12" });
  assert.deepStrictEqual(KO.resolveWindow("last-month", null, null, "2026-07"), { startMk: "2026-06", endMk: "2026-06" });
});

test("resolveWindow this-year is year-to-date (start===end in January)", () => {
  assert.deepStrictEqual(KO.resolveWindow("this-year", null, null, "2026-07"), { startMk: "2026-01", endMk: "2026-07" });
  assert.deepStrictEqual(KO.resolveWindow("this-year", null, null, "2026-01"), { startMk: "2026-01", endMk: "2026-01" });
});

test("resolveWindow custom uses the pickers and collapses an inverted range", () => {
  assert.deepStrictEqual(KO.resolveWindow("custom", "2026-03", "2026-05", "2026-07"), { startMk: "2026-03", endMk: "2026-05" });
  assert.deepStrictEqual(KO.resolveWindow("custom", "2026-08", "2026-03", "2026-07"), { startMk: "2026-03", endMk: "2026-03" });
  assert.deepStrictEqual(KO.resolveWindow("custom", null, null, "2026-07"), { startMk: "2026-07", endMk: "2026-07" });
});

test("reciboDocId builds a deterministic customer_month id", () => {
  assert.strictEqual(KO.reciboDocId("abc123", "2026-07"), "abc123_2026-07");
  assert.strictEqual(KO.reciboDocId("x", "2025-12"), "x_2025-12");
});

test("orderEmailParams assembles template fields", () => {
  const order = { items: [{ sizeId: "1L", flavourId: "gin", quantity: 8 }], preferredDate: "2026-07-20", note: "before noon" };
  const p = KO.orderEmailParams(order, "Sun Spot", SIZES, (id) => ({ gin: "Ginger" }[id] || id), "Jul 17, 2026");
  assert.strictEqual(p.restaurant_name, "Sun Spot");
  assert.strictEqual(p.items, "8x 1 L Ginger");
  assert.strictEqual(p.preferred_date, "2026-07-20");
  assert.strictEqual(p.note, "before noon");
  assert.strictEqual(p.placed_at, "Jul 17, 2026");
});

test("orderEmailParams uses — for empty date/note and tolerates no placedAt", () => {
  const p = KO.orderEmailParams({ items: [] }, "X", SIZES);
  assert.strictEqual(p.preferred_date, "—");
  assert.strictEqual(p.note, "—");
  assert.strictEqual(p.items, "");
  assert.strictEqual(p.placed_at, "");
});

const BATCHES = [
  { number: 1, step4: { bottles1L: 60, date: "2026-06-14" },
    conversions: [ { count270: 4, used1L: 2, date: "2026-06-18" } ] },
  { number: 2, step4: { bottles1L: 40, date: "2026-07-02" },
    conversions: [ { count270: 8, used1L: 3, date: "2026-07-10" },
                   { count270: 4, used1L: 2, date: "2026-06-20" } ] },
];

test("nextBatchNumber handles empty, sequence, and gaps", () => {
  assert.strictEqual(KO.nextBatchNumber([]), 1);
  assert.strictEqual(KO.nextBatchNumber(BATCHES), 3);
  assert.strictEqual(KO.nextBatchNumber([{ number: 5 }, { number: 2 }]), 6);
});

test("formatBatchNumber zero-pads to 3 and never truncates", () => {
  assert.strictEqual(KO.formatBatchNumber(1), "Batch 001");
  assert.strictEqual(KO.formatBatchNumber(23), "Batch 023");
  assert.strictEqual(KO.formatBatchNumber(1000), "Batch 1000");
});

test("bottles1LForConversion is ceil of count*0.27", () => {
  assert.strictEqual(KO.bottles1LForConversion(0), 0);
  assert.strictEqual(KO.bottles1LForConversion(1), 1);
  assert.strictEqual(KO.bottles1LForConversion(4), 2);
  assert.strictEqual(KO.bottles1LForConversion(8), 3);
  assert.strictEqual(KO.bottles1LForConversion(10), 3);
});

test("sizeLiters parses labels and honors an explicit liters field", () => {
  assert.strictEqual(KO.sizeLiters({ label: "1 L" }), 1);
  assert.strictEqual(KO.sizeLiters({ label: "1L" }), 1);
  assert.strictEqual(KO.sizeLiters({ label: "1.5 L" }), 1.5);
  assert.ok(Math.abs(KO.sizeLiters({ label: "270 ml" }) - 0.27) < 1e-9);
  assert.ok(Math.abs(KO.sizeLiters({ label: "500 ml" }) - 0.5) < 1e-9);
  assert.strictEqual(KO.sizeLiters({ label: "weird", liters: 0.33 }), 0.33);
  assert.strictEqual(KO.sizeLiters({ label: "nope" }), 0);
});

test("soldLitersInWindow sums delivered volume across sizes", () => {
  // June: 2x1L(2) + (2x1L+10x270ml)(2+2.7) + 4x270ml(1.08) = 7.78
  assert.ok(Math.abs(KO.soldLitersInWindow(DELIVS, SIZES, "2026-06", "2026-06") - 7.78) < 1e-9);
  assert.ok(Math.abs(KO.soldLitersInWindow(DELIVS, SIZES, "2026-07", "2026-07") - 1) < 1e-9);
});

test("productionSummary windows bottling by step4.date and conversions by their date", () => {
  assert.deepStrictEqual(KO.productionSummary(BATCHES, "2026-06", "2026-06"),
    { bottled1L: 60, made270: 8, used1L: 4 });
  assert.deepStrictEqual(KO.productionSummary(BATCHES, "2026-07", "2026-07"),
    { bottled1L: 40, made270: 8, used1L: 3 });
  assert.deepStrictEqual(KO.productionSummary([], "2026-06", "2026-06"),
    { bottled1L: 0, made270: 0, used1L: 0 });
});

test("t returns the language string, falling back to English then the key", () => {
  assert.strictEqual(KO.t("en", "send_order"), "Send order");
  assert.strictEqual(KO.t("pt", "send_order"), "Enviar pedido");
  assert.strictEqual(KO.t("de", "send_order"), "Send order");   // unknown lang -> en
  assert.strictEqual(KO.t(undefined, "your_orders"), "Your orders");
  assert.strictEqual(KO.t("pt", "no_such_key"), "no_such_key"); // unknown key -> key
});

test("orderStatusLabel keeps English by default and translates with lang", () => {
  assert.strictEqual(KO.orderStatusLabel("requested"), "⏳ Requested");
  assert.strictEqual(KO.orderStatusLabel("delivered"), "✅ Delivered");
  assert.strictEqual(KO.orderStatusLabel("cancelled"), "✖ Cancelled");
  assert.strictEqual(KO.orderStatusLabel("requested", "pt"), "⏳ Solicitado");
  assert.strictEqual(KO.orderStatusLabel("delivered", "pt"), "✅ Entregue");
  assert.strictEqual(KO.orderStatusLabel("cancelled", "pt"), "✖ Cancelado");
});

test("monthName and windowLabel support Portuguese, English by default", () => {
  assert.strictEqual(KO.monthName("2026-07"), "July");
  assert.strictEqual(KO.monthName("2026-07", "pt"), "Julho");
  assert.strictEqual(KO.monthName("2026-03", "pt"), "Março");
  assert.strictEqual(KO.windowLabel("2026-07", "2026-07"), "Jul 2026");
  assert.strictEqual(KO.windowLabel("2026-03", "2026-03", "pt"), "Mar 2026");
});

const ORDERS = [
  { customerUid: "U1", status: "cancelled", createdAt: { seconds: 300 },
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 9 }] },
  { customerUid: "U1", status: "delivered", createdAt: { seconds: 200 },
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 8 },
            { sizeId: "270ml", flavourId: "hib", quantity: 6 }] },
  { customerUid: "U1", status: "requested", createdAt: { seconds: 100 },
    items: [{ sizeId: "1L", flavourId: "lem", quantity: 2 }] },
  { customerUid: "U2", status: "delivered", createdAt: { seconds: 250 },
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 99 }] },
];

test("lastOrderItems returns the newest non-cancelled order's items for the uid", () => {
  assert.deepStrictEqual(KO.lastOrderItems(ORDERS, "U1"), [
    { sizeId: "1L", flavourId: "gin", quantity: 8 },
    { sizeId: "270ml", flavourId: "hib", quantity: 6 },
  ]);
});

test("lastOrderItems returns [] for unknown uid, only-cancelled, or empty", () => {
  assert.deepStrictEqual(KO.lastOrderItems(ORDERS, "U3"), []);
  assert.deepStrictEqual(KO.lastOrderItems(
    [{ customerUid: "U1", status: "cancelled", createdAt: { seconds: 5 },
       items: [{ sizeId: "1L", flavourId: "x", quantity: 1 }] }], "U1"), []);
  assert.deepStrictEqual(KO.lastOrderItems([], "U1"), []);
});

const STOCKTAKES = [
  { date: "2026-06-01", counts: { "1L": 20, "270ml": 5 } },
  { date: "2026-07-01", counts: { "1L": 40, "270ml": 8 } },
];
const PROD_DELIVS = [
  { date: "2026-06-20", items: [{ sizeId: "1L", flavourId: "x", quantity: 10 }] },
  { date: "2026-06-25", items: [{ sizeId: "270ml", flavourId: "y", quantity: 3 },
                                { sizeId: "1L", flavourId: "z", quantity: 5 }] },
  { date: "2026-07-05", items: [{ sizeId: "1L", flavourId: "x", quantity: 30 }] },
];

test("producedPerSize: bottled1L − used1L and count270, exclusive start / inclusive end", () => {
  assert.deepStrictEqual(KO.producedPerSize(BATCHES, "2026-06-01", "2026-07-01"), { "1L": 56, "270ml": 8 });
  assert.deepStrictEqual(KO.producedPerSize(BATCHES, "2026-07-01", null), { "1L": 37, "270ml": 8 });
});

test("deliveredPerSize sums delivered quantity per size in range", () => {
  assert.deepStrictEqual(KO.deliveredPerSize(PROD_DELIVS, "2026-06-01", "2026-07-01"), { "1L": 15, "270ml": 3 });
  assert.deepStrictEqual(KO.deliveredPerSize(PROD_DELIVS, "2026-07-01", null), { "1L": 30 });
});

test("latestStocktake picks the greatest date <= asOf, or null", () => {
  assert.strictEqual(KO.latestStocktake([], null), null);
  assert.strictEqual(KO.latestStocktake(STOCKTAKES, null).date, "2026-07-01");
  assert.strictEqual(KO.latestStocktake(STOCKTAKES, "2026-06-15").date, "2026-06-01");
});

test("availableToSell = latest stocktake + produced − delivered since; null if none", () => {
  assert.strictEqual(KO.availableToSell([], BATCHES, PROD_DELIVS), null);
  assert.deepStrictEqual(KO.availableToSell(STOCKTAKES, BATCHES, PROD_DELIVS), { "1L": 47, "270ml": 16 });
});

test("consumptionPeriods reconciles expected − actual per interval; [] for <2", () => {
  assert.deepStrictEqual(KO.consumptionPeriods([STOCKTAKES[0]], BATCHES, PROD_DELIVS), []);
  const periods = KO.consumptionPeriods(STOCKTAKES, BATCHES, PROD_DELIVS);
  assert.strictEqual(periods.length, 1);
  assert.deepStrictEqual(periods[0], {
    fromDate: "2026-06-01", toDate: "2026-07-01", consumed: { "1L": 21, "270ml": 2 } });
});

test("sumConsumption folds periods per size", () => {
  const periods = KO.consumptionPeriods(STOCKTAKES, BATCHES, PROD_DELIVS);
  assert.deepStrictEqual(KO.sumConsumption(periods), { "1L": 21, "270ml": 2 });
});

test("date-range boundaries: event on afterDate excluded, on throughDate included", () => {
  const b = [
    { number: 9, step4: { bottles1L: 10, date: "2026-06-01" } },  // == afterDate → excluded
    { number: 10, step4: { bottles1L: 7, date: "2026-07-01" } },  // == throughDate → included
  ];
  assert.deepStrictEqual(KO.producedPerSize(b, "2026-06-01", "2026-07-01"), { "1L": 7, "270ml": 0 });
  const dv = [
    { date: "2026-06-01", items: [{ sizeId: "1L", flavourId: "a", quantity: 4 }] }, // excluded
    { date: "2026-07-01", items: [{ sizeId: "1L", flavourId: "a", quantity: 3 }] }, // included
  ];
  assert.deepStrictEqual(KO.deliveredPerSize(dv, "2026-06-01", "2026-07-01"), { "1L": 3 });
});

test("whatsappOrderText builds new/delivered messages", () => {
  assert.strictEqual(KO.whatsappOrderText("new", "Palm Spot", "8x 1 L Ginger"),
    "🧋 New order — Palm Spot: 8x 1 L Ginger");
  assert.strictEqual(KO.whatsappOrderText("delivered", "Sun Spot", "6x 270 ml Lemon"),
    "✅ Delivered — Sun Spot: 6x 270 ml Lemon");
  assert.match(KO.whatsappOrderText("anything-else", "X", "y"), /^🧋 New order — /);
});

test("lastDeliveryItems returns the newest delivery's items for the customer", () => {
  assert.deepStrictEqual(KO.lastDeliveryItems(DELIVS, "A"),
    [{ sizeId: "1L", flavourId: "gin", quantity: 1 }]);           // A's newest = 2026-07-01
  assert.deepStrictEqual(KO.lastDeliveryItems(DELIVS, "B"),
    [{ sizeId: "270ml", flavourId: "gin", quantity: 4 }]);        // B's only = 2026-06-15
  assert.deepStrictEqual(KO.lastDeliveryItems(DELIVS, "Z"), []);  // unknown customer
  assert.deepStrictEqual(KO.lastDeliveryItems([], "A"), []);      // empty
});
