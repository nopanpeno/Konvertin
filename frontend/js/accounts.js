(function () {
  "use strict";
  var api = (window.KONVERTIN && window.KONVERTIN.apiBase || "").replace(/\/$/, "");
  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character];
    });
  }
  function request(path, options) {
    options = options || {};
    options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    options.credentials = "same-origin";
    return fetch(api + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || "Permintaan gagal. Coba lagi.");
        return data;
      });
    });
  }
  function message(text, bad) {
    var element = $("account-message");
    if (!element) return;
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("err", !!bad);
  }
  function refreshNav(user) {
    var loginItem = $("account-login-item");
    var menuItem = $("account-menu-item");
    var summary = $("account-menu-name");
    if (loginItem) loginItem.hidden = !!user;
    if (menuItem) menuItem.hidden = !user;
    if (summary && user) summary.textContent = user.display_name;
    ["account-dashboard-link", "account-settings-link"].forEach(function (id) {
      var link = $(id);
      if (!link || !user) return;
      link.href = user.role === "admin" || user.role === "superadmin" ? link.dataset.adminHref : link.dataset.userHref;
    });
    var dashboard = $("account-dashboard-link");
    if (dashboard) dashboard.textContent = user && (user.role === "admin" || user.role === "superadmin") ? "Pusat admin" : "Dashboard";
    if ($("dashboard-email") && user) $("dashboard-email").textContent = user.email;
    if ($("dashboard-email-status") && user) {
      var verification = $("dashboard-email-status");
      verification.textContent = user.email_verified ? "Email terverifikasi" : "Email belum terverifikasi";
      verification.className = "status-pill " + (user.email_verified ? "good" : "bad");
    }
    if ($("account-history-link")) $("account-history-link").hidden = !user || user.role === "admin" || user.role === "superadmin";
  }
  function loadMe() {
    return request("/api/auth/me").then(function (data) {
      var user = data.user;
      refreshNav(user);
      if ($("account-signed-in")) {
        $("account-signed-in").hidden = !user;
        $("account-forms").hidden = !!user;
        if (user && $("welcome-name")) $("welcome-name").textContent = "Halo, " + user.display_name;
        if (user && $("signed-in-dashboard")) {
          $("signed-in-dashboard").href = user.role === "admin" || user.role === "superadmin" ? "./admin.html" : "./profil.html";
          $("signed-in-dashboard").textContent = user.role === "admin" || user.role === "superadmin" ? "Buka pusat admin" : "Buka dashboard";
        }
      }
      if (user && $("profile-form")) {
        $("profile-form").elements.display_name.value = user.display_name;
        $("profile-form").elements.email.value = user.email;
        if ($("profile-form").elements.phone) $("profile-form").elements.phone.value = user.phone || "";
      }
      return user;
    }).catch(function (error) {
      message(error.message, true);
      return null;
    });
  }
  window.konvertinCheckUsage = function (toolType, count) {
    return request("/api/usage/check?tool_type=" + encodeURIComponent(toolType) + "&count=" + encodeURIComponent(count || 1)).then(function (data) {
      if (!data.allowed) throw new Error("Kuota penggunaan tidak tersedia.");
      return data;
    });
  };
  window.konvertinRecordHistory = function (toolType) {
    return request("/api/history/browser", { method: "POST", body: JSON.stringify({ tool_type: toolType }) });
  };
  function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
  function bindAuthForm(id, path, success) {
    var form = $(id);
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type=submit]");
      button.disabled = true;
      request(path, { method: "POST", body: JSON.stringify(formObject(form)) }).then(function (data) {
        if (!data.user) {
          form.reset();
          message(data.message || success, false);
          button.disabled = false;
          return;
        }
        message(success, false);
        refreshNav(data.user);
        location.href = data.user.role === "admin" || data.user.role === "superadmin" ? "./admin.html" : "./profil.html";
      }).catch(function (error) {
        message(error.message, true);
        button.disabled = false;
      });
    });
  }
  function statusLabel(status) {
    return ({ queued: "Dalam antrean", processing: "Diproses", done: "Berhasil", failed: "Gagal",
      paid: "Lunas", pending: "Menunggu pembayaran", expired: "Kedaluwarsa", cancelled: "Dibatalkan",
      suspended: "Ditangguhkan", active: "Aktif", open: "Baru", in_progress: "Ditangani", resolved: "Selesai" })[status] || status;
  }
  function statusClass(status) {
    if (["done", "paid", "active", "resolved"].indexOf(status) >= 0) return "good";
    if (["failed", "expired", "cancelled", "suspended"].indexOf(status) >= 0) return "bad";
    return "pending";
  }
  function dateLabel(timestamp) {
    return timestamp ? new Date(timestamp * 1000).toLocaleString("id-ID") : "—";
  }
  function initHistory() {
    var list = $("history-list");
    if (!list) return;
    function render() {
      request("/api/history").then(function (data) {
        if (!data.history.length) {
          list.innerHTML = "<p>Belum ada riwayat. Setelah konversi, aktivitas akan muncul di sini.</p>";
          return;
        }
        list.innerHTML = "<div class=\"table-scroll\"><table><thead><tr><th>Tool</th><th>Diproses di</th><th>Status</th><th>Waktu</th><th>Hasil &amp; tindakan</th></tr></thead><tbody>" +
          data.history.map(function (row) {
            var tool = escapeHtml(String(row.tool_type).replace(/-/g, " "));
            var download = row.download_url ? "<a class=\"btn\" href=\"" + escapeHtml(api + row.download_url) + "\">Unduh ulang</a>" : "<span class=\"muted\">File tidak tersedia</span>";
            return "<tr><td>" + tool + "</td><td>" + (row.source === "browser" ? "Browser" : "Server") + "</td><td><span class=\"status-pill " + statusClass(row.status) + "\">" + escapeHtml(statusLabel(row.status)) + "</span></td><td>" + escapeHtml(dateLabel(row.created_at)) + "</td><td><div class=\"history-actions\">" + download + "<button class=\"btn ghost\" type=\"button\" data-delete-history=\"" + row.history_id + "\">Hapus</button></div></td></tr>";
          }).join("") + "</tbody></table></div>";
      }).catch(function (error) {
        list.textContent = error.message;
        message(error.message, true);
      });
    }
    list.addEventListener("click", function (event) {
      var button = event.target.closest("[data-delete-history]");
      if (!button) return;
      button.disabled = true;
      request("/api/history/" + encodeURIComponent(button.dataset.deleteHistory), { method: "DELETE" })
        .then(render).then(function () { message("Riwayat dihapus.", false); })
        .catch(function (error) { button.disabled = false; message(error.message, true); });
    });
    var clear = $("clear-history");
    if (clear) clear.addEventListener("click", function () {
      if (!window.confirm("Hapus semua riwayat dan file hasil server yang masih tersedia?")) return;
      clear.disabled = true;
      request("/api/history", { method: "DELETE" }).then(function () {
        message("Semua riwayat sudah dihapus.", false);
        render();
      }).catch(function (error) { message(error.message, true); })
        .then(function () { clear.disabled = false; });
    });
    render();
  }
  function rupiah(amount) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
  }
  function initUserDashboard(user) {
    var root = $("user-announcements");
    if (!root) return;
    $("dashboard-welcome").textContent = "Halo, " + user.display_name;
    $("dashboard-email").textContent = user.email;
    Promise.all([request("/api/account"), request("/api/billing/plans"), request("/api/support"), request("/api/history")]).then(function (results) {
      var data = results[0], billing = results[1], support = results[2];
      var account = data.account, quota = account.quota, subscription = account.subscription;
      $("account-plan-name").textContent = account.plan ? account.plan.name : "Free";
      $("account-plan-status").textContent = subscription ? "Aktif sampai " + dateLabel(subscription.ends_at) : "Paket gratis";
      $("account-quota-remaining").textContent = quota.remaining_today.toLocaleString("id-ID");
      $("account-quota-detail").textContent = quota.used_today.toLocaleString("id-ID") + " dari " + quota.daily_limit.toLocaleString("id-ID") + " penggunaan hari ini";
      $("account-file-limit").textContent = quota.max_file_mb + " MB";
      renderAnnouncements(root, data.announcements);
      renderUserNotifications(data.notifications || []);
      renderPlans(billing, account);
      renderPayments(account.payments);
      renderSupport(support.tickets);
      renderRecentHistory(results[3].history);
      var preferences = $("preferences-form");
      preferences.elements.email_notifications.checked = !!data.preferences.email_notifications;
      preferences.elements.product_updates.checked = !!data.preferences.product_updates;
      $("billing-status").textContent = billing.payment_enabled ? "Pembayaran Midtrans tersedia." : "Checkout belum aktif — Midtrans perlu dikonfigurasi admin.";
    }).catch(function (error) { message(error.message, true); });
  }
  function renderUserNotifications(notifications) {
    var container = $("user-notifications");
    if (!container) return;
    container.innerHTML = notifications.map(function (item) {
      return "<article class=\"announcement user-notification\" data-kind=\"" + escapeHtml(item.kind) + "\"><div class=\"section-heading\"><h3>" +
        escapeHtml(item.title) + "</h3><span class=\"status-pill " + (item.read_at ? "good" : "pending") + "\">" +
        (item.read_at ? "Dibaca" : "Baru") + "</span></div><p>" + escapeHtml(item.message).replace(/\n/g, "<br>") +
        "</p><p class=\"hint\">" + escapeHtml(dateLabel(item.created_at)) + "</p>" +
        (item.read_at ? "" : "<button class=\"btn ghost\" type=\"button\" data-read-notification=\"" + item.notification_id + "\">Tandai sudah dibaca</button>") +
        "</article>";
    }).join("");
  }
  function renderRecentHistory(history) {
    var container = $("recent-history");
    if (!container) return;
    if (!history.length) {
      container.innerHTML = "<p class=\"muted\">Belum ada konversi. <a href=\"./index.html#tool\">Mulai konversi</a>, aktivitasmu akan muncul di sini.</p>";
      return;
    }
    container.innerHTML = "<div class=\"table-scroll\"><table><thead><tr><th>Tool</th><th>Status</th><th>Waktu</th><th>Hasil</th></tr></thead><tbody>" +
      history.slice(0, 5).map(function (row) {
        var download = row.download_url
          ? "<a class=\"btn\" href=\"" + escapeHtml(api + row.download_url) + "\">Unduh ulang</a>"
          : "<span class=\"muted\">Tidak tersedia</span>";
        return "<tr><td>" + escapeHtml(String(row.tool_type).replace(/-/g, " ")) + "</td><td><span class=\"status-pill " + statusClass(row.status) + "\">" + escapeHtml(statusLabel(row.status)) + "</span></td><td>" + escapeHtml(dateLabel(row.created_at)) + "</td><td>" + download + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function renderAnnouncements(container, announcements) {
    container.innerHTML = announcements.map(function (item) {
      return "<article class=\"announcement\" data-kind=\"" + escapeHtml(item.kind) + "\"><h3>" + escapeHtml(item.title) + "</h3><p>" + escapeHtml(item.message).replace(/\n/g, "<br>") + "</p></article>";
    }).join("");
  }
  function renderPlans(data, account) {
    var container = $("plans-list");
    var currentId = account.plan ? account.plan.plan_id : "free";
    container.innerHTML = data.plans.map(function (plan) {
      var features = Array.isArray(plan.features) ? plan.features : [];
      var label = plan.interval === "year" ? "per tahun" : "per bulan";
      var current = plan.plan_id === currentId;
      var disabled = current || !data.payment_enabled || plan.price <= 0;
      var isFree = plan.plan_id === "free";
      var button = isFree
        ? "<span class=\"status-pill good\">Selalu gratis</span>"
        : plan.price <= 0
          ? "<span class=\"status-pill pending\">Harga segera tersedia</span>"
          : "<button class=\"btn " + (current ? "ghost" : "") + "\" type=\"button\" data-checkout=\"" + escapeHtml(plan.plan_id) + "\"" + (disabled ? " disabled" : "") + ">" + (current ? "Paket aktif" : "Bayar via Midtrans") + "</button>";
      var price = plan.price > 0 ? escapeHtml(rupiah(plan.price)) : isFree ? "Rp0" : "Harga segera tersedia";
      return "<article class=\"plan-card " + (current ? "current " : "") + (isFree ? "free" : "premium") + "\"><div class=\"plan-card-heading\"><p class=\"eyebrow\">" + escapeHtml(plan.name) + "</p>" + (current ? "<span class=\"status-pill good\">Paket aktif</span>" : "") + "</div><p class=\"price\">" + price + "</p><p class=\"muted\">" + label + "</p><ul>" + features.map(function (feature) { return "<li>" + escapeHtml(feature) + "</li>"; }).join("") + "</ul>" + button + "</article>";
    }).join("");
    container.onclick = function (event) {
      var button = event.target.closest("[data-checkout]");
      if (!button || button.disabled) return;
      button.disabled = true;
      request("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan_id: button.dataset.checkout }) })
        .then(function (result) { location.href = result.invoice_url; })
        .catch(function (error) { message(error.message, true); button.disabled = false; });
    };
  }
  function renderPayments(payments) {
    var container = $("payment-list");
    if (!payments.length) { container.innerHTML = "<p class=\"muted\">Belum ada transaksi.</p>"; return; }
    container.innerHTML = "<table><thead><tr><th>Tanggal</th><th>Provider</th><th>Nominal</th><th>Status</th><th>Invoice</th></tr></thead><tbody>" +
      payments.map(function (payment) {
        var invoice = payment.invoice_url ? "<a href=\"" + escapeHtml(payment.invoice_url) + "\" target=\"_blank\" rel=\"noopener\">Buka invoice ↗</a>" : "—";
        var provider = payment.provider === "midtrans" ? "Midtrans" : "Xendit (riwayat lama)";
        return "<tr><td>" + escapeHtml(dateLabel(payment.created_at)) + "</td><td>" + provider + "</td><td>" + escapeHtml(rupiah(payment.amount)) + "</td><td><span class=\"status-pill " + statusClass(payment.status) + "\">" + escapeHtml(statusLabel(payment.status)) + "</span></td><td>" + invoice + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function renderSupport(tickets) {
    var container = $("support-list");
    if (!tickets.length) { container.innerHTML = "<p class=\"muted\">Belum ada laporan bantuan.</p>"; return; }
    container.innerHTML = tickets.map(function (ticket) {
      return "<article class=\"support-card\"><h3>" + escapeHtml(ticket.subject) + "</h3><p class=\"muted\">" + escapeHtml(ticket.category) + " · " + escapeHtml(dateLabel(ticket.created_at)) + " · <span class=\"status-pill " + statusClass(ticket.status) + "\">" + escapeHtml(statusLabel(ticket.status)) + "</span></p><p>" + escapeHtml(ticket.message) + "</p>" + (ticket.admin_response ? "<p><strong>Balasan tim:</strong> " + escapeHtml(ticket.admin_response) + "</p>" : "") + "</article>";
    }).join("");
  }
  function initForms() {
    var profile = $("profile-form");
    if (profile) profile.addEventListener("submit", function (event) {
      event.preventDefault();
      request("/api/auth/profile", { method: "PATCH", body: JSON.stringify({
        display_name: profile.elements.display_name.value,
        phone: profile.elements.phone ? profile.elements.phone.value : "",
      }) })
        .then(function (data) {
          refreshNav(data.user);
          if ($("dashboard-welcome")) $("dashboard-welcome").textContent = "Halo, " + data.user.display_name;
          message("Profil berhasil disimpan.", false);
        })
        .catch(function (error) { message(error.message, true); });
    });
    var preferences = $("preferences-form");
    if (preferences) preferences.addEventListener("submit", function (event) {
      event.preventDefault();
      request("/api/account/preferences", { method: "PATCH", body: JSON.stringify({
        email_notifications: preferences.elements.email_notifications.checked,
        product_updates: preferences.elements.product_updates.checked,
      }) }).then(function () { message("Preferensi notifikasi disimpan.", false); })
        .catch(function (error) { message(error.message, true); });
    });
    var password = $("password-form");
    if (password) password.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = password.querySelector("button[type=submit]");
      button.disabled = true;
      request("/api/auth/password", { method: "PATCH", body: JSON.stringify({
        current_password: password.elements.current_password.value,
        new_password: password.elements.new_password.value,
      }) }).then(function (data) {
        password.reset();
        message(data.message || "Password berhasil diperbarui.", false);
      }).catch(function (error) {
        message(error.message, true);
      }).then(function () { button.disabled = false; });
    });
    var support = $("support-form");
    if (support) support.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = support.querySelector("button[type=submit]");
      button.disabled = true;
      request("/api/support", { method: "POST", body: JSON.stringify(formObject(support)) })
        .then(function () { support.reset(); message("Laporan berhasil dikirim.", false); return request("/api/support"); })
        .then(function (data) { renderSupport(data.tickets); })
        .catch(function (error) { message(error.message, true); })
        .then(function () { button.disabled = false; });
    });
    var resend = $("verification-resend-form");
    if (resend) resend.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = resend.querySelector("button[type=submit]");
      button.disabled = true;
      request("/api/auth/verification/resend", {
        method: "POST", body: JSON.stringify({ email: resend.elements.email.value }),
      }).then(function (data) { message(data.message, false); })
        .catch(function (error) { message(error.message, true); })
        .then(function () { button.disabled = false; });
    });
    var search = new URLSearchParams(location.search);
    if (search.get("verified") === "1") message("Email berhasil diverifikasi. Sekarang kamu bisa masuk.", false);
    if (search.get("logout") === "1") message("Kamu berhasil keluar dari akun.", false);

    document.addEventListener("click", function (event) {
      var logout = event.target.closest("[data-account-logout]");
      if (logout) {
        logout.disabled = true;
        request("/api/auth/logout", { method: "POST", cache: "no-store" }).then(function () {
          var loginLink = $("account-link");
          var accountUrl = loginLink
            ? new URL("./akun.html?logout=1", loginLink.href).href
            : new URL("./akun.html?logout=1", location.href).href;
          location.replace(accountUrl);
        }).catch(function (error) {
          message(error.message, true);
          logout.disabled = false;
        });
        return;
      }
      var readButton = event.target.closest("[data-read-notification]");
      if (!readButton) return;
      readButton.disabled = true;
      request("/api/notifications/" + encodeURIComponent(readButton.dataset.readNotification), { method: "PATCH" })
        .then(function () { return request("/api/notifications"); })
        .then(function (data) { renderUserNotifications(data.notifications); })
        .catch(function (error) { message(error.message, true); readButton.disabled = false; });
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    bindAuthForm("login-form", "/api/auth/login", "Berhasil masuk.");
    bindAuthForm("register-form", "/api/auth/register", "Akun berhasil dibuat.");
    initForms();
    loadMe().then(function (user) {
      if (($("user-announcements") || $("history-list")) && !user) {
        location.href = "./akun.html";
        return;
      }
      if (user && (user.role === "admin" || user.role === "superadmin") && ($("user-announcements") || $("history-list"))) {
        location.href = "./admin.html";
        return;
      }
      if ($("user-announcements") && user) initUserDashboard(user);
    });
    initHistory();
  });
})();
