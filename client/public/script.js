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
        document.getElementById('room-code').add
