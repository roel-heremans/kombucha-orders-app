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

  function resolveWindow(preset, startMk, endMk, curMk) {
    if (preset === "last-month") { const p = recentMonthKeys(curMk, 2)[0]; return { startMk: p, endMk: p }; }
    if (preset === "this-year") { return { startMk: curMk.slice(0, 4) + "-01", endMk: curMk }; }
    if (preset === "custom") {
      let s = startMk || curMk, e = endMk || curMk;
      if (s > e) s = e;
      return { startMk: s, endMk: e };
    }
    return { startMk: curMk, endMk: curMk }; // this-month (default)
  }

  // Callers pass startMk <= endMk (see resolveWindow); an inverted range returns [endMk].
  function monthKeysBetween(startMk, endMk) {
    if (startMk > endMk) return [endMk];
    let y = parseInt(startMk.slice(0, 4), 10);
    let m = parseInt(startMk.slice(5, 7), 10);
    const ey = parseInt(endMk.slice(0, 4), 10);
    const em = parseInt(endMk.slice(5, 7), 10);
    const keys = [];
    while (y < ey || (y === ey && m <= em)) {
      keys.push(y + "-" + String(m).padStart(2, "0"));
      m++; if (m === 13) { m = 1; y++; }
    }
    return keys;
  }

  function inWindow(dateStr, startMk, endMk) {
    const mk = monthKey(dateStr);
    return mk >= startMk && mk <= endMk;
  }

  function revenueInWindow(deliveries, sizes, startMk, endMk) {
    return deliveries.reduce(function (sum, d) {
      return inWindow(d.date, startMk, endMk) ? sum + deliveryRevenue(d, sizes) : sum;
    }, 0);
  }

  function revenueByCustomerInWindow(deliveries, sizes, startMk, endMk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inWindow(d.date, startMk, endMk)) return;
      byId[d.customerId] = (byId[d.customerId] || 0) + deliveryRevenue(d, sizes);
    });
    return Object.keys(byId)
      .map(function (id) { return { customerId: id, amount: byId[id] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function flavourCountsInWindow(deliveries, startMk, endMk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inWindow(d.date, startMk, endMk)) return;
      (d.items || []).forEach(function (it) {
        byId[it.flavourId] = (byId[it.flavourId] || 0) + it.quantity;
      });
    });
    return Object.keys(byId)
      .map(function (id) { return { flavourId: id, quantity: byId[id] }; })
      .sort(function (a, b) { return b.quantity - a.quantity; });
  }

  function windowLabel(startMk, endMk) {
    const abbr = function (mk) { return monthName(mk).slice(0, 3); };
    const year = function (mk) { return mk.slice(0, 4); };
    if (startMk === endMk) return abbr(startMk) + " " + year(startMk);
    if (year(startMk) === year(endMk)) return abbr(startMk) + "–" + abbr(endMk) + " " + year(endMk);
    return abbr(startMk) + " " + year(startMk) + "–" + abbr(endMk) + " " + year(endMk);
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

  function orderItemsSummary(order, sizes, flavourName) {
    return (order.items || []).map(function (it) {
      const s = sizeById(sizes, it.sizeId);
      const label = s ? s.label : it.sizeId;
      const fname = flavourName ? flavourName(it.flavourId) : it.flavourId;
      return it.quantity + "x " + label + " " + fname;
    }).join(", ");
  }

  function orderStatusLabel(status) {
    if (status === "delivered") return "✅ Delivered";
    if (status === "cancelled") return "✖ Cancelled";
    return "⏳ Requested";
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

  function stackedBarChartSVG(bars, opts) {
    opts = opts || {};
    const width = opts.width || 320;
    const height = opts.height || 160;
    const pad = 24;
    const chartH = height - pad * 2;
    const sums = bars.map(function (b) {
      return (b.segments || []).reduce(function (s, seg) { return s + seg.value; }, 0);
    });
    const max = sums.reduce(function (m, v) { return Math.max(m, v); }, 0) || 1;
    const n = bars.length;
    const slot = n > 0 ? (width - pad * 2) / n : 0;
    const barW = slot * 0.6;
    let out = "";
    bars.forEach(function (b, i) {
      const x = pad + slot * i + (slot - barW) / 2;
      let yCursor = pad + chartH; // bottom baseline
      const tip = escapeXml(b.tip || "");
      (b.segments || []).forEach(function (seg) {
        const h = (seg.value / max) * chartH;
        const y = yCursor - h;
        out += '<rect class="bar" data-tip="' + tip + '" style="cursor:pointer" x="' +
          x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
          '" height="' + Math.max(0, h).toFixed(1) + '" fill="' + seg.color +
          '"><title>' + tip + "</title></rect>";
        yCursor = y;
      });
      out += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (height - 6) +
        '" font-size="9" text-anchor="middle" fill="currentColor">' +
        escapeXml(b.label) + "</text>";
    });
    return '<svg viewBox="0 0 ' + width + " " + height +
      '" width="100%" role="img">' + out + "</svg>";
  }

  function typeMap(customers) {
    const t = {};
    (customers || []).forEach(function (c) { t[c.id] = c.type === "private" ? "private" : "restaurant"; });
    return t;
  }

  function revenueByTypeInWindow(deliveries, sizes, customers, startMk, endMk) {
    const t = typeMap(customers);
    let priv = 0, rest = 0;
    deliveries.forEach(function (d) {
      if (!inWindow(d.date, startMk, endMk)) return;
      const r = deliveryRevenue(d, sizes);
      if ((t[d.customerId] || "restaurant") === "private") priv += r; else rest += r;
    });
    return { private: priv, restaurant: rest, total: priv + rest };
  }

  function revenueTypeSeries(deliveries, sizes, customers, monthKeys) {
    return monthKeys.map(function (mk) {
      const r = revenueByTypeInWindow(deliveries, sizes, customers, mk, mk);
      return { monthKey: mk, private: r.private, restaurant: r.restaurant, total: r.total };
    });
  }

  function revenueTypeByYear(deliveries, sizes, customers) {
    const t = typeMap(customers);
    const byYear = {};
    deliveries.forEach(function (d) {
      const y = d.date.slice(0, 4);
      const e = byYear[y] || (byYear[y] = { private: 0, restaurant: 0 });
      const r = deliveryRevenue(d, sizes);
      if ((t[d.customerId] || "restaurant") === "private") e.private += r; else e.restaurant += r;
    });
    return Object.keys(byYear).sort().map(function (y) {
      return { year: y, private: byYear[y].private, restaurant: byYear[y].restaurant,
        total: byYear[y].private + byYear[y].restaurant };
    });
  }

  return { formatMoney, sizeById, deliveryRevenue, deliveryDepositRefund, monthKey, inMonth, monthName, dayOfMonth, recentMonthKeys, resolveWindow, monthKeysBetween, inWindow, revenueInWindow, revenueByCustomerInWindow, flavourCountsInWindow, windowLabel, monthlyRevenue, revenueByCustomer, monthlyRevenueSeries, flavourCounts, revenueByCustomerType, outstandingByCustomer, reciboSizeLabel, generateRecibo, orderItemsSummary, orderStatusLabel, barChartSVG, stackedBarChartSVG, revenueByTypeInWindow, revenueTypeSeries, revenueTypeByYear };
});
