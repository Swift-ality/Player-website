const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Data storage
const DATA_FILE = path.join(__dirname, 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Initialize data files
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ players: {}, globalPlayers: [], selections: {}, globalTags: [] }, null, 2)
    );
}
if (!fs.existsSync(USERS_FILE)) {
    // Default admin user: admin/admin123
    const defaultUsers = [
        {
            username: 'admin',
            password: bcrypt.hashSync('admin123', 10),
            role: 'admin'
        }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers));
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Auth middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
}

function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden' });
    }
}

// Helper functions
function readData() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.players) data.players = {};
    if (!data.globalPlayers) data.globalPlayers = [];
    if (!data.selections) data.selections = {};
    if (!data.globalTags) data.globalTags = [];
    return data;
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function readUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Auth routes
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    
    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.user = { username: user.username, role: user.role };
        res.json({ success: true, role: user.role });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Admin routes
app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    users.push({
        username,
        password: bcrypt.hashSync(password, 10),
        role: 'streamer'
    });
    
    writeUsers(users);
    res.json({ success: true });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = readUsers().filter(u => u.role === 'streamer').map(u => ({ username: u.username }));
    res.json(users);
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
    let users = readUsers();
    users = users.filter(u => u.username !== req.params.username);
    writeUsers(users);
    res.json({ success: true });
});

// Player routes
app.get('/api/players', requireAuth, (req, res) => {
    const data = readData();
    res.json(data.globalPlayers || []);
});

// Get streamer's selections
app.get('/api/selections', requireAuth, (req, res) => {
    const data = readData();
    const username = req.session.user.username;
    if (!data.selections) data.selections = {};
    res.json(data.selections[username] || []);
});

// Toggle player selection
app.post('/api/selections/:playerId', requireAuth, (req, res) => {
    const data = readData();
    const username = req.session.user.username;
    const playerId = parseInt(req.params.playerId);
    
    if (!data.selections) data.selections = {};
    if (!data.selections[username]) data.selections[username] = [];
    
    const index = data.selections[username].indexOf(playerId);
    if (index > -1) {
        data.selections[username].splice(index, 1);
    } else {
        data.selections[username].push(playerId);
    }
    
    writeData(data);
    res.json({ selected: index === -1 });
});

// Admin get any streamer's selections
app.get('/api/admin/selections/:streamer', requireAdmin, (req, res) => {
    const data = readData();
    if (!data.selections) data.selections = {};
    res.json(data.selections[req.params.streamer] || []);
});

// Admin global tag management
app.get('/api/admin/tags', requireAdmin, (req, res) => {
    const data = readData();
    res.json(data.globalTags || []);
});

app.post('/api/admin/tags', requireAdmin, (req, res) => {
    const data = readData();
    const name = (req.body.name || '').trim();
    if (!name) {
        return res.status(400).json({ error: 'Tag name is required' });
    }
    if (!data.globalTags) data.globalTags = [];
    if (!data.globalTags.includes(name)) {
        data.globalTags.push(name);
        writeData(data);
    }
    res.json(data.globalTags);
});

app.delete('/api/admin/tags/:name', requireAdmin, (req, res) => {
    const data = readData();
    const tagName = req.params.name;
    if (!data.globalTags) data.globalTags = [];

    data.globalTags = data.globalTags.filter(t => t !== tagName);

    if (data.globalPlayers) {
        data.globalPlayers.forEach(player => {
            if (player.tags) {
                player.tags = player.tags.filter(t => t !== tagName);
            }
        });
    }

    writeData(data);
    res.json({ success: true, tags: data.globalTags });
});

// Admin global player management
app.get('/api/admin/players', requireAdmin, (req, res) => {
    const data = readData();
    res.json(data.globalPlayers || []);
});

app.post('/api/admin/players', requireAdmin, (req, res) => {
    const data = readData();
    
    if (!data.globalPlayers) {
        data.globalPlayers = [];
    }
    
    const player = {
        id: Date.now(),
        name: req.body.name,
        tags: req.body.tags || [],
        color: req.body.color || '#667eea'
    };
    
    data.globalPlayers.push(player);
    writeData(data);
    res.json(player);
});

app.patch('/api/admin/players/:id', requireAdmin, (req, res) => {
    const data = readData();
    const playerId = parseInt(req.params.id);
    
    if (data.globalPlayers) {
        const player = data.globalPlayers.find(p => p.id === playerId);
        if (player) {
            if (req.body.color) player.color = req.body.color;
            if (req.body.tags) player.tags = req.body.tags;
            if (req.body.name) player.name = req.body.name;
            writeData(data);
            res.json(player);
        } else {
            res.status(404).json({ error: 'Player not found' });
        }
    } else {
        res.status(404).json({ error: 'Players not found' });
    }
});

app.delete('/api/admin/players/:id', requireAdmin, (req, res) => {
    const data = readData();
    const playerId = parseInt(req.params.id);
    
    if (data.globalPlayers) {
        data.globalPlayers = data.globalPlayers.filter(p => p.id !== playerId);
        writeData(data);
    }
    
    // Also remove from all selections
    if (data.selections) {
        Object.keys(data.selections).forEach(username => {
            data.selections[username] = data.selections[username].filter(id => id !== playerId);
        });
        writeData(data);
    }
    
    res.json({ success: true });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('Default admin credentials: admin / admin123');
});
