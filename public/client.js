const socket = io();

const collapsed = new Set(JSON.parse(localStorage.getItem("kanban.collapsed") || "[]"));
function saveCollapsed() {
    localStorage.setItem("kanban.collapsed", JSON.stringify([...collapsed]));
}

function autosizeTextarea(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
}

const presenceEl = document.getElementById("presence");
const toastsEl = document.getElementById("toasts");

function showToast(message, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    toastsEl.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
    }, 3500);
}

const NAME_KEY = "kanban.username";
const chatEl = document.getElementById("chat");
const chatToggleBtn = document.getElementById("chat-toggle");
const chatNameInput = document.getElementById("chat-name");
const chatSaveBtn = document.getElementById("chat-save");
const chatMsgsEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

let myName = localStorage.getItem(NAME_KEY) || `Usuário ${Math.floor(Math.random()*900)+100}`;
chatNameInput.value = myName;

chatSaveBtn.addEventListener("click", () => {
    const v = (chatNameInput.value || "").trim().slice(0, 40) || myName;
    myName = v;
    localStorage.setItem(NAME_KEY, myName);
    showToast("Nome atualizado para o chat.", "info");
});

chatToggleBtn.addEventListener("click", () => {
    chatEl.classList.toggle("minimized");
    chatToggleBtn.textContent = chatEl.classList.contains("minimized") ? "+" : "–";
});

function pushChatMessage({ user, text, ts }) {
    const wrap = document.createElement("div");
    wrap.className = "chat-message";
    const meta = document.createElement("div");
    meta.className = "meta";
    const date = new Date(ts || Date.now());
    const hh = String(date.getHours()).padStart(2,"0");
    const mm = String(date.getMinutes()).padStart(2,"0");
    meta.textContent = `${user} — ${hh}:${mm}`;
    const content = document.createElement("div");
    content.textContent = text;
    wrap.appendChild(meta);
    wrap.appendChild(content);
    chatMsgsEl.appendChild(wrap);
    chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
}

chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = (chatInput.value || "").trim();
    if (!text) return;
    socket.emit("chat:message", { user: myName, text });
    chatInput.value = "";
});

socket.on("presence:count", ({ count }) => {
    if (presenceEl) presenceEl.textContent = `Conectados: ${count}`;
});

socket.on("board:notice", ({ type, message, actor }) => {
    const map = { join: "info", leave: "warn", create: "success", move: "info", rename: "info", "col-rename": "info", delete: "danger" };
    showToast(`${message} — por ${actor}`, map[type] || "info");
});

let BOARD = null;
let isTyping = false;

const boardEl = document.getElementById("board");
const columnTpl = document.getElementById("column-template");
const cardTpl = document.getElementById("card-template");

socket.on("chat:history", (msgs) => {
    chatMsgsEl.innerHTML = "";
    (msgs || []).forEach(pushChatMessage);
});
socket.on("chat:message", (msg) => {
    pushChatMessage(msg);
});

socket.on("board:state", (nextState) => {
    if (isTyping) return;
    BOARD = structuredClone(nextState);
    renderBoard();
});

function makeDropzone(el, columnId, getBodyEl) {
    const onEnterOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { e.dataTransfer.dropEffect = "move"; } catch {}
        const body = getBodyEl();
        body?.classList.add("drag-over");
    };
    el.addEventListener("dragenter", onEnterOver);
    el.addEventListener("dragover", onEnterOver);
    el.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        const body = getBodyEl();
        body?.classList.remove("drag-over");
    });
    el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const body = getBodyEl();
        body?.classList.remove("drag-over");
        const json = e.dataTransfer.getData("application/json");
        if (!json) return;
        let payload;
        try { payload = JSON.parse(json); } catch { return; }
        const toColumnId = columnId;
        const children = Array.from(getBodyEl().querySelectorAll(".card"));
        let toIndex = children.length;
        for (let i = 0; i < children.length; i++) {
            const rect = children[i].getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                toIndex = i;
                break;
            }
        }
        socket.emit("task:move", {
            taskId: payload.taskId,
            fromColumnId: payload.fromColumnId,
            toColumnId,
            toIndex
        });
    });
}

