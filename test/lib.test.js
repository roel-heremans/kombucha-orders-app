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
