(function () {
  const STORAGE_KEY = "dit_admin_messages";
  let currentUser = null;
  try {
    currentUser = JSON.parse(sessionStorage.getItem("loggedInUser") || "null");
  } catch (error) {}

  const isAdmin = currentUser && (currentUser.role === "Admin" || currentUser.role === "Administrator");

  function getMessages() {
    try {
      const messages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(messages) ? messages : [];
    } catch (error) {
      return [];
    }
  }

  function addStyles() {
    if (document.getElementById("adminMessagesStyles")) return;
    const style = document.createElement("style");
    style.id = "adminMessagesStyles";
    style.textContent = `
      .admin-message-modal { position: fixed; inset: 0; z-index: 12000; display: none; align-items: center; justify-content: center; padding: 20px; background: rgba(15, 23, 42, .58); }
      .admin-message-modal.is-open { display: flex; }
      .admin-message-panel { width: min(560px, 100%); max-height: min(80vh, 720px); overflow: auto; background: #fff; color: #172033; border-radius: 10px; box-shadow: 0 24px 70px rgba(0,0,0,.24); padding: 24px; }
      .admin-message-panel h2 { margin: 0 36px 6px 0; font-size: 1.25rem; }
      .admin-message-panel p { margin: 0 0 18px; color: #667085; }
      .admin-message-panel textarea { width: 100%; min-height: 140px; resize: vertical; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; font: inherit; color: inherit; }
      .admin-message-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .admin-message-actions button, .admin-message-close { border: 0; border-radius: 5px; padding: 9px 14px; font: inherit; cursor: pointer; }
      .admin-message-send { background: #087f5b; color: #fff; font-weight: 600; }
      .admin-message-cancel, .admin-message-read { background: #eef2f6; color: #263244; }
      .admin-message-close { position: absolute; top: 16px; right: 16px; padding: 6px 10px; background: transparent; color: #475467; font-size: 1.4rem; }
      .admin-message-panel { position: relative; }
      .admin-message-list { display: grid; gap: 10px; }
      .admin-message-item { border: 1px solid #e2e8f0; border-left: 3px solid #94a3b8; border-radius: 6px; padding: 12px; }
      .admin-message-item.is-unread { border-left-color: #087f5b; background: #f4fbf8; }
      .admin-message-meta { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; color: #667085; font-size: .82rem; }
      .admin-message-sender { color: #172033; font-weight: 700; }
      .admin-message-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
      .admin-message-item .admin-message-read { margin-top: 10px; padding: 6px 10px; font-size: .82rem; }
      .admin-message-empty { padding: 24px 8px; text-align: center; color: #667085; }
      .admin-inbox-button { position: relative; display: inline-grid; place-items: center; width: 42px; height: 42px; margin-right: 12px; border: 1px solid var(--border, #dce2e8); border-radius: 8px; background: var(--bg-secondary, #fff); color: var(--fg, #172033); cursor: pointer; }
      .admin-inbox-button svg { width: 20px; height: 20px; }
      .admin-inbox-count { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 10px; background: #d94841; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }
      .admin-inbox-count[hidden] { display: none; }
      @media (max-width: 520px) { .admin-message-panel { padding: 18px; } .admin-message-meta { flex-direction: column; gap: 2px; } }
    `;
    document.head.appendChild(style);
  }

  function createModal(title, description) {
    const overlay = document.createElement("div");
    overlay.className = "admin-message-modal";
    overlay.setAttribute("role", "presentation");
    const panel = document.createElement("section");
    panel.className = "admin-message-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "admin-message-close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "×";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const intro = document.createElement("p");
    intro.textContent = description;
    panel.append(closeButton, heading, intro);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove("is-open");
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    return { overlay, panel, close };
  }

  function initializeUserComposer() {
    const menu = document.getElementById("navDropdownMenu");
    if (!menu || isAdmin || menu.querySelector("[data-message-admin]") || !currentUser) return;

    addStyles();
    const action = document.createElement("button");
    action.type = "button";
    action.className = "nav-dropdown-item";
    action.dataset.messageAdmin = "true";
    action.textContent = "Message Admin";
    const adminPanelLink = document.getElementById("adminPanelNavItem");
    const divider = menu.querySelector(".nav-dropdown-divider");
    menu.insertBefore(action, adminPanelLink || divider || null);

    const modal = createModal("Message Admin", "Send a message to the system administrator.");
    const form = document.createElement("form");
    const textarea = document.createElement("textarea");
    textarea.name = "message";
    textarea.maxLength = 2000;
    textarea.required = true;
    textarea.placeholder = "Write your message...";
    textarea.setAttribute("aria-label", "Your message");
    const actions = document.createElement("div");
    actions.className = "admin-message-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "admin-message-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", modal.close);
    const send = document.createElement("button");
    send.type = "submit";
    send.className = "admin-message-send";
    send.textContent = "Send message";
    actions.append(cancel, send);
    form.append(textarea, actions);
    modal.panel.appendChild(form);

    action.addEventListener("click", () => {
      textarea.value = "";
      modal.overlay.classList.add("is-open");
      textarea.focus();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const message = textarea.value.trim();
      if (!message) return;
      const sender = currentUser.fullName || currentUser.username || currentUser.email || "User";
      const messages = getMessages();
      messages.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sender,
        email: currentUser.email || "",
        message,
        createdAt: new Date().toISOString(),
        read: false
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
        modal.close();
      } catch (error) {
        window.alert("The message could not be saved. Please try again.");
      }
    });
  }

  function initializeAdminInbox() {
    const isDashboard = window.location.pathname.toLowerCase().endsWith("/dashboard.html");
    if (!isDashboard || !document.querySelector(".header-right") || !isAdmin) return;
    addStyles();
    const header = document.querySelector(".header-right");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-inbox-button";
    button.setAttribute("aria-label", "View user messages");
    button.title = "User messages";
    button.innerHTML = '<i class="fa-regular fa-bell" aria-hidden="true"></i><span class="admin-inbox-count" hidden></span>';
    header.insertBefore(button, header.querySelector(".logout-btn") || null);

    const modal = createModal("Messages from users", "Messages sent from the module navigation menus.");
    const list = document.createElement("div");
    list.className = "admin-message-list";
    modal.panel.appendChild(list);

    function renderMessages() {
      const messages = getMessages().sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
      const unreadCount = messages.filter((message) => !message.read).length;
      const badge = button.querySelector(".admin-inbox-count");
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      badge.hidden = unreadCount === 0;
      list.replaceChildren();
      if (!messages.length) {
        const empty = document.createElement("div");
        empty.className = "admin-message-empty";
        empty.textContent = "No messages yet.";
        list.appendChild(empty);
        return;
      }
      messages.forEach((message) => {
        const item = document.createElement("article");
        item.className = `admin-message-item${message.read ? "" : " is-unread"}`;
        const meta = document.createElement("div");
        meta.className = "admin-message-meta";
        const sender = document.createElement("span");
        sender.className = "admin-message-sender";
        sender.textContent = message.sender || "User";
        const date = document.createElement("time");
        date.dateTime = message.createdAt || "";
        const parsedDate = new Date(message.createdAt);
        date.textContent = Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toLocaleString();
        meta.append(sender, date);
        item.appendChild(meta);
        if (message.email) {
          const email = document.createElement("div");
          email.className = "admin-message-meta";
          email.textContent = message.email;
          item.appendChild(email);
        }
        const body = document.createElement("div");
        body.className = "admin-message-body";
        body.textContent = message.message || "";
        item.appendChild(body);
        if (!message.read) {
          const markRead = document.createElement("button");
          markRead.type = "button";
          markRead.className = "admin-message-read";
          markRead.textContent = "Mark as read";
          markRead.addEventListener("click", () => {
            const updated = getMessages().map((entry) => entry.id === message.id ? { ...entry, read: true } : entry);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            renderMessages();
          });
          item.appendChild(markRead);
        }
        list.appendChild(item);
      });
    }

    button.addEventListener("click", () => {
      renderMessages();
      modal.overlay.classList.add("is-open");
    });
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) renderMessages();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") modal.close();
    });
    renderMessages();
  }

  initializeUserComposer();
  initializeAdminInbox();
})();