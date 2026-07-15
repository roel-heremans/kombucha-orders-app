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

  const MONTH_NAMES = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  function monthKey(dateStr) { return dateStr.slice(0, 7); }

  function inMonth(dateStr, mk) { return monthKey(dateStr) === mk; }

  function monthName(mk) { return MONTH_NAMES[parseInt(mk.slice(5, 7), 10) - 1]; }

  function dayOfMonth(dateStr) { return parseInt(dateStr.slice(8, 10), 10); }

  function recentMonthKeys(endMk, n) {
    let year = parseInt(endMk.slice(0, 4), 10);
    let month = parseInt(endMk.slice(5, 7), 10); // 1-12
    const keys = [];
    for (let i = 0; i < n; i++) {
      const mm = String(month).padStart(2, "0");
      keys.unshift(year + "-" + mm);
      month--;
      if (month === 0) { month = 12; year--; }
    }
    return keys;
  }

  function monthlyRevenue(deliveries, sizes, mk) {
    return deliveries.reduce(function (sum, d) {
      return inMonth(d.date, mk) ? sum + deliveryRevenue(d, sizes) : sum;
    }, 0);
  }

  function revenueByCustomer(deliveries, sizes, mk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inMonth(d.date, mk)) return;
      byId[d.customerId] = (byId[d.customerId] || 0) + deliveryRevenue(d, sizes);
    });
    return Object.keys(byId)
      .map(function (id) { return { customerId: id, amount: byId[id] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function monthlyRevenueSeries(deliveries, sizes, monthKeys) {
    return monthKeys.map(function (mk) {
      return { monthKey: mk, amount: monthlyRevenue(deliveries, sizes, mk) };
    });
  }

  function flavourCounts(deliveries, mk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inMonth(d.date, mk)) return;
      (d.items || []).forEach(function (it) {
        byId[it.flavourId] = (byId[it.flavourId] || 0) + it.quantity;
      });
    });
    return Object.keys(byId)
      .map(function (id) { return { flavourId: id, quantity: byId[id] }; })
      .sort(function (a, b) { return b.quantity - a.quantity; });
  }

  function revenueByCustomerType(deliveries, sizes, customers, mk) {
    const typeById = {};
    (customers || []).forEach(function (c) {
      typeById[c.id] = c.type === "private" ? "private" : "restaurant";
    });
    const byType = {};
    deliveries.forEach(function (d) {
      if (!inMonth(d.date, mk)) return;
      const t = typeById[d.customerId] || "restaurant";
      byType[t] = (byType[t] || 0) + deliveryRevenue(d, sizes);
    });
    return Object.keys(byType)
      .map(function (t) { return { type: t, amount: byType[t] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function outstandingByCustomer(deliveries, sizes) {
    const byCust = {};
    deliveries.forEach(function (d) {
      const per = byCust[d.customerId] || (byCust[d.customerId] = {});
      (d.items || []).forEach(function (it) {
        per[it.sizeId] = (per[it.sizeId] || 0) + it.quantity;
      });
      (d.empties || []).forEach(function (e) {
        per[e.sizeId] = (per[e.sizeId] || 0) - e.quantity;
      });
    });
    return Object.keys(byCust).sort().map(function (cid) {
      const perRaw = byCust[cid];
      const perSize = {};
      let depositHeld = 0;
      Object.keys(perRaw).forEach(function (sid) {
        const net = perRaw[sid];
        if (net === 0) return;
        perSize[sid] = net;
        const s = sizeById(sizes, sid);
        if (s) depositHeld += net * s.deposit;
      });
      return { customerId: cid, perSize: perSize, depositHeld: depositHeld };
    });
  }

  function reciboSizeLabel(size) {
    return size.label.replace(/\s+/g, "");
  }

  function generateRecibo(deliveries, customerId, mk, sizes, header, nif) {
    const headerLines = [header];
    if (nif && String(nif).trim()) headerLines.push("NIF: " + String(nif).trim());
    const mine = deliveries
      .filter(function (d) { return d.customerId === customerId && inMonth(d.date, mk); })
      .slice()
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    const deliveryLines = [];
    const labelParts = []; // {label, content, subtotal}
    let total = 0;

    mine.forEach(function (d) {
      const parts = [];
      sizes.forEach(function (s) {
        const qty = (d.items || []).reduce(function (sum, it) {
          return it.sizeId === s.id ? sum + it.quantity : sum;
        }, 0);
        if (qty > 0) parts.push(qty + "x " + reciboSizeLabel(s));
      });
      if (parts.length === 0) return;
      const subtotal = deliveryRevenue(d, sizes);
      total += subtotal;
      labelParts.push({
        label: monthName(mk) + " " + dayOfMonth(d.date) + ":",
        content: parts.join(" + ") + " = " + formatMoney(subtotal),
      });
    });

    const labelWidth = labelParts.reduce(function (w, p) {
      return Math.max(w, p.label.length);
    }, 0);
    labelParts.forEach(function (p) {
      deliveryLines.push(p.label.padEnd(labelWidth, " ") + " " + p.content);
    });

    const returnLines = [];
    mine.forEach(function (d) {
      const parts = [];
      let refund = 0;
      sizes.forEach(function (s) {
        if (s.deposit <= 0) return;
        const qty = (d.empties || []).reduce(function (sum, e) {
          return e.sizeId === s.id ? sum + e.quantity : sum;
        }, 0);
        if (qty > 0) { parts.push(qty + "x " + reciboSizeLabel(s)); refund += qty * s.deposit; }
      });
      if (parts.length === 0) return;
      total -= refund;
      returnLines.push("Return " + monthName(mk) + " " + dayOfMonth(d.date) + ": " +
        parts.join(" + ") + " = -" + formatMoney(refund));
    });

    const totalLine = "Total: " + formatMoney(total) + " Euro";
    const body = deliveryLines.concat(returnLines);
    if (body.length === 0) return headerLines.join("\n") + "\n\n" + totalLine;

    const longest = body.concat([totalLine]).reduce(function (w, l) {
      return Math.max(w, l.length);
    }, 0);
    const separator = "-".repeat(longest);

    return headerLines.concat([""]).concat(body).concat([separator, totalLine]).join("\n");
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c];
    });
  }

  function barChartSVG(data, opts) {
    opts = opts || {};
    const width = opts.width || 320;
    const height = opts.height || 160;
    const color = opts.color || "#4a7c59";
    const fmt = opts.format || function (v) { return String(v); };
    const pad = 24;
    const chartH = height - pad * 2;
    const max = data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;
    const n = data.length;
    const slot = n > 0 ? (width - pad * 2) / n : 0;
    const barW = slot * 0.6;
    let bars = "";
    data.forEach(function (d, i) {
      const h = (d.value / max) * chartH;
      const x = pad + slot * i + (slot - barW) / 2;
      const y = pad + (chartH - h);
      const titleText = (d.title != null ? d.title : d.label) + ": " + fmt(d.value);
      bars += '<rect class="bar" data-tip="' + escapeXml(titleText) +
        '" style="cursor:pointer" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="' + color + '"><title>' + escapeXml(titleText) + "</title></rect>";
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (height - 6) +
        '" font-size="9" text-anchor="middle" fill="currentColor">' +
        escapeXml(d.label) + "</text>";
    });
    return '<svg viewBox="0 0 ' + width + " " + height +
      '" width="100%" role="img">' + bars + "</svg>";
  }

  return { formatMoney, sizeById, deliveryRevenue, deliveryDepositRefund, monthKey, inMonth, monthName, dayOfMonth, recentMonthKeys, monthlyRevenue, revenueByCustomer, monthlyRevenueSeries, flavourCounts, revenueByCustomerType, outstandingByCustomer, reciboSizeLabel, generateRecibo, barChartSVG };
});
