const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Räume speichern
const rooms = new Map();

// Helper Functions
function generateRoomCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function getRoom(roomCode) {
    return rooms.get(roomCode);
}

function createRoom(roomCode, host) {
    const room = {
        code: roomCode,
        host: host.id,
        players: [host],
        gameState: 'lobby',
        scores: {},
        currentPlayerIndex: 0
    };
    
    rooms.set(roomCode, room);
    return room;
}

function addPlayerToRoom(roomCode, player) {
    const room = rooms.get(roomCode);
    if (room && room.players.length < 10) {
        room.players.push(player);
        room.scores[player.id] = 0;
        return room;
    }
    return null;
}

function removePlayerFromRoom(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (room) {
        room.players = room.players.filter(p => p.id !== playerId);
        delete room.scores[playerId];
        
        // Wenn Raum leer ist, lösche ihn
        if (room.players.length === 0) {
            rooms.delete(roomCode);
            return null;
        }
        
        // Wenn Host gegangen ist, neuer Host
        if (room.host === playerId && room.players.length > 0) {
            room.host = room.players[0].id;
        }
        
        return room;
    }
    return null;
}

function getNextPlayer(room) {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    return room.players[room.currentPlayerIndex];
}

io.on('connection', (socket) => {
    console.log('Neue Verbindung:', socket.id);

    socket.on('create_room', (data) => {
        const { username, maxPlayers } = data;
        
        // Überprüfe ob Spieler schon in einem Raum ist
        for (const [roomCode, room] of rooms) {
            if (room.players.find(p => p.id === socket.id)) {
                socket.emit('error', 'Du bist bereits in einem Raum');
                return;
            }
        }
        
        const roomCode = generateRoomCode();
        const player = {
            id: socket.id,
            username: username || `Spieler ${socket.id.slice(0, 4)}`,
            ready: false
        };
        
        const room = createRoom(roomCode, player);
        room.scores[socket.id] = 0;
        
        socket.join(roomCode);
        socket.roomCode = roomCode;
        
        socket.emit('room_created', {
            roomCode: roomCode,
            players: room.players
        });
        
        console.log(`Raum erstellt: ${roomCode} von ${username}`);
    });

    socket.on('join_room', (data) => {
        const { username, roomCode } = data;
        
        // Überprüfe ob Spieler schon in einem Raum ist
        for (const [code, room] of rooms) {
            if (room.players.find(p => p.id === socket.id)) {
                socket.emit('error', 'Du bist bereits in einem Raum');
                return;
            }
        }
        
        const room = getRoom(roomCode);
        if (!room) {
            socket.emit('error', 'Raum existiert nicht');
            return;
        }
        
        if (room.players.length >= 10) {
            socket.emit('error', 'Raum ist voll');
            return;
        }
        
        const player = {
            id: socket.id,
            username: username || `Spieler ${socket.id.slice(0, 4)}`,
            ready: false
        };
        
        const updatedRoom = addPlayerToRoom(roomCode, player);
        if (!updatedRoom) {
            socket.emit('error', 'Konnte Raum nicht beitreten');
            return;
        }
        
        socket.join(roomCode);
        socket.roomCode = roomCode;
        
        socket.emit('room_joined', {
            roomCode: roomCode,
            players: updatedRoom.players
        });
        
        // Benachrichtige andere Spieler
        socket.to(roomCode).emit('player_joined', player);
        
        console.log(`${username} ist Raum ${roomCode} beigetreten`);
    });

    socket.on('start_game', () => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room || room.host !== socket.id) {
            socket.emit('error', 'Nur der Host kann das Spiel starten');
            return;
        }
        
        if (room.players.length < 2) {
            socket.emit('error', 'Mindestens 2 Spieler benötigt');
            return;
        }
        
        room.gameState = 'playing';
        room.currentPlayerIndex = 0;
        
        // Initialisiere Scores
        room.players.forEach(player => {
            room.scores[player.id] = 0;
        });
        
        io.to(roomCode).emit('game_started', {
            players: room.players,
            scores: room.scores
        });
        
        // Starte erste Runde
        setTimeout(() => {
            startNextTurn(room);
        }, 3000);
        
        console.log(`Spiel gestartet in Raum ${roomCode}`);
    });

    socket.on('select_challenge', (data) => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room || room.gameState !== 'playing') return;
        
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer.id !== socket.id) return;
        
        const targetPlayer = room.players.find(p => p.id === data.targetPlayerId);
        
        const challenge = {
            type: data.type,
            text: data.challenge,
            difficulty: data.difficulty,
            targetPlayer: targetPlayer || null
        };
        
        io.to(roomCode).emit('challenge_selected', {
            challenge: challenge,
            player: currentPlayer,
            targetPlayer: targetPlayer
        });
    });

    socket.on('complete_challenge', () => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room || room.gameState !== 'playing') return;
        
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer.id !== socket.id) return;
        
        // Punkte vergeben
        room.scores[socket.id] = (room.scores[socket.id] || 0) + 25;
        
        io.to(roomCode).emit('challenge_completed', {
            player: currentPlayer,
            scores: room.scores
        });
        
        // Nächster Spieler
        setTimeout(() => {
            startNextTurn(room);
        }, 3000);
    });

    socket.on('skip_challenge', () => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room || room.gameState !== 'playing') return;
        
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer.id !== socket.id) return;
        
        // Punkte abziehen
        room.scores[socket.id] = Math.max(0, (room.scores[socket.id] || 0) - 10);
        
        io.to(roomCode).emit('challenge_skipped', {
            player: currentPlayer,
            scores: room.scores
        });
        
        // Nächster Spieler
        setTimeout(() => {
            startNextTurn(room);
        }, 3000);
    });

    socket.on('send_reaction', (data) => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room) return;
        
        io.to(roomCode).emit('reaction_added', {
            playerId: socket.id,
            reaction: data.emoji
        });
    });

    socket.on('chat_message', (data) => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        io.to(roomCode).emit('chat_message', {
            username: player.username,
            message: data.message
        });
    });

    socket.on('game_chat_message', (data) => {
        const roomCode = socket.roomCode;
        const room = getRoom(roomCode);
        
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        io.to(roomCode).emit('game_chat_message', {
            username: player.username,
            message: data.message
        });
    });

    socket.on('leave_room', () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;
        
        const room = removePlayerFromRoom(roomCode, socket.id);
        if (room) {
            socket.to(roomCode).emit('player_left', socket.id);
            io.to(roomCode).emit('players_updated', room.players);
        }
        
        socket.leave(roomCode);
        delete socket.roomCode;
        
        console.log(`${socket.id} hat Raum ${roomCode} verlassen`);
    });

    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;
        
        const room = removePlayerFromRoom(roomCode, socket.id);
        if (room) {
            io.to(roomCode).emit('player_left', socket.id);
            io.to(roomCode).emit('players_updated', room.players);
        }
        
        console.log(`${socket.id} hat die Verbindung getrennt`);
    });
});

function startNextTurn(room) {
    const nextPlayer = getNextPlayer(room);
    
    io.to(room.code).emit('turn_started', {
        player: nextPlayer
    });
    
    console.log(`Nächste Runde für ${nextPlayer.username} in Raum ${room.code}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
