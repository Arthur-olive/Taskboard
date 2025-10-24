import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuid } from "uuid";

const adjectives = ["Ágil","Bravo","Calmo","Denso","Épico","Forte","Guerreiro","Hábil","Íntegro","Justo"];
const animals    = ["Lobo","Tigre","Falcão","Onça","Raposa","Coruja","Puma","Tubarão","Águia","Lontra"];
function nickFromId(id) {
    const a = adjectives[id.charCodeAt(0) % adjectives.length];
    const b = animals[id.charCodeAt(1) % animals.length];
    return `${a} ${b}`;
}

let connected = 0;
function broadcastPresence(io) {
    io.emit("presence:count", { count: connected });
}
function broadcastNotice(io, payload) {
    io.emit("board:notice", { at: Date.now(), ...payload });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const state = {
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

io.on("connection", (socket) => {
    const actor = nickFromId(socket.id);
    connected++;
    broadcastPresence(io);
    broadcastNotice(io, { type: "join", actor, message: `${actor} entrou no board` });

    socket.emit("board:state", state);


    socket.on("task:create", ({ columnId, title, description }) => {
        const id = uuid();
        state.tasks[id] = { id, title: title?.trim() || "Nova tarefa", description: description || "" };
        const col = state.columns.find(c => c.id === columnId) ?? state.columns[0];
        col.taskIds.push(id);
        emitState();
        broadcastNotice(io, { type: "create", actor, message: `Nova tarefa “${state.tasks[id].title}”` , meta: { taskId: id, columnId: col.id }});
    });

    socket.on("task:move", ({ taskId, fromColumnId, toColumnId, toIndex }) => {
        const fromCol = state.columns.find(c => c.id === fromColumnId);
        const toCol   = state.columns.find(c => c.id === toColumnId);
        if (!fromCol || !toCol) return;
        fromCol.taskIds = fromCol.taskIds.filter(id => id !== taskId);
        const idx = Number.isInteger(toIndex) ? Math.max(0, Math.min(toIndex, toCol.taskIds.length)) : toCol.taskIds.length;
        toCol.taskIds.splice(idx, 0, taskId);
        emitState();
        const t = state.tasks[taskId];
        broadcastNotice(io, { type: "move", actor, message: `“${t?.title || taskId}” movida para ${toCol.title}`, meta: { taskId, toColumnId }});
    });

    socket.on("task:update", ({ taskId, title, description }) => {
        const t = state.tasks[taskId];
        if (!t) return;
        const oldTitle = t.title;
        if (typeof title === "string") t.title = title.trim() || t.title;
        if (typeof description === "string") t.description = description;
        emitState();
        if (title && title.trim() && title.trim() !== oldTitle) {
            broadcastNotice(io, { type: "rename", actor, message: `“${oldTitle}” agora é “${t.title}”`, meta: { taskId }});
        }
    });

    socket.on("task:delete", ({ taskId }) => {
        const t = state.tasks[taskId];
        if (!t) return;
        const title = t.title;
        delete state.tasks[taskId];
        state.columns.forEach(c => (c.taskIds = c.taskIds.filter(id => id !== taskId)));
        emitState();
        broadcastNotice(io, { type: "delete", actor, message: `Tarefa “${title}” excluída`, meta: { taskId }});
    });

    socket.on("column:rename", ({ columnId, title }) => {
        const col = state.columns.find(c => c.id === columnId);
        if (!col) return;
        const old = col.title;
        if (typeof title === "string") col.title = title.trim() || col.title;
        emitState();
        if (old !== col.title) {
            broadcastNotice(io, { type: "col-rename", actor, message: `Coluna “${old}” → “${col.title}”`, meta: { columnId }});
        }
    });

    socket.on("disconnect", () => {
        connected--;
        broadcastPresence(io);
        broadcastNotice(io, { type: "leave", actor, message: `${actor} saiu` });
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Kanban em tempo real disponível em http://localhost:${PORT}`);
});
