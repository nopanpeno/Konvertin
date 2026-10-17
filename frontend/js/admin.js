(function () {
  "use strict";
  var api = (window.KONVERTIN && window.KONVERTIN.apiBase || "").replace(/\/$/, "");
  var isSuperAdmin = false;
  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character];
    });
  }
  function request(path, options) {
    options = options || {};
    options.credentials = "same-origin";
    options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    return fetch(api + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || "Permintaan gagal. Coba lagi.");
        return data;
      });
    });
  }
  function notify(text, bad) {
    var element = $("account-message");
    if (!element) return;
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("err", !!bad);
    if (text) element.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function bindAction(element, action) {
    element.disabled = true;
    return action().catch(function (error) {
      notify(error.message, true);
    }).then(function () { element.disabled = false; });
  }
  function number(value) { return Number(value || 0).toLocaleString("id-ID"); }
  function rupiah(value) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value || 0);
  }
  function date(value) { return value ? new Date(value * 1000).toLocaleString("id-ID") : "—"; }
  function statusName(value) {
    return ({ active: "Aktif", suspended: "Dibatasi", queued: "Dalam antrean", processing: "Diproses",
      done: "Berhasil", failed: "Gagal", paid: "Lunas", pending: "Menunggu", expired: "Kedaluwarsa",
      cancelled: "Dibatalkan", open: "Baru", in_progress: "Ditangani", resolved: "Selesai" })[value] || value || "—";
  }
  function statusClass(value) {
    if (["active", "done", "paid", "resolved"].indexOf(value) >= 0) return "good";
    if (["failed", "suspended", "expired", "cancelled"].indexOf(value) >= 0) return "bad";
    return "pending";
  }
  function pill(value) {
    return "<span class=\"status-pill " + statusClass(value) + "\">" + esc(statusName(value)) + "</span>";
  }
  function loadDashboard() {
    var days = $("usage-days").value;
    request("/api/admin/dashboard?days=" + days).then(function (data) {
      $("admin-users-total").textContent = number(data.users.total);
      $("admin-users-new").textContent = number(data.users.new_in_period) + " akun baru dalam periode";
      $("admin-conversions-total").textContent = number(data.conversions.total_in_period);
      $("admin-conversions-failed").textContent = number(data.conversions.failed_in_period) + " gagal";
      $("admin-premium-total").textContent = number(data.premium_customers);
      $("admin-revenue-total").textContent = rupiah(data.revenue_last_30_days);
      $("admin-success-rate").textContent = Number(data.usage.success_rate || 0).toLocaleString("id-ID") + "%";
      $("admin-open-tickets").textContent = number(data.open_tickets);
      drawUsage(data.usage);
      var system = data.system;
      $("system-status").innerHTML = [
        ["Antrean menunggu", number(system.queue)],
        ["Sedang diproses", number(system.processing)],
        ["Worker", number(system.worker_count)],
        ...(isSuperAdmin ? [["Admin bawahan aktif", number(data.staff_admins.active) + " / " + number(data.staff_admins.maximum)]] : []),
        ["Penyimpanan terpakai", formatBytes(system.storage_used_bytes)],
        ["Penyimpanan tersedia", formatBytes(system.storage_available_bytes)],
        ["Batas file server", number(system.max_file_mb) + " MB"],
        ["Batas halaman PDF", number(system.max_pdf_pages) + " halaman"],
        ["Gagal dalam periode", number(data.conversions.failed_in_period)],
      ].map(function (item) {
        return "<div><span>" + esc(item[0]) + "</span><strong>" + esc(item[1]) + "</strong></div>";
      }).join("");
    }).catch(function (error) { notify(error.message, true); });
  }
  function formatBytes(value) {
    if (!value) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB"], unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return (value / Math.pow(1024, unit)).toFixed(unit === 0 ? 0 : 1) + " " + units[unit];
  }
  function drawUsage(data) {
    var canvas = $("usage-chart");
    var ctx = canvas.getContext("2d"), count = Number(data.days), rows = data.daily || [];
    var byDay = {};
    rows.forEach(function (row) { byDay[row.day] = row.count; });
    var today = new Date(), days = [];
    for (var i = count - 1; i >= 0; i -= 1) {
      var dateValue = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      days.push({ day: dateValue.toISOString().slice(0, 10), count: 0 });
    }
    days.forEach(function (row) { row.count = byDay[row.day] || 0; });
    var width = canvas.width, height = canvas.height, max = Math.max(1, ...days.map(function (row) { return row.count; }));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f5f8ff";
    ctx.fillRect(0, 0, width, height);
    var step = width / Math.max(days.length, 1), bar = Math.max(3, step * 0.62);
    days.forEach(function (row, index) {
      var barHeight = (height - 48) * row.count / max, x = index * step + (step - bar) / 2;
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(x, height - 30 - barHeight, bar, barHeight);
      if (days.length <= 14 || index % Math.ceil(days.length / 10) === 0 || index === days.length - 1) {
        ctx.fillStyle = "#0f172a";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(row.day.slice(5), x + bar / 2, height - 9);
      }
    });
    $("usage-total").textContent = number(data.total) + " konversi dalam " + count + " hari";
    $("usage-types").innerHTML = data.types.length
      ? "<ul>" + data.types.map(function (row) { return "<li>" + esc(row.tool_type.replace(/-/g, " ")) + " — " + number(row.count) + " kali</li>"; }).join("") + "</ul>"
      : "<p class=\"muted\">Belum ada penggunaan pada periode ini.</p>";
    drawUsageMix(data);
  }
  function drawUsageMix(data) {
    var canvas = $("usage-mix-chart");
    if (!canvas) return;
    var ctx = canvas.getContext("2d"), rows = data.types || [];
    var colors = ["#2563eb", "#0ea5e9", "#14b8a6", "#6366f1", "#f59e0b", "#ef4444"];
    var total = rows.reduce(function (sum, row) { return sum + Number(row.count || 0); }, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f5f8ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!total) {
      ctx.fillStyle = "#64748b";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Belum ada data penggunaan", canvas.width / 2, canvas.height / 2);
      $("usage-mix-legend").innerHTML = "";
      return;
    }
    var x = canvas.width / 2, y = canvas.height / 2, radius = Math.min(canvas.width, canvas.height) * 0.34;
    var start = -Math.PI / 2;
    rows.slice(0, 6).forEach(function (row, index) {
      var end = start + Math.PI * 2 * Number(row.count) / total;
      ctx.beginPath();
      ctx.arc(x, y, radius, start, end);
      ctx.lineWidth = Math.max(22, radius * 0.42);
      ctx.strokeStyle = colors[index % colors.length];
      ctx.stroke();
      start = end;
    });
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(number(total), x, y + 4);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("penggunaan", x, y + 25);
    $("usage-mix-legend").innerHTML = rows.slice(0, 6).map(function (row, index) {
      var percent = Math.round(Number(row.count) * 100 / total);
      return "<li><i style=\"--mix-color:" + colors[index % colors.length] + "\"></i>" +
        esc(row.tool_type.replace(/-/g, " ")) + "<strong>" + percent + "%</strong></li>";
    }).join("");
  }
  function loadOperations() {
    request("/api/admin/operations").then(function (data) {
      var form = $("limits-form");
      ["free_daily_quota", "premium_daily_quota", "free_max_file_mb", "premium_max_file_mb"].forEach(function (key) {
        form.elements[key].value = data.settings[key] || "";
      });
      form.elements.free_max_file_mb.max = data.limits.server_max_file_mb;
      form.elements.premium_max_file_mb.max = data.limits.server_max_file_mb;
      $("features-list").innerHTML = "<table><thead><tr><th>Jenis tool</th><th>Format asal</th><th>Format hasil</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>" +
        data.features.map(function (feature) {
          return "<tr><td>" + esc(feature.type.replace(/-/g, " ")) + "</td><td>" + esc(feature.source.toUpperCase()) + "</td><td>" + esc(feature.target.toUpperCase()) + "</td><td>" + pill(feature.enabled ? "active" : "suspended") + "</td><td><button class=\"btn ghost\" type=\"button\" data-feature=\"" + esc(feature.type) + "\" data-enabled=\"" + (!feature.enabled) + "\">" + (feature.enabled ? "Nonaktifkan" : "Aktifkan") + "</button></td></tr>";
        }).join("") + "</tbody></table>";
      $("admin-plans-list").innerHTML = "<table><thead><tr><th>Paket</th><th>Harga (IDR)</th><th>Fasilitas</th><th>Aktif</th><th></th></tr></thead><tbody>" +
        data.plans.map(function (plan) {
          return "<tr data-plan-row=\"" + esc(plan.plan_id) + "\"><td><input aria-label=\"Nama paket\" data-plan-name value=\"" + esc(plan.name) + "\" maxlength=\"80\"></td><td><input aria-label=\"Harga\" data-plan-price type=\"number\" min=\"0\" max=\"1000000000\" value=\"" + Number(plan.price) + "\"></td><td><input aria-label=\"Fasilitas, pisahkan dengan koma\" data-plan-features value=\"" + esc((plan.features || []).join(", ")) + "\"></td><td><input aria-label=\"Paket aktif\" data-plan-active type=\"checkbox\"" + (plan.active ? " checked" : "") + "></td><td><button class=\"btn\" type=\"button\" data-save-plan=\"" + esc(plan.plan_id) + "\">Simpan</button></td></tr>";
        }).join("") + "</tbody></table>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadUsers(search) {
    request("/api/admin/users?limit=100&search=" + encodeURIComponent(search || "")).then(function (data) {
      var container = $("users-list");
      if (!data.users.length) { container.innerHTML = "<p>Tidak ada user yang cocok.</p>"; return; }
      container.innerHTML = "<table><thead><tr><th>Akun dan kontak</th><th>Status akun/email</th><th>Konversi</th><th>Premium</th><th>Kontrol</th></tr></thead><tbody>" +
        data.users.map(function (user) {
          var subscription = user.subscription_status || "free";
          var subLabel = user.subscription_status ? statusName(subscription) : "Free";
          var accessAction = user.status === "active" ? "suspended" : "active";
          var subAction = subscription === "active" ? "cancelled" : "active";
          var controls = isSuperAdmin
            ? "<button class=\"btn ghost\" type=\"button\" data-user-detail=\"" + user.user_id + "\">Detail &amp; peringatan</button><button class=\"btn ghost\" type=\"button\" data-user-status=\"" + user.user_id + "\" data-status=\"" + accessAction + "\">" + (user.status === "active" ? "Blokir" : "Pulihkan") + "</button><button class=\"btn ghost\" type=\"button\" data-user-notifications=\"" + user.user_id + "\" data-enabled=\"" + (!user.email_notifications) + "\">" + (user.email_notifications ? "Matikan email" : "Aktifkan email") + "</button><button class=\"btn ghost\" type=\"button\" data-user-subscription=\"" + user.user_id + "\" data-status=\"" + subAction + "\">" + (subAction === "active" ? "Aktifkan Premium" : "Hentikan Premium") + "</button><button class=\"btn ghost\" type=\"button\" data-user-delete=\"" + user.user_id + "\" data-user-name=\"" + esc(user.display_name) + "\">Hapus akun</button>"
            : "<span class=\"muted\">Akses pantau saja</span>";
          return "<tr><td><strong>" + esc(user.display_name) + "</strong><br><span class=\"muted\">" + esc(user.email) + "</span><br><small>WhatsApp: " + esc(user.phone || "Belum ditambahkan") + "</small><br><small>Gabung " + esc(date(user.created_at)) + "</small></td><td>" + pill(user.status) + "<br><small>" + (user.email_verified ? "Email terverifikasi" : "Email belum terverifikasi") + "</small><br><small>Notifikasi email: " + (user.email_notifications ? "Aktif" : "Nonaktif") + "</small></td><td>" + number(user.conversions) + "</td><td>" + esc(subLabel) + "</td><td><div class=\"history-actions\">" + controls + "</div></td></tr>";
        }).join("") + "</tbody></table>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadUserDetails(userId) {
    request("/api/admin/users/" + encodeURIComponent(userId)).then(function (data) {
      var user = data.user, account = data.account, container = $("user-detail-content");
      $("user-detail-title").textContent = user.display_name;
      $("user-notification-form").elements.user_id.value = user.user_id;
      var payments = account.payments.length ? "<ul>" + account.payments.map(function (payment) {
        var invoice = payment.invoice_url
          ? " · <a href=\"" + esc(payment.invoice_url) + "\" target=\"_blank\" rel=\"noopener\">Invoice</a>" : "";
        var provider = payment.provider === "midtrans" ? "Midtrans" : "Xendit (riwayat lama)";
        return "<li>" + esc(provider + " · " + rupiah(payment.amount)) + " · " + esc(statusName(payment.status)) + " · " + esc(date(payment.created_at)) + invoice + "</li>";
      }).join("") + "</ul>" : "<p class=\"muted\">Belum ada transaksi.</p>";
      var history = data.history.length ? "<div class=\"table-scroll\"><table><thead><tr><th>Tool</th><th>Sumber</th><th>Status</th><th>Waktu</th></tr></thead><tbody>" +
        data.history.map(function (row) {
          return "<tr><td>" + esc(row.tool_type.replace(/-/g, " ")) + "</td><td>" + esc(row.source) + "</td><td>" + pill(row.status) + "</td><td>" + esc(date(row.created_at)) + "</td></tr>";
        }).join("") + "</tbody></table></div>" : "<p class=\"muted\">Belum ada riwayat konversi.</p>";
      var tickets = data.tickets.length ? "<ul>" + data.tickets.map(function (ticket) {
        return "<li><strong>" + esc(ticket.subject) + "</strong> · " + esc(statusName(ticket.status)) +
          " · " + esc(date(ticket.created_at)) + (ticket.admin_response ? "<br>Balasan: " + esc(ticket.admin_response) : "") + "</li>";
      }).join("") + "</ul>" : "<p class=\"muted\">Belum ada tiket bantuan.</p>";
      container.innerHTML = "<div class=\"system-metrics\">" +
        [["Email", user.email], ["Telepon/WhatsApp", user.phone || "Belum ditambahkan"],
          ["Verifikasi email", user.email_verified ? "Terverifikasi" : "Belum terverifikasi"],
          ["Status akun", statusName(user.status)], ["Tanggal daftar", date(user.created_at)],
          ["Paket saat ini", account.plan ? account.plan.name : "Free"],
          ["Kuota hari ini", number(account.quota.used_today) + " / " + number(account.quota.daily_limit)],
          ["Maksimum ukuran file", number(account.quota.max_file_mb) + " MB"],
          ["Notifikasi email", data.preferences.email_notifications ? "Aktif" : "Nonaktif"]]
          .map(function (item) { return "<div><span>" + esc(item[0]) + "</span><strong>" + esc(item[1]) + "</strong></div>"; }).join("") +
        "</div><h3>Riwayat konversi</h3>" + history + "<h3>Subscription dan pembayaran</h3>" +
        "<p>" + (account.subscription ? esc(statusName(account.subscription.status) + " · berakhir " + date(account.subscription.ends_at)) : "Tidak ada subscription aktif.") +
        "</p>" + payments + "<h3>Tiket bantuan</h3>" + tickets +
        "<h3>Notifikasi akun</h3>" + (data.notifications.length ? "<ul>" + data.notifications.map(function (item) {
          return "<li>" + esc(item.kind.toUpperCase() + " · " + item.title + " · " + date(item.created_at)) + "</li>";
        }).join("") + "</ul>" : "<p class=\"muted\">Belum ada notifikasi.</p>");
      if (!$("user-detail-dialog").open) $("user-detail-dialog").showModal();
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadJobs() {
    request("/api/admin/jobs?limit=100").then(function (data) {
      $("jobs-list").innerHTML = data.jobs.length ? "<table><thead><tr><th>Job</th><th>User</th><th>Status</th><th>Waktu</th><th>Error</th><th></th></tr></thead><tbody>" +
        data.jobs.map(function (job) {
          var control = isSuperAdmin && ["queued", "processing"].indexOf(job.status) >= 0 ? "<button class=\"btn ghost\" type=\"button\" data-cancel-job=\"" + esc(job.job_id) + "\">Batalkan</button>" : "";
          return "<tr><td>" + esc(job.type.replace(/_/g, " ")) + "<br><small>" + esc(job.job_id.slice(0, 8)) + " · " + esc(job.download_name || "") + "</small></td><td>" + esc(job.email || "Tanpa akun") + "</td><td>" + pill(job.status) + "</td><td>" + esc(date(job.created_at)) + "</td><td>" + esc(job.error_message || "—") + "</td><td>" + control + "</td></tr>";
        }).join("") + "</tbody></table>" : "<p>Tidak ada job konversi.</p>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadPayments() {
    request("/api/admin/payments?limit=100").then(function (data) {
      $("admin-payments-list").innerHTML = data.payments.length ? "<table><thead><tr><th>Pelanggan</th><th>Provider</th><th>Nominal</th><th>Status</th><th>Tanggal</th><th>Invoice</th></tr></thead><tbody>" +
        data.payments.map(function (payment) {
          var provider = payment.provider === "midtrans" ? "Midtrans" : "Xendit (riwayat lama)";
          return "<tr><td>" + esc(payment.display_name) + "<br><small>" + esc(payment.email) + "</small></td><td>" + esc(provider) + "</td><td>" + esc(rupiah(payment.amount)) + "</td><td>" + pill(payment.status) + "</td><td>" + esc(date(payment.created_at)) + "</td><td>" + (payment.invoice_url ? "<a href=\"" + esc(payment.invoice_url) + "\" target=\"_blank\" rel=\"noopener\">Buka invoice ↗</a>" : "—") + "</td></tr>";
        }).join("") + "</tbody></table>" : "<p>Belum ada transaksi.</p>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadSupport() {
    request("/api/admin/support?limit=100").then(function (data) {
      $("admin-support-list").innerHTML = data.tickets.length ? data.tickets.map(function (ticket) {
        return "<article class=\"support-card\" data-ticket=\"" + ticket.ticket_id + "\"><div class=\"section-heading\"><div><p class=\"eyebrow\">" + esc(ticket.category) + " · " + esc(date(ticket.created_at)) + "</p><h3>" + esc(ticket.subject) + "</h3><p class=\"muted\">" + esc(ticket.display_name) + " · " + esc(ticket.email) + "</p></div>" + pill(ticket.status) + "</div><pre>" + esc(ticket.message) + "</pre><label>Status<select data-ticket-status><option value=\"open\"" + (ticket.status === "open" ? " selected" : "") + ">Baru</option><option value=\"in_progress\"" + (ticket.status === "in_progress" ? " selected" : "") + ">Sedang ditangani</option><option value=\"resolved\"" + (ticket.status === "resolved" ? " selected" : "") + ">Selesai</option></select></label><label>Balasan<textarea data-ticket-response rows=\"3\" maxlength=\"5000\">" + esc(ticket.admin_response || "") + "</textarea></label><button class=\"btn\" type=\"button\" data-save-ticket=\""+ ticket.ticket_id +"\">Simpan tindak lanjut</button></article>";
      }).join("") : "<p>Belum ada laporan atau permintaan bantuan.</p>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadAnnouncements() {
    request("/api/admin/announcements").then(function (data) {
      $("announcements-list").innerHTML = data.announcements.length ? data.announcements.map(function (item) {
        return "<article class=\"support-card\" data-announcement=\"" + item.announcement_id + "\"><div class=\"section-heading\"><div><p class=\"eyebrow\">" + esc(item.kind) + " · " + (item.published ? "Terbit" : "Disembunyikan") + "</p><h3>" + esc(item.title) + "</h3></div></div><p>" + esc(item.message).replace(/\n/g, "<br>") + "</p><p class=\"muted\">Mulai: " + esc(date(item.starts_at)) + " · Selesai: " + esc(date(item.ends_at)) + "</p><div class=\"history-actions\"><button class=\"btn ghost\" type=\"button\" data-edit-announcement=\"" + item.announcement_id + "\">Edit</button><button class=\"btn ghost\" type=\"button\" data-publish-announcement=\"" + item.announcement_id + "\" data-published=\"" + (!item.published) + "\">" + (item.published ? "Sembunyikan" : "Terbitkan") + "</button><button class=\"btn ghost\" type=\"button\" data-delete-announcement=\"" + item.announcement_id + "\">Hapus</button></div></article>";
      }).join("") : "<p>Belum ada pengumuman.</p>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadAudit() {
    request("/api/admin/audit?limit=100").then(function (data) {
      $("audit-list").innerHTML = data.logs.length ? "<table><thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Target</th><th>Detail</th></tr></thead><tbody>" +
        data.logs.map(function (log) {
          return "<tr><td>" + esc(date(log.created_at)) + "</td><td>" + esc(log.email) + "</td><td>" + esc(log.action) + "</td><td>" + esc(log.target) + "</td><td class=\"audit-details\">" + esc(log.details || "—") + "</td></tr>";
        }).join("") + "</tbody></table>" : "<p>Belum ada aktivitas admin.</p>";
    }).catch(function (error) { notify(error.message, true); });
  }
  function loadAll() {
    loadDashboard();
    loadUsers("");
    loadJobs();
    loadSupport();
    if (isSuperAdmin) {
      loadOperations();
      loadPayments();
      loadAnnouncements();
      loadAudit();
    }
  }
  function initControls() {
    $("usage-days").addEventListener("change", loadDashboard);
    var timer;
    $("users-search").addEventListener("input", function (event) {
      clearTimeout(timer);
      timer = setTimeout(function () { loadUsers(event.target.value.trim()); }, 250);
    });
    $("limits-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var form = event.currentTarget, body = {};
      ["free_daily_quota", "premium_daily_quota", "free_max_file_mb", "premium_max_file_mb"].forEach(function (key) {
        body[key] = Number(form.elements[key].value);
      });
      bindAction(form.querySelector("button[type=submit]"), function () {
        return request("/api/admin/settings", { method: "PATCH", body: JSON.stringify(body) }).then(function () {
          notify("Kuota dan batas ukuran berhasil diperbarui.", false);
          loadOperations();
        });
      });
    });
    $("features-list").addEventListener("click", function (event) {
      var button = event.target.closest("[data-feature]");
      if (!button) return;
      bindAction(button, function () {
        return request("/api/admin/features/" + encodeURIComponent(button.dataset.feature), {
          method: "PATCH", body: JSON.stringify({ enabled: button.dataset.enabled === "true" }),
        }).then(function () { notify("Status tool diperbarui.", false); loadOperations(); });
      });
    });
    $("admin-plans-list").addEventListener("click", function (event) {
      var button = event.target.closest("[data-save-plan]");
      if (!button) return;
      var row = button.closest("[data-plan-row]"), planId = button.dataset.savePlan;
      var price = Number(row.querySelector("[data-plan-price]").value);
      bindAction(button, function () {
        return request("/api/admin/plans/" + encodeURIComponent(planId), {
          method: "PATCH",
          body: JSON.stringify({
            name: row.querySelector("[data-plan-name]").value,
            price: price,
            active: row.querySelector("[data-plan-active]").checked,
            features: row.querySelector("[data-plan-features]").value.split(",").map(function (item) { return item.trim(); }).filter(Boolean),
          }),
        }).then(function () { notify("Paket dan harga berhasil diperbarui.", false); loadOperations(); });
      });
    });
    $("users-list").addEventListener("click", function (event) {
      var detailButton = event.target.closest("[data-user-detail]");
      var statusButton = event.target.closest("[data-user-status]");
      var subscriptionButton = event.target.closest("[data-user-subscription]");
      var notificationButton = event.target.closest("[data-user-notifications]");
      var deleteButton = event.target.closest("[data-user-delete]");
      if (detailButton) loadUserDetails(detailButton.dataset.userDetail);
      if (statusButton) {
        bindAction(statusButton, function () {
          return request("/api/admin/users/" + statusButton.dataset.userStatus, {
            method: "PATCH", body: JSON.stringify({ status: statusButton.dataset.status }),
          }).then(function () { notify("Status akun berhasil diperbarui.", false); loadUsers($("users-search").value.trim()); });
        });
      }
      if (notificationButton) {
        bindAction(notificationButton, function () {
          return request("/api/admin/users/" + notificationButton.dataset.userNotifications, {
            method: "PATCH",
            body: JSON.stringify({ email_notifications: notificationButton.dataset.enabled === "true" }),
          }).then(function () {
            notify("Preferensi email akun diperbarui.", false);
            loadUsers($("users-search").value.trim());
          });
        });
      }
      if (deleteButton && window.confirm(
        "Hapus akun " + deleteButton.dataset.userName + " secara permanen? Identitas, riwayat, tiket, notifikasi, dan file akan dihapus; transaksi disimpan tanpa identitas."
      )) {
        bindAction(deleteButton, function () {
          return request("/api/admin/users/" + deleteButton.dataset.userDelete, { method: "DELETE" })
            .then(function () {
              notify("Akun dan data personal dihapus; catatan pembayaran dianonimkan.", false);
              loadUsers($("users-search").value.trim());
              loadDashboard();
            });
        });
      }
      if (subscriptionButton) {
        var body = { status: subscriptionButton.dataset.status };
        if (body.status === "active") body.plan_id = "premium_monthly";
        bindAction(subscriptionButton, function () {
          return request("/api/admin/subscriptions/" + subscriptionButton.dataset.userSubscription, {
            method: "PATCH", body: JSON.stringify(body),
          }).then(function () { notify("Status langganan berhasil diperbarui.", false); loadUsers($("users-search").value.trim()); });
        });
        $("user-detail-close").addEventListener("click", function () { $("user-detail-dialog").close(); });
        $("user-notification-form").addEventListener("submit", function (event) {
          event.preventDefault();
          var form = event.currentTarget, button = form.querySelector("button[type=submit]");
          var userId = form.elements.user_id.value;
          bindAction(button, function () {
            return request("/api/admin/users/" + encodeURIComponent(userId) + "/notifications", {
              method: "POST",
              body: JSON.stringify({
                kind: form.elements.kind.value, title: form.elements.title.value, message: form.elements.message.value,
              }),
            }).then(function (result) {
              form.reset();
              var status = result.email_status;
              if (status === "sent") {
                $("user-notification-delivery").textContent = "Notifikasi disimpan dan email berhasil dikirim.";
                notify(result.message + " Email berhasil dikirim.", false);
              } else if (status === "failed") {
                $("user-notification-delivery").textContent = result.email_error || "Email gagal dikirim. Periksa konfigurasi SMTP.";
                notify("Notifikasi tersimpan di dashboard, tetapi email gagal dikirim. " + (result.email_error || ""), true);
              } else if (status === "not_configured") {
                $("user-notification-delivery").textContent = "Notifikasi tersimpan, tetapi SMTP belum dikonfigurasi.";
                notify("Notifikasi tersimpan di dashboard user; email tidak terkirim karena SMTP belum dikonfigurasi.", true);
              } else {
                $("user-notification-delivery").textContent = "Notifikasi tersimpan; email tidak dikirim karena preferensi email nonaktif atau email belum terverifikasi.";
                notify("Notifikasi tersimpan di dashboard user. Email tidak dikirim karena akun belum terverifikasi atau notifikasi email nonaktif.", false);
              }
              loadUserDetails(userId);
              loadUsers($("users-search").value.trim());
            });
          });
        });
      }
    });
    $("jobs-list").addEventListener("click", function (event) {
      var button = event.target.closest("[data-cancel-job]");
      if (!button) return;
      bindAction(button, function () {
        return request("/api/admin/jobs/" + encodeURIComponent(button.dataset.cancelJob), { method: "DELETE" })
          .then(function () { notify("Job dibatalkan.", false); loadJobs(); loadDashboard(); });
      });
    });
    $("admin-payments-list").addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (link && !/^https:\/\/app(?:\.sandbox)?\.midtrans\.com\//i.test(link.href)) {
        event.preventDefault();
        notify("Tautan pembayaran tidak mengarah ke halaman Midtrans yang aman.", true);
      }
    });
    $("admin-support-list").addEventListener("click", function (event) {
      var button = event.target.closest("[data-save-ticket]");
      if (!button) return;
      var card = button.closest("[data-ticket]");
      bindAction(button, function () {
        return request("/api/admin/support/" + button.dataset.saveTicket, {
          method: "PATCH",
          body: JSON.stringify({
            status: card.querySelector("[data-ticket-status]").value,
            admin_response: card.querySelector("[data-ticket-response]").value,
          }),
        }).then(function (result) {
          if (result.email_status === "sent") notify("Tindak lanjut disimpan dan email user berhasil dikirim.", false);
          else if (result.email_status === "failed") notify("Tindak lanjut tersimpan, tetapi email user gagal dikirim. Periksa SMTP.", true);
          else if (result.email_status === "not_configured") notify("Tindak lanjut tersimpan; SMTP belum dikonfigurasi sehingga email tidak terkirim.", true);
          else notify("Tindak lanjut tersimpan. Email tidak dikirim karena preferensi user nonaktif atau email belum diverifikasi.", false);
          loadSupport();
        });
      });
    });
    var announcementForm = $("announcement-form");
    var resetAnnouncement = function () {
      announcementForm.reset();
      announcementForm.elements.announcement_id.value = "";
      $("announcement-submit").textContent = "Terbitkan pengumuman";
      $("announcement-reset").hidden = true;
    };
    $("announcement-reset").addEventListener("click", resetAnnouncement);
    announcementForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var form = event.currentTarget, id = form.elements.announcement_id.value;
      var startsAt = form.elements.starts_at.value ? new Date(form.elements.starts_at.value).getTime() / 1000 : null;
      var endsAt = form.elements.ends_at.value ? new Date(form.elements.ends_at.value).getTime() / 1000 : null;
      var body = {
        title: form.elements.title.value, message: form.elements.message.value,
        kind: form.elements.kind.value, published: form.elements.published.checked,
        starts_at: startsAt, ends_at: endsAt,
      };
      bindAction($("announcement-submit"), function () {
        return request(id ? "/api/admin/announcements/" + id : "/api/admin/announcements", {
          method: id ? "PATCH" : "POST", body: JSON.stringify(body),
        }).then(function () { resetAnnouncement(); notify("Pengumuman berhasil disimpan.", false); loadAnnouncements(); });
      });
    });
    $("announcements-list").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit-announcement]");
      var publish = event.target.closest("[data-publish-announcement]");
      var remove = event.target.closest("[data-delete-announcement]");
      if (edit) {
        var card = edit.closest("[data-announcement]");
        var itemId = edit.dataset.editAnnouncement;
        request("/api/admin/announcements").then(function (data) {
          var item = data.announcements.find(function (row) { return String(row.announcement_id) === itemId; });
          if (!item) throw new Error("Pengumuman tidak ditemukan.");
          var form = $("announcement-form");
          form.elements.announcement_id.value = item.announcement_id;
          form.elements.title.value = item.title;
          form.elements.message.value = item.message;
          form.elements.kind.value = item.kind;
          form.elements.published.checked = !!item.published;
          form.elements.starts_at.value = item.starts_at ? new Date(item.starts_at * 1000).toISOString().slice(0, 16) : "";
          form.elements.ends_at.value = item.ends_at ? new Date(item.ends_at * 1000).toISOString().slice(0, 16) : "";
          $("announcement-submit").textContent = "Simpan perubahan";
          $("announcement-reset").hidden = false;
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        }).catch(function (error) { notify(error.message, true); });
      }
      if (publish) {
        bindAction(publish, function () {
          return request("/api/admin/announcements/" + publish.dataset.publishAnnouncement, {
            method: "PATCH", body: JSON.stringify({ published: publish.dataset.published === "true" }),
          }).then(function () { notify("Status publikasi diperbarui.", false); loadAnnouncements(); });
        });
      }
      if (remove && window.confirm("Hapus pengumuman ini?")) {
        bindAction(remove, function () {
          return request("/api/admin/announcements/" + remove.dataset.deleteAnnouncement, { method: "DELETE" })
            .then(function () { notify("Pengumuman dihapus.", false); loadAnnouncements(); });
        });
      }
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    request("/api/auth/me").then(function (data) {
      if (!data.user) {
        location.href = "./akun.html";
        return;
      }
      if (data.user.role !== "admin" && data.user.role !== "superadmin") {
        location.href = "./profil.html";
        return;
      }
      isSuperAdmin = data.user.role === "superadmin";
      var roleNotice = $("admin-role-summary");
      if (roleNotice) {
        roleNotice.textContent = isSuperAdmin
          ? "Admin pusat · pemilik terverifikasi Google · seluruh pengaturan dan data"
          : "Admin bawahan · akses operasional terbatas · tanpa perubahan akun, pembayaran, paket, atau konfigurasi";
      }
      if (!isSuperAdmin) {
        ["admin-premium-stat", "admin-revenue-stat"].forEach(function (id) {
          var metric = $(id);
          if (metric) metric.hidden = true;
        });
        ["admin-tools", "admin-plans", "admin-payments", "admin-audit", "admin-announcements"].forEach(function (id) {
          var section = $(id);
          if (section) section.hidden = true;
        });
        Array.prototype.forEach.call(document.querySelectorAll(".admin-nav a"), function (link) {
          if (["#admin-tools", "#admin-plans", "#admin-payments", "#admin-audit", "#admin-announcements"].indexOf(link.getAttribute("href")) >= 0) {
            link.hidden = true;
          }
        });
        var detailDialog = $("user-detail-dialog");
        if (detailDialog) detailDialog.hidden = true;
      }
      initControls();
      loadAll();
    }).catch(function (error) {
      notify(error.message, true);
      location.href = "./akun.html";
    });
  });
})();
