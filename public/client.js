const socket = io();

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

socket.on("presence:count", ({ count }) => {
    if (presenceEl) presenceEl.textContent = `Conectados: ${count}`;
});

socket.on("board:notice", ({ type, message, actor }) => {
    const map = {
        join: "info",
        leave: "warn",
        create: "success",
        move: "info",
        rename: "info",
        "col-rename": "info",
        delete: "danger"
    };
    showToast(`${message} — por ${actor}`, map[type] || "info");
});

let BOARD = null;
let isTyping = false;

const boardEl = document.getElementById("board");
const columnTpl = document.getElementById("column-template");
const cardTpl = document.getElementById("card-template");


socket.on("board:state", (nextState) => {
    if (isTyping) return;
    BOARD = structuredClone(nextState);
    renderBoard();
});

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

        body.addEventListener("dragover", (e) => {
            e.preventDefault();
            body.classList.add("drag-over");
        });
        body.addEventListener("dragleave", () => {
            body.classList.remove("drag-over");
        });
        body.addEventListener("drop", (e) => {
            e.preventDefault();
            body.classList.remove("drag-over");
            const payload = JSON.parse(e.dataTransfer.getData("application/json"));
            const toColumnId = body.dataset.columnId;

            const children = Array.from(body.querySelectorAll(".card"));
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

        col.taskIds.forEach((taskId) => {
            const task = BOARD.tasks[taskId];
            if (!task) return;

            const $card = cardTpl.content.firstElementChild.cloneNode(true);
            $card.dataset.taskId = task.id;
            $card.draggable = true;

            $card.addEventListener("dragstart", (e) => {
                const data = {
                    taskId: task.id,
                    fromColumnId: col.id
                };
                e.dataTransfer.setData("application/json", JSON.stringify(data));
            });

            const titleInput = $card.querySelector(".card-title");
            const descInput = $card.querySelector(".card-desc");
            titleInput.value = task.title;
            descInput.value = task.description || "";

            const debounce = (fn, ms = 300) => {
                let t = null;
                return (...args) => {
                    clearTimeout(t);
                    t = setTimeout(() => fn(...args), ms);
                };
            };

            const commitUpdate = debounce(() => {
                socket.emit("task:update", {
                    taskId: task.id,
                    title: titleInput.value,
                    description: descInput.value
                });
                setTimeout(() => (isTyping = false), 500);
            }, 400);

            titleInput.addEventListener("input", () => {
                isTyping = true;
                commitUpdate();
            });
            descInput.addEventListener("input", () => {
                isTyping = true;
                commitUpdate();
            });


            $card.querySelector(".delete").addEventListener("click", () => {
                if (confirm("Excluir esta tarefa?")) {
                    socket.emit("task:delete", { taskId: task.id });
                }
            });

            body.appendChild($card);
        });

        boardEl.appendChild($col);
    });
}
