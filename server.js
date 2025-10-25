import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuid } from "uuid";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

function tstamp() {
    try {
        return new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Fortaleza",
            hour12: false,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date());
    } catch {
        return new Date().toISOString();
    }
}
function log(...args) {
    console.log(`[${tstamp()}]`, ...args);
}

let state = {
    columns: [
        { id: "todo",  title: "A Fazer",   taskIds: [] },
        { id: "doing", title: "Fazendo",   taskIds: [] },
        { id: "done",  title: "Concluído", taskIds: [] }
    ],
    tasks: {}
};
function emitState() {
    io.emit("board:state", state);
}

const adjectives = ["Ágil","Bravo","Calmo","Denso","Épico","Forte","Guerreiro","Hábil","Íntegro","Justo"];
const animals    = ["Lobo","Tigre","Falcão","Onça","Raposa","Coruja","Puma","Tubarão","Águia","Lontra"];
function nickFromId(id) {
    const a = adjectives[id.charCodeAt(0) % adjectives.length];
    const b = animals[id.charCodeAt(1) % animals.length];
    return `${a} ${b}`;
}

let connected = 0;
function broadcastPresence() {
    io.emit("presence:count", { count: connected });
}
function broadcastNotice(payload) {
    io.emit("board:notice", { at: Date.now(), ...payload });
}

const CHAT_MAX = 100;
let chat = [];

io.on("connection", (socket) => {
    const actor = nickFromId(socket.id);
    connected++;
    broadcastPresence();
    broadcastNotice({ type: "join", actor, message: `${actor} entrou no board` });
    log(`🟢 CONECTOU | ${actor} (${socket.id}) — conectados: ${connected}`);

    socket.emit("board:state", state);
    socket.emit("chat:history", chat);

    socket.on("task:create", ({ columnId, title, description }) => {
        const id = uuid();
        const safeTitle = (title || "Nova tarefa").trim();
        state.tasks[id] = { id, title: safeTitle, description: description || "" };
        const col = state.columns.find(c => c.id === columnId) ?? state.columns[0];
        col.taskIds.push(id);
        emitState();
        broadcastNotice({ type: "create", actor, message: `Nova tarefa “${safeTitle}”`, meta: { taskId: id, columnId: col.id } });
        log(`➕ CRIOU TAREFA | ${actor} | [${id}] "${safeTitle}" em "${col.title}" (${col.id})`);
    });

    socket.on("task:move", ({ taskId, fromColumnId, toColumnId, toIndex }) => {
        const fromCol = state.columns.find(c => c.id === fromColumnId);
        const toCol   = state.columns.find(c => c.id === toColumnId);
        const t       = state.tasks[taskId];
        if (!fromCol || !toCol || !t) return;
        fromCol.taskIds = fromCol.taskIds.filter(id => id !== taskId);
        const idx = Number.isInteger(toIndex) ? Math.max(0, Math.min(toIndex, toCol.taskIds.length)) : toCol.taskIds.length;
        toCol.taskIds.splice(idx, 0, taskId);
        emitState();
        broadcastNotice({ type: "move", actor, message: `“${t.title}” movida para ${toCol.title}`, meta: { taskId, toColumnId } });
        log(`🔀 MOVEU TAREFA | ${actor} | [${taskId}] "${t.title}" — ${fromCol.title} -> ${toCol.title} @ ${idx}`);
    });

    socket.on("task:update", ({ taskId, title, description }) => {
        const t = state.tasks[taskId];
        if (!t) return;
        const prevTitle = t.title;
        const prevDesc  = t.description;
        if (typeof title === "string") t.title = title.trim() || t.title;
        if (typeof description === "string") t.description = description;
        emitState();
        if (prevTitle !== t.title) {
            broadcastNotice({ type: "rename", actor, message: `“${prevTitle}” agora é “${t.title}”`, meta: { taskId } });
        }
        const changed = [];
        if (prevTitle !== t.title) changed.push("título");
        if (prevDesc  !== t.description) changed.push("descrição");
        log(`✏️  EDITOU TAREFA | ${actor} | [${taskId}] "${t.title}" ${changed.length ? "— " + changed.join(" & ") : "(sem mudanças)"}`);
    });

    socket.on("task:delete", ({ taskId }) => {
        const t = state.tasks[taskId];
        if (!t) return;
        const title = t.title;
        delete state.tasks[taskId];
        state.columns.forEach(c => (c.taskIds = c.taskIds.filter(id => id !== taskId)));
        emitState();
        broadcastNotice({ type: "delete", actor, message: `Tarefa “${title}” excluída`, meta: { taskId } });
        log(`🗑️  EXCLUIU TAREFA | ${actor} | [${taskId}] "${title}"`);
    });

    socket.on("column:rename", ({ columnId, title }) => {
        const col = state.columns.find(c => c.id === columnId);
        if (!col) return;
        const old = col.title;
        if (typeof title === "string") col.title = title.trim() || col.title;
        emitState();
        if (old !== col.title) {
            broadcastNotice({ type: "col-rename", actor, message: `Coluna “${old}” → “${col.title}”`, meta: { columnId } });
            log(`🏷️  RENOMEOU COLUNA | ${actor} | (${columnId}) "${old}" -> "${col.title}"`);
        }
    });

    socket.on("chat:message", ({ user, text }) => {
        const safeUser = String(user || nickFromId(socket.id)).slice(0, 40);
        const safeText = String(text || "").trim().slice(0, 1000);
        if (!safeText) return;
        const msg = { id: uuid(), user: safeUser, text: safeText, ts: Date.now() };
        chat.push(msg);
        if (chat.length > CHAT_MAX) chat = chat.slice(-CHAT_MAX);
        io.emit("chat:message", msg);
        log(`💬 CHAT | ${safeUser}: ${safeText}`);
    });

    socket.on("disconnect", () => {
        connected--;
        broadcastPresence();
        broadcastNotice({ type: "leave", actor, message: `${actor} saiu` });
        log(`🔴 DESCONECTOU | ${actor} (${socket.id}) — conectados: ${connected}`);
    });
});

const DEFAULT_PORT = process.env.PORT || 3000;
server
    .listen(DEFAULT_PORT, () => {
        log(`🚀 Kanban em tempo real disponível em http://localhost:${DEFAULT_PORT}`);
    })
    .on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            log(`⚠️  Porta ${DEFAULT_PORT} ocupada. Tentando porta alternativa...`);
            server.listen(0, () => {
                const { port } = server.address();
                log(`✅ Servidor iniciado automaticamente na porta ${port}`);
            });
        } else {
            console.error(err);
        }
    });
