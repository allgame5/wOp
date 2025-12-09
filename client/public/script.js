class MultiplayerGame {
    constructor() {
        this.socket = null;
        this.username = '';
        this.roomCode = '';
        this.players = [];
        this.currentPlayer = null;
        this.isYourTurn = false;
        this.gameState = 'lobby'; // 'lobby', 'waiting', 'playing', 'voting', 'ended'
        this.currentChallenge = null;
        this.timer = null;
        this.timeLeft = 30;
        this.scores = {};
        
        this.challenges = this.generateChallenges();
        this.initialize();
    }

    initialize() {
        this.setupEventListeners();
        this.connectToServer();
    }

    connectToServer() {
        // Für Vercel: Verbinde mit deinem Serverless Endpoint
        const socketUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000' 
            : window.location.origin;
        
        this.socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Verbunden mit Server');
            this.showNotification('Mit Server verbunden', 'success');
        });

        this.socket.on('disconnect', () => {
            this.showNotification('Verbindung zum Server verloren', 'error');
        });

        this.socket.on('room_created', (data) => {
            this.roomCode = data.roomCode;
            this.showScreen('lobby-screen');
            this.updateRoomInfo();
            this.showNotification(`Raum erstellt: ${data.roomCode}`, 'success');
        });

        this.socket.on('room_joined', (data) => {
            this.roomCode = data.roomCode;
            this.players = data.players;
            this.showScreen('lobby-screen');
            this.updateRoomInfo();
            this.updatePlayerList();
            this.showNotification(`Raum ${data.roomCode} beigetreten`, 'success');
        });

        this.socket.on('player_joined', (player) => {
            this.players.push(player);
            this.updatePlayerList();
            this.addChatMessage(`${player.username} ist dem Raum beigetreten`, 'system');
            this.showNotification(`${player.username} ist beigetreten`, 'info');
        });

        this.socket.on('player_left', (playerId) => {
            this.players = this.players.filter(p => p.id !== playerId);
            this.updatePlayerList();
            this.addChatMessage('Ein Spieler hat den Raum verlassen', 'system');
        });

        this.socket.on('game_started', (data) => {
            this.gameState = 'playing';
            this.players = data.players;
            this.scores = data.scores;
            this.showScreen('game-screen');
            this.updateScoreboard();
            this.updatePlayerCards();
            this.showNotification('Spiel gestartet!', 'success');
        });

        this.socket.on('turn_started', (data) => {
            this.currentPlayer = data.player;
            this.isYourTurn = data.player.id === this.socket.id;
            this.updatePlayerCards();
            this.updateCurrentPlayer();
            
            if (this.isYourTurn) {
                this.enableChoiceButtons();
                this.showNotification('Du bist dran! Wähle Wahrheit oder Pflicht', 'info');
            } else {
                this.disableChoiceButtons();
            }
        });

        this.socket.on('challenge_selected', (data) => {
            this.currentChallenge = data.challenge;
            this.timeLeft = 30;
            this.updateChallengeDisplay();
            this.startTimer();
            
            if (data.targetPlayer && data.targetPlayer.id === this.socket.id) {
                this.showNotification('Du wurdest für diese Challenge ausgewählt!', 'warning');
            }
        });

        this.socket.on('challenge_completed', (data) => {
            this.scores = data.scores;
            this.updateScoreboard();
            this.updatePlayerCards();
            this.addGameChatMessage(`${data.player.username} hat die Challenge erledigt!`, 'system');
            this.clearChallenge();
        });

        this.socket.on('challenge_skipped', (data) => {
            this.scores = data.scores;
            this.updateScoreboard();
            this.updatePlayerCards();
            this.addGameChatMessage(`${data.player.username} hat die Challenge übersprungen`, 'system');
            this.clearChallenge();
        });

        this.socket.on('reaction_added', (data) => {
            this.addReactionToPlayer(data.playerId, data.reaction);
        });

        this.socket.on('chat_message', (data) => {
            this.addChatMessage(`${data.username}: ${data.message}`);
        });

        this.socket.on('game_chat_message', (data) => {
            this.addGameChatMessage(`${data.username}: ${data.message}`);
        });

        this.socket.on('error', (message) => {
            this.showNotification(message, 'error');
        });
    }

    setupEventListeners() {
        // Login Screen
        document.getElementById('create-room').addEventListener('click', () => this.createRoom());
        document.getElementById('join-room').addEventListener('click', () => this.showJoinRoom());
        document.getElementById('join-with-code').addEventListener('click', () => this.joinRoom());
        document.getElementById('back-to-main').addEventListener('click', () => this.hideJoinRoom());
        
        // Lobby Screen
        document.getElementById('copy-code').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('start-game').addEventListener('click', () => this.startGame());
        document.getElementById('leave-lobby').addEventListener('click', () => this.leaveRoom());
        document.getElementById('send-chat').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
        
        // Game Screen
        document.getElementById('truth-btn').addEventListener('click', () => this.selectTruth());
        document.getElementById('dare-btn').addEventListener('click', () => this.selectDare());
        document.getElementById('random-btn').addEventListener('click', () => this.selectRandom());
        document.getElementById('skip-btn').addEventListener('click', () => this.skipChallenge());
        document.getElementById('complete-btn').addEventListener('click', () => this.completeChallenge());
        document.getElementById('leave-game').addEventListener('click', () => this.leaveGame());
        document.getElementById('send-game-chat').addEventListener('click', () => this.sendGameChatMessage());
        document.getElementById('game-chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendGameChatMessage();
        });
        
        // Reaction buttons
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const emoji = e.target.dataset.emoji;
                this.sendReaction(emoji);
            });
        });
        
        // Username input
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createRoom();
        });
        document.getElementById('room-code').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
    }

    createRoom() {
        this.username = document.getElementById('username').value.trim();
        if (!this.username) {
            this.showNotification('Bitte gib einen Namen ein', 'error');
            return;
        }
        
        if (this.username.length < 2) {
            this.showNotification('Name muss mindestens 2 Zeichen lang sein', 'error');
            return;
        }
        
        this.socket.emit('create_room', {
            username: this.username,
            maxPlayers: 10
        });
    }

    showJoinRoom() {
        document.getElementById('room-selection').classList.remove('hidden');
        document.getElementById('create-room').style.display = 'none';
        document.getElementById('join-room').style.display = 'none';
    }

    hideJoinRoom() {
        document.getElementById('room-selection').classList.add('hidden');
        document.getElementById('create-room').style.display = 'inline-flex';
        document.getElementById('join-room').style.display = 'inline-flex';
    }

    joinRoom() {
        this.username = document.getElementById('username').value.trim();
        const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
        
        if (!this.username) {
            this.showNotification('Bitte gib einen Namen ein', 'error');
            return;
        }
        
        if (!roomCode || roomCode.length !== 6) {
            this.showNotification('Bitte gib einen gültigen 6-stelligen Raumcode ein', 'error');
            return;
        }
        
        this.socket.emit('join_room', {
            username: this.username,
            roomCode: roomCode
        });
    }

    startGame() {
        if (this.players.length < 2) {
            this.showNotification('Mindestens 2 Spieler benötigt', 'error');
            return;
        }
        
        this.socket.emit('start_game');
    }

    selectTruth() {
        if (!this.isYourTurn) return;
        
        const challenge = this.getRandomChallenge('truth');
        const targetPlayer = this.selectRandomPlayer();
        
        this.socket.emit('select_challenge', {
            type: 'truth',
            challenge: challenge.text,
            difficulty: challenge.difficulty,
            targetPlayerId: targetPlayer?.id
        });
        
        this.disableChoiceButtons();
    }

    selectDare() {
        if (!this.isYourTurn) return;
        
        const challenge = this.getRandomChallenge('dare');
        const targetPlayer = this.selectRandomPlayer();
        
        this.socket.emit('select_challenge', {
            type: 'dare',
            challenge: challenge.text,
            difficulty: challenge.difficulty,
            targetPlayerId: targetPlayer?.id
        });
        
        this.disableChoiceButtons();
    }

    selectRandom() {
        const types = ['truth', 'dare'];
        const randomType = types[Math.floor(Math.random() * types.length)];
        
        if (randomType === 'truth') {
            this.selectTruth();
        } else {
            this.selectDare();
        }
    }

    skipChallenge() {
        if (!this.isYourTurn) return;
        
        this.socket.emit('skip_challenge');
        this.clearChallenge();
    }

    completeChallenge() {
        if (!this.isYourTurn) return;
        
        this.socket.emit('complete_challenge');
        this.clearChallenge();
    }

    sendReaction(emoji) {
        this.socket.emit('send_reaction', { emoji });
    }

    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (message) {
            this.socket.emit('chat_message', { message });
            input.value = '';
        }
    }

    sendGameChatMessage() {
        const input = document.getElementById('game-chat-input');
        const message = input.value.trim();
        
        if (message) {
            this.socket.emit('game_chat_message', { message });
            input.value = '';
        }
    }

    leaveRoom() {
        this.socket.emit('leave_room');
        this.showScreen('login-screen');
        this.resetGame();
    }

    leaveGame() {
        this.socket.emit('leave_room');
        this.showScreen('login-screen');
        this.resetGame();
    }

    generateChallenges() {
        return {
            truth: {
                easy: [
                    "Was war dein peinlichster Moment?",
                    "Wem hast du zuletzt geschwindelt?",
                    "Was ist deine größte Angst?",
                    "Hast du jemals etwas gestohlen?",
                    "Was ist dein albernstes Talent?"
                ],
                medium: [
                    "Was ist dein peinlichstes Erlebnis mit einem Crush?",
                    "Hast du jemals für etwas wirklich Dummes geweint?",
                    "Was ist das Schlimmste, was du je getan hast?",
                    "Hast du jemals jemanden hintergangen?"
                ],
                hard: [
                    "Mit wem würdest du tauschen wollen?",
                    "Was ist deine unangenehmste Körpererfahrung?",
                    "Hast du jemals Gefühle für die Partnerin/den Partner eines Freundes gehabt?"
                ]
            },
            dare: {
                easy: [
                    "Mache 10 Liegestütze",
                    "Singe ein Lied deiner Wahl laut",
                    "Tanze 30 Sekunden ohne Musik",
                    "Mache ein albernes Selfie und zeige es allen"
                ],
                medium: [
                    "Gehe nach draußen und rufe etwas Lustiges",
                    "Lasse dich von jemandem schminken",
                    "Tausche ein Kleidungsstück mit der Person links von dir"
                ],
                hard: [
                    "Gehe nach draußen und begrüße 3 Fremde",
                    "Iss eine Kombination aus 3 verschiedenen Lebensmitteln",
                    "Lasse dich von der Gruppe stylen"
                ]
            }
        };
    }

    getRandomChallenge(type) {
        const difficulties = ['easy', 'medium', 'hard'];
        const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
        const challenges = this.challenges[type][difficulty];
        const text = challenges[Math.floor(Math.random() * challenges.length)];
        
        return { text, difficulty };
    }

    selectRandomPlayer() {
        const otherPlayers = this.players.filter(p => p.id !== this.socket.id);
        if (otherPlayers.length === 0) return null;
        
        return otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        document.getElementById(screenId).classList.remove('hidden');
    }

    updateRoomInfo() {
        document.getElementById('display-room-code').textContent = this.roomCode;
        document.getElementById('player-count').textContent = this.players.length;
        
        const startButton = document.getElementById('start-game');
        const isHost = this.players[0]?.id === this.socket.id;
        startButton.disabled = !isHost || this.players.length < 2;
    }

    updatePlayerList() {
        const container = document.getElementById('players-container');
        container.innerHTML = '';
        
        this.players.forEach(player => {
            const isYou = player.id === this.socket.id;
            const playerElement = document.createElement('div');
            playerElement.className = `player-item ${isYou ? 'you' : ''}`;
            playerElement.innerHTML = `
                <div class="player-avatar">${player.username.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="player-name">${player.username} ${isYou ? '(Du)' : ''}</div>
                    <div class="player-status ${player.ready ? 'ready' : ''}">
                        ${player.ready ? 'Bereit' : 'In Lobby'}
                    </div>
                </div>
            `;
            container.appendChild(playerElement);
        });
        
        this.updateRoomInfo();
    }

    updatePlayerCards() {
        const container = document.querySelector('.player-cards');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.players.forEach(player => {
            const isYou = player.id === this.socket.id;
            const isCurrent = player.id === this.currentPlayer?.id;
            const score = this.scores[player.id] || 0;
            
            const card = document.createElement('div');
            card.className = `player-card ${isCurrent ? 'active' : ''} ${isYou ? 'you' : ''}`;
            card.innerHTML = `
                <div class="player-card-header">
                    <div class="player-card-name">${player.username} ${isYou ? '(Du)' : ''}</div>
                    <div class="player-card-score">${score} Punkte</div>
                </div>
                <div class="player-card-status">
                    ${isCurrent ? '🏆 Aktuell dran' : 'Wartet...'}
                </div>
                <div class="player-card-reactions" id="reactions-${player.id}">
                    <!-- Reactions werden dynamisch hinzugefügt -->
                </div>
            `;
            container.appendChild(card);
        });
    }

    updateCurrentPlayer() {
        document.getElementById('current-player').textContent = 
            this.currentPlayer?.username || 'Wird geladen...';
    }

    updateChallengeDisplay() {
        if (!this.currentChallenge) return;
        
        const typeText = this.currentChallenge.type === 'truth' ? 'Wahrheit' : 'Pflicht';
        document.getElementById('challenge-type').textContent = typeText;
        document.getElementById('challenge-text').textContent = this.currentChallenge.text;
        
        const difficultyIcons = {
            'easy': '🟢',
            'medium': '🟡',
            'hard': '🔴'
        };
        document.getElementById('difficulty').textContent = 
            difficultyIcons[this.currentChallenge.difficulty] || '⚪';
        
        if (this.currentChallenge.targetPlayer) {
            document.getElementById('target-player').textContent = 
                this.currentChallenge.targetPlayer.username;
        } else {
            document.getElementById('target-player').textContent = 'Alle';
        }
        
        document.getElementById('skip-btn').disabled = !this.isYourTurn;
        document.getElementById('complete-btn').disabled = !this.isYourTurn;
    }

    updateScoreboard() {
        const tbody = document.getElementById('scoreboard-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        // Sortiere Spieler nach Punkten
        const sortedPlayers = [...this.players].sort((a, b) => {
            const scoreA = this.scores[a.id] || 0;
            const scoreB = this.scores[b.id] || 0;
            return scoreB - scoreA;
        });
        
        sortedPlayers.forEach((player, index) => {
            const score = this.scores[player.id] || 0;
            const isYou = player.id === this.socket.id;
            
            const row = document.createElement('tr');
            const rankClass = index === 0 ? 'first' : index === 1 ? 'second' : index === 2 ? 'third' : '';
            
            row.innerHTML = `
                <td class="${rankClass}">${index + 1}</td>
                <td>${player.username} ${isYou ? '(Du)' : ''}</td>
                <td><strong>${score}</strong></td>
                <td>${Math.floor(score / 25)}</td>
                <td>${player.id === this.currentPlayer?.id ? '🏆 Dran' : 'Wartet'}</td>
            `;
            
            tbody.appendChild(row);
        });
    }

    startTimer() {
        clearInterval(this.timer);
        this.timeLeft = 30;
        
        this.timer = setInterval(() => {
            this.timeLeft--;
            document.getElementById('time-remaining').textContent = this.timeLeft;
            document.querySelector('.timer-fill').style.width = `${(this.timeLeft / 30) * 100}%`;
            
            if (this.timeLeft <= 0) {
                clearInterval(this.timer);
                if (this.isYourTurn) {
                    this.skipChallenge();
                }
            }
        }, 1000);
    }

    clearChallenge() {
        this.currentChallenge = null;
        clearInterval(this.timer);
        
        document.getElementById('challenge-type').textContent = 'Warte auf nächste Runde...';
        document.getElementById('challenge-text').textContent = 'Das Spiel geht weiter!';
        document.getElementById('target-player').textContent = 'Alle';
        document.getElementById('difficulty').textContent = '⚪';
        document.getElementById('time-remaining').textContent = '30';
        document.querySelector('.timer-fill').style.width = '100%';
        
        document.getElementById('skip-btn').disabled = true;
        document.getElementById('complete-btn').disabled = true;
    }

    enableChoiceButtons() {
        document.getElementById('truth-btn').disabled = false;
        document.getElementById('dare-btn').disabled = false;
        document.getElementById('random-btn').disabled = false;
    }

    disableChoiceButtons() {
        document.getElementById('truth-btn').disabled = true;
        document.getElementById('dare-btn').disabled = true;
        document.getElementById('random-btn').disabled = true;
    }

    addChatMessage(message, type = 'user') {
        const container = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}`;
        messageDiv.textContent = message;
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    }

    addGameChatMessage(message, type = 'user') {
        const container = document.getElementById('game-chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}`;
        messageDiv.textContent = message;
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    }

    addReactionToPlayer(playerId, emoji) {
        const container = document.getElementById(`reactions-${playerId}`);
        if (container) {
            const bubble = document.createElement('span');
            bubble.className = 'reaction-bubble';
            bubble.textContent = emoji;
            container.appendChild(bubble);
            
            // Entferne nach 5 Sekunden
            setTimeout(() => {
                if (bubble.parentNode) {
                    bubble.parentNode.removeChild(bubble);
                }
            }, 5000);
        }
    }

    copyRoomCode() {
        navigator.clipboard.writeText(this.roomCode)
            .then(() => {
                this.showNotification('Raumcode kopiert!', 'success');
            })
            .catch(err => {
                this.showNotification('Kopieren fehlgeschlagen', 'error');
            });
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    resetGame() {
        this.players = [];
        this.currentPlayer = null;
        this.isYourTurn = false;
        this.gameState = 'lobby';
        this.currentChallenge = null;
        this.scores = {};
        clearInterval(this.timer);
    }
}

// Starte das Spiel wenn die Seite geladen ist
document.addEventListener('DOMContentLoaded', () => {
    window.game = new MultiplayerGame();
});
