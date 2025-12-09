const { Server } = require('socket.io');

// Diese Datei wird für Vercel Serverless benötigt
// Du musst auch eine `vercel.json` Konfiguration erstellen

module.exports = (req, res) => {
    // Diese Funktion wird von Vercel aufgerufen
    // Die eigentliche Socket.io Logik sollte in einer separaten Server-Umgebung laufen
    // Für Produktion empfehle ich einen separaten WebSocket-Server
    res.status(200).json({ message: 'Socket.io Server is running' });
};
