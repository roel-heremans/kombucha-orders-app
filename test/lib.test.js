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
