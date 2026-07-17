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

  const PT_MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const STRINGS = {
    en: {
      log_out: "Log out", new_order: "New order", size: "Size", flavour: "Flavour",
      qty: "Qty", choose_flavour: "— choose flavour —", add_line: "➕ Add line",
      preferred_date: "Preferred date (optional)", note: "Note (optional)",
      send_order: "Send order", need_line: "Add at least one bottle line with a flavour.",
      order_sent: "Order sent ✓", send_failed: "Send failed:", your_orders: "Your orders",
      clear_finished: "Clear finished", no_orders: "No orders yet.",
      all_cleared: "All finished orders cleared.", cancel: "Cancel",
      confirm_cancel: "Cancel this order?", show_cleared: "Show cleared orders",
      hide_cleared: "Hide cleared orders", my_recibos: "My Recibos",
      download_print: "Download / Print", no_recibos: "No recibos yet.",
      recibo_unavailable: "That recibo is no longer available.",
      recibo_open_failed: "Could not open the recibo:",
      not_linked: "Your account isn't linked to a customer yet. Please contact us.",
      loading: "Loading…", status_requested: "Requested", status_delivered: "Delivered",
      status_cancelled: "Cancelled",
    },
    pt: {
      log_out: "Sair", new_order: "Novo pedido", size: "Tamanho", flavour: "Sabor",
      qty: "Qtd", choose_flavour: "— escolher sabor —", add_line: "➕ Adicionar linha",
      preferred_date: "Data preferida (opcional)", note: "Nota (opcional)",
      send_order: "Enviar pedido", need_line: "Adicione pelo menos uma linha com um sabor.",
      order_sent: "Pedido enviado ✓", send_failed: "Falha no envio:", your_orders: "Os seus pedidos",
      clear_finished: "Limpar concluídos", no_orders: "Ainda não há pedidos.",
      all_cleared: "Todos os pedidos concluídos foram limpos.", cancel: "Cancelar",
      confirm_cancel: "Cancelar este pedido?", show_cleared: "Mostrar pedidos limpos",
      hide_cleared: "Ocultar pedidos limpos", my_recibos: "Os meus Recibos",
      download_print: "Descarregar / Imprimir", no_recibos: "Ainda não há recibos.",
      recibo_unavailable: "Esse recibo já não está disponível.",
      recibo_open_failed: "Não foi possível abrir o recibo:",
      not_linked: "A sua conta ainda não está associada a um cliente. Contacte-nos, por favor.",
      loading: "A carregar…", status_requested: "Solicitado", status_delivered: "Entregue",
      status_cancelled: "Cancelado",
    },
  };

  function t(lang, key) {
    return (STRINGS[lang] || STRINGS.en)[key] || STRINGS.en[key] || key;
  }

  function monthKey(dateStr) { return dateStr.slice(0, 7); }

  function inMonth(dateStr, mk) { return monthKey(dateStr) === mk; }

  function monthName(mk, lang) { return (lang === "pt" ? PT_MONTH_NAMES : MONTH_NAMES)[parseInt(mk.slice(5, 7), 10) - 1]; }

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

  function windowLabel(startMk, endMk, lang) {
    const abbr = function (mk) { return monthName(mk, lang).slice(0, 3); };
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

  function reciboDocId(customerId, monthKey) {
    return customerId + "_" + monthKey;
  }

  function nextBatchNumber(batches) {
    return (batches || []).reduce(function (m, b) {
      return Math.max(m, b && typeof b.number === "number" ? b.number : 0);
    }, 0) + 1;
  }

  function formatBatchNumber(n) {
    return "Batch " + String(n).padStart(3, "0");
  }

  function bottles1LForConversion(count270) {
    return Math.ceil((count270 || 0) * 270 / 1000);
  }

  function sizeLiters(size) {
    if (size && typeof size.liters === "number") return size.liters;
    const m = /([\d.]+)\s*(ml|l)\b/i.exec(size && size.label ? size.label : "");
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return /ml/i.test(m[2]) ? n / 1000 : n;
  }

  function soldLitersInWindow(deliveries, sizes, startMk, endMk) {
    return (deliveries || []).reduce(function (sum, d) {
      if (!inWindow(d.date, startMk, endMk)) return sum;
      return sum + (d.items || []).reduce(function (s, it) {
        return s + sizeLiters(sizeById(sizes, it.sizeId)) * (it.quantity || 0);
      }, 0);
    }, 0);
  }

  function productionSummary(batches, startMk, endMk) {
    let bottled1L = 0, made270 = 0, used1L = 0;
    (batches || []).forEach(function (b) {
      if (b && b.step4 && b.step4.date && inWindow(b.step4.date, startMk, endMk)) {
        bottled1L += b.step4.bottles1L || 0;
      }
      ((b && b.conversions) || []).forEach(function (c) {
        if (c && c.date && inWindow(c.date, startMk, endMk)) {
          made270 += c.count270 || 0;
          used1L += c.used1L || 0;
        }
      });
    });
    return { bottled1L: bottled1L, made270: made270, used1L: used1L };
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

  function orderEmailParams(order, restaurantName, sizes, flavourName, placedAt) {
    return {
      restaurant_name: restaurantName,
      items: orderItemsSummary(order, sizes, flavourName),
      preferred_date: (order && order.preferredDate) || "—",
      note: (order && order.note) || "—",
      placed_at: placedAt || "",
    };
  }

  function lastOrderItems(orders, customerUid) {
    const mine = (orders || []).filter(function (o) {
      return o && o.customerUid === customerUid && o.status !== "cancelled";
    }).slice().sort(function (a, b) {
      const ta = (a.createdAt && a.createdAt.seconds) || 0;
      const tb = (b.createdAt && b.createdAt.seconds) || 0;
      return tb - ta;
    });
    if (!mine.length) return [];
    return (mine[0].items || []).map(function (it) {
      return { sizeId: it.sizeId, flavourId: it.flavourId, quantity: it.quantity };
    });
  }

  function orderStatusLabel(status, lang) {
    if (status === "delivered") return "✅ " + t(lang, "status_delivered");
    if (status === "cancelled") return "✖ " + t(lang, "status_cancelled");
    return "⏳ " + t(lang, "status_requested");
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c];
    });
  }

  function barChartSVG(data, opts) {
    opts = opts || {};
    const width = opts.width || 320;
    const rotate = !!opts.rotate; // rotate x labels 90deg clockwise (long labels)
    const height = opts.height || (rotate ? 210 : 160);
    const color = opts.color || "#4a7c59";
    const fmt = opts.format || function (v) { return String(v); };
    const pad = 24;                       // horizontal margins + top
    const bottomPad = rotate ? 70 : 24;   // room for x-axis labels
    const chartH = height - pad - bottomPad;
    const baseline = pad + chartH;
    const max = data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;
    const n = data.length;
    const slot = n > 0 ? (width - pad * 2) / n : 0;
    const barW = slot * 0.6;
    let bars = "";
    data.forEach(function (d, i) {
      const h = (d.value / max) * chartH;
      const x = pad + slot * i + (slot - barW) / 2;
      const y = baseline - h;
      const cx = x + barW / 2;
      const titleText = (d.title != null ? d.title : d.label) + ": " + fmt(d.value);
      bars += '<rect class="bar" data-tip="' + escapeXml(titleText) +
        '" style="cursor:pointer" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="' + color + '"><title>' + escapeXml(titleText) + "</title></rect>";
      if (rotate) {
        const ly = (baseline + 5).toFixed(1);
        bars += '<text x="' + cx.toFixed(1) + '" y="' + ly +
          '" font-size="9" text-anchor="start" fill="currentColor" transform="rotate(90 ' +
          cx.toFixed(1) + " " + ly + ')">' + escapeXml(d.label) + "</text>";
      } else {
        bars += '<text x="' + cx.toFixed(1) + '" y="' + (height - 6) +
          '" font-size="9" text-anchor="middle" fill="currentColor">' +
          escapeXml(d.label) + "</text>";
      }
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

  return { formatMoney, sizeById, deliveryRevenue, deliveryDepositRefund, monthKey, inMonth, monthName, dayOfMonth, recentMonthKeys, resolveWindow, monthKeysBetween, inWindow, revenueInWindow, revenueByCustomerInWindow, flavourCountsInWindow, windowLabel, monthlyRevenue, revenueByCustomer, monthlyRevenueSeries, flavourCounts, revenueByCustomerType, outstandingByCustomer, reciboSizeLabel, reciboDocId, nextBatchNumber, formatBatchNumber, bottles1LForConversion, sizeLiters, soldLitersInWindow, productionSummary, generateRecibo, orderItemsSummary, orderEmailParams, lastOrderItems, orderStatusLabel, barChartSVG, stackedBarChartSVG, revenueByTypeInWindow, revenueTypeSeries, revenueTypeByYear, t };
});
