const { test } = require("node:test");
const assert = require("node:assert");
const KO = require("../lib.js");

test("formatMoney formats to two decimals", () => {
  assert.strictEqual(KO.formatMoney(16), "16.00");
  assert.strictEqual(KO.formatMoney(4.5), "4.50");
  assert.strictEqual(KO.formatMoney(0), "0.00");
  assert.strictEqual(KO.formatMoney(86), "86.00");
});