function renderBoard() {
    boardEl.innerHTML = "";
    BOARD.columns.forEach((col) => {
        const $col = columnTpl.content.firstElementChild.cloneNode(true);
        const titleInput = $col.querySelector(".column-title");
        titleInput.value = col.title;
        titleInput.addEventListener("change", () => {
            socket.emit("column:rename", { columnId: col.id, title: titleInput.value });
        });
        $col.querySelector(".add-task").addEventListener("click", () => {
            const title = prompt("Título da tarefa:", "Nova tarefa");
            if (title === null) return;
            socket.emit("task:create", { columnId: col.id, title, description: "" });
        });
        const body = $col.querySelector(".column-body");
        body.dataset.columnId = col.id;
        makeDropzone(body, col.id, () => body);
        makeDropzone($col,  col.id, () => body);

        col.taskIds.forEach((taskId) => {
            const task = BOARD.tasks[taskId];
            if (!task) return;
            const $card = cardTpl.content.firstElementChild.cloneNode(true);
            $card.dataset.taskId = task.id;

            const handle = $card.querySelector(".drag-handle");
            if (handle) {
                handle.setAttribute("draggable", "true");
                handle.addEventListener("mousedown", (e) => e.preventDefault());
                handle.addEventListener("dragstart", (e) => {
                    try { e.dataTransfer.setData("text/plain", "drag"); } catch {}
                    e.dataTransfer.setData("application/json", JSON.stringify({ taskId: task.id, fromColumnId: col.id }));
                    try { e.dataTransfer.effectAllowed = "move"; } catch {}
                    $card.classList.add("dragging");
                });
                handle.addEventListener("dragend", () => $card.classList.remove("dragging"));
            }
            $card.setAttribute("draggable", "true");
            $card.addEventListener("dragstart", (e) => {
                if (e.target.closest("input, textarea, button")) { e.preventDefault(); return; }
                try { e.dataTransfer.setData("text/plain", "drag"); } catch {}
                e.dataTransfer.setData("application/json", JSON.stringify({ taskId: task.id, fromColumnId: col.id }));
                try { e.dataTransfer.effectAllowed = "move"; } catch {}
                $card.classList.add("dragging");
            });
            $card.addEventListener("dragend", () => $card.classList.remove("dragging"));

            const titleInput2 = $card.querySelector(".card-title");
            const descInput  = $card.querySelector(".card-desc");
            const toggleBtn  = $card.querySelector(".toggle-desc");

            titleInput2.value = task.title;
            descInput.value   = task.description || "";

            if (collapsed.has(task.id)) $card.classList.add("collapsed");
            toggleBtn.addEventListener("click", () => {
                $card.classList.toggle("collapsed");
                if ($card.classList.contains("collapsed")) {
                    collapsed.add(task.id);
                } else {
                    collapsed.delete(task.id);
                    autosizeTextarea(descInput);
                }
                saveCollapsed();
            });

            autosizeTextarea(descInput);
            descInput.addEventListener("input", () => autosizeTextarea(descInput));

            const debounce = (fn, ms = 400) => {
                let t = null;
                return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
            };
            const commitUpdate = debounce(() => {
                socket.emit("task:update", {
                    taskId: task.id,
                    title: titleInput2.value,
                    description: descInput.value
                });
                setTimeout(() => { isTyping = false; }, 300);
            }, 500);
            const markTyping = () => { isTyping = true; };

            titleInput2.addEventListener("input", () => { markTyping(); commitUpdate(); });
            descInput.addEventListener("input",      () => { markTyping(); commitUpdate(); });

            $card.querySelector(".delete").addEventListener("click", () => {
                if (confirm("Excluir esta tarefa?")) {
                    socket.emit("task:delete", { taskId: task.id });
                }
            });

            body.appendChild($card);
        });

        boardEl.appendChild($col);
    });
    boardEl.querySelectorAll(".card:not(.collapsed) .card-desc").forEach(autosizeTextarea);
}
