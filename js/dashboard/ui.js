// Shared UI helpers: toast, modal, simple DOM helpers.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class" || k === "className") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toast(message, type = "info", ms = 3200) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const t = el("div", { class: `toast ${type}` }, [message]);
  stack.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity 0.2s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 220);
  }, ms);
}

export function openModal({ title, bodyHtml, body, footer, onClose } = {}) {
  const root = document.getElementById("modal-root");
  if (!root) return null;
  root.innerHTML = "";

  const backdrop = el("div", { class: "modal-backdrop", onclick: (e) => {
    if (e.target === backdrop) close();
  }});
  const modal = el("div", { class: "modal" });
  const header = el("div", { class: "modal-header" }, [
    el("div", { class: "modal-title" }, title || ""),
    el("button", { class: "btn btn-ghost btn-xs", onclick: close, "aria-label": "Close" }, "\u2715"),
  ]);
  const bodyEl = el("div", { class: "modal-body" });
  if (bodyHtml) bodyEl.innerHTML = bodyHtml;
  if (body) bodyEl.appendChild(body);

  const footerEl = el("div", { class: "modal-footer" });
  if (Array.isArray(footer)) footer.forEach((f) => footerEl.appendChild(f));
  else if (footer) footerEl.appendChild(footer);

  modal.appendChild(header);
  modal.appendChild(bodyEl);
  if (footer) modal.appendChild(footerEl);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);

  function close() {
    root.innerHTML = "";
    if (typeof onClose === "function") onClose();
  }
  return { close, backdrop, modal, bodyEl, footerEl };
}

export function confirmDialog(message, { confirmText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title: "Confirm",
      body: el("div", {}, [message]),
      footer: [
        el("button", { class: "btn btn-secondary", onclick: () => { m.close(); resolve(false); } }, "Cancel"),
        el("button", {
          class: `btn ${danger ? "btn-danger" : "btn-primary"}`,
          onclick: () => { m.close(); resolve(true); },
        }, confirmText),
      ],
    });
  });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!Number.isFinite(d?.getTime?.())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtRelative(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (!Number.isFinite(diff)) return "—";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return fmtDate(iso);
}

export function initials(name = "", email = "") {
  const src = name || email || "?";
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function statusPill(status) {
  const map = {
    draft: "pill pill-draft",
    pending: "pill pill-pending",
    reviewing: "pill pill-reviewing",
    approved: "pill pill-approved",
    published: "pill pill-published",
    rejected: "pill pill-rejected",
  };
  const cls = map[status] || "pill pill-draft";
  return `<span class="${cls}">${esc(status || "draft")}</span>`;
}
