(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KO = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function formatMoney(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function sizeById(sizes, sizeId) {
    return sizes.find(function (s) { return s.id === sizeId; });
  }

  function deliveryRevenue(delivery, sizes) {
    return (delivery.items || []).reduce(function (sum, it) {
      const s = sizeById(sizes, it.sizeId);
      return sum + (s ? s.price * it.quantity : 0);
    }, 0);
  }

  function deliveryDepositRefund(delivery, sizes) {
    return (delivery.empties || []).reduce(function (sum, e) {
      const s = sizeById(sizes, e.sizeId);
      return sum + (s ? s.deposit * e.quantity : 0);
    }, 0);
  }

  return { formatMoney, sizeById, deliveryRevenue, deliveryDepositRefund };
});
