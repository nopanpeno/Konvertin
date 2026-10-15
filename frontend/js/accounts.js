(function () {
  "use strict";
  var api = (window.KONVERTIN && window.KONVERTIN.apiBase || "").replace(/\/$/, "");
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function message(text, bad) {
    var el = $("account-message");
    if (!el) return;
    el.hidden = !text; el.textContent = text || "";
    el.classList.toggle("err", !!bad);
  }
  function request(path, options) {
    options = options || {};
    options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    options.credentials = "same-origin";
    return fetch(api + path, options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || "Permintaan gagal. Coba lagi.");
        return data;
      });
    });
  }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
  function refreshNav(user) {
    var link = $("account-link");
    if (link) { link.textContent = user ? user.display_name : "Masuk"; link.href = user ? "./profil.html" : "./akun.html"; }
    ["profile-link-item", "history-link-item"].forEach(function (id) { if ($(id)) $(id).hidden = !user; });
    if ($("admin-link-item")) $("admin-link-item").hidden = !user || user.role !== "admin";
  }
  function loadMe() {
    return request("/api/auth/me").then(function (data) {
      var user = data.user;
      refreshNav(user);
      if ($("account-signed-in")) {
        $("account-signed-in").hidden = !user;
        $("account-forms").hidden = !!user;
        if (user && $("welcome-name")) $("welcome-name").textContent = "Halo, " + user.display_name;
      }
      if ($("profile-form")) {
        if (!user) { location.href = "./akun.html"; return user; }
        $("profile-form").elements.display_name.value = user.display_name;
        $("profile-form").elements.email.value = user.email;
      }
      return user;
    }).catch(function (e) { message(e.message, true); return null; });
  }
  window.konvertinRecordHistory = function (toolType) {
    request("/api/history/browser", { method: "POST", body: JSON.stringify({ tool_type: toolType }) }).catch(function () {});
  };
  function bindAuthForm(id, path, success) {
    var form = $(id);
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type=submit]"); button.disabled = true;
      request(path, { method: "POST", body: JSON.stringify(formData(form)) }).then(function (data) {
        message(success, false); refreshNav(data.user); location.href = "./profil.html";
      }).catch(function (e) { message(e.message, true); }).then(function () { button.disabled = false; });
    });
  }
  function initHistory() {
    var list = $("history-list"); if (!list) return;
    request("/api/history").then(function (data) {
      if (!data.history.length) { list.innerHTML = "<p>Belum ada riwayat. Riwayat browser tercatat setelah kamu masuk dan menyelesaikan konversi.</p>"; return; }
      list.innerHTML = "<div class=\"table-scroll\"><table><thead><tr><th>Tool</th><th>Lokasi proses</th><th>Status</th><th>Waktu</th></tr></thead><tbody>" + data.history.map(function (r) {
        return "<tr><td>" + escapeHtml(r.tool_type) + "</td><td>" + (r.source === "browser" ? "Browser" : "Server") + "</td><td>" + escapeHtml(r.status) + "</td><td>" + new Date(r.created_at * 1000).toLocaleString("id-ID") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    }).catch(function (e) { list.textContent = e.message; message(e.message, true); });
  }
  function drawUsage(data) {
    var canvas = $("usage-chart"); if (!canvas) return;
    var ctx = canvas.getContext("2d"), rows = data.daily || [], w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#f6f4ef"; ctx.fillRect(0, 0, w, h);
    var max = Math.max(1, ...rows.map(function (r) { return r.count; }));
    var step = w / Math.max(rows.length, 1), bar = Math.max(4, step * 0.62);
    rows.forEach(function (r, i) {
      var bh = (h - 48) * r.count / max, x = i * step + (step - bar) / 2;
      ctx.fillStyle = "#345eea"; ctx.fillRect(x, h - 30 - bh, bar, bh);
      if (rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0 || i === rows.length - 1) {
        ctx.fillStyle = "#343434"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(r.day.slice(5), x + bar / 2, h - 9);
      }
    });
    $("usage-total").textContent = "Total " + data.total + " konversi dalam " + data.days + " hari";
    var types = $("usage-types");
    types.innerHTML = data.types.length ? "<ul>" + data.types.map(function (r) { return "<li>" + escapeHtml(r.tool_type) + " — " + r.count + " kali</li>"; }).join("") + "</ul>" : "<p>Belum ada data penggunaan.</p>";
  }
  function initAdmin() {
    var select = $("usage-days"); if (!select) return;
    function load() { request("/api/admin/usage?days=" + select.value).then(drawUsage).catch(function (e) { message(e.message, true); }); }
    select.addEventListener("change", load); load();
  }
  document.addEventListener("DOMContentLoaded", function () {
    loadMe();
    bindAuthForm("login-form", "/api/auth/login", "Berhasil masuk.");
    bindAuthForm("register-form", "/api/auth/register", "Akun berhasil dibuat.");
    if ($("profile-form")) $("profile-form").addEventListener("submit", function (e) {
      e.preventDefault(); request("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ display_name: $("profile-form").elements.display_name.value }) })
        .then(function (d) { refreshNav(d.user); message("Profil berhasil disimpan.", false); })
        .catch(function (err) { message(err.message, true); });
    });
    if ($("logout-button")) $("logout-button").addEventListener("click", function () {
      request("/api/auth/logout", { method: "POST" }).then(function () { location.href = "./akun.html"; }).catch(function (e) { message(e.message, true); });
    });
    initHistory(); initAdmin();
  });
})();
