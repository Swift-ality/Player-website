const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const http = require('http');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 3001;

// Data storage
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Initialize data files
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ players: {}, globalPlayers: [], selections: {}, globalTags: [], selectionLimit: 5, pluginEndpoint: { ip: 'localhost', port: 8123, token: '' } }, null, 2)
    );
}
if (!fs.existsSync(USERS_FILE)) {
    // Default admin user
    const defaultUsers = [
        {
            username: 'admin',
            password: '$2a$10$c1y6z8ETWTGjMvCxP8hyzurEY7TGOsabEaeGNtU16niaEVEAiJet6',
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
    cookie: { 
        secure: false,
        maxAge: 6 * 60 * 60 * 1000 // 6 hours in milliseconds
    }
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
    if (!data.selectionLimit) data.selectionLimit = 5;
    if (!data.pluginEndpoint) data.pluginEndpoint = { ip: 'localhost', port: 8123, token: '' };
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

async function sendSelectionToPlugin(playerName, streamer, action) {
    const data = readData();
    const endpoint = data.pluginEndpoint || { ip: 'localhost', port: 8123, token: '' };

    const postDataObj = {
        playerName,
        streamer,
        action
    };
    if (endpoint.token) {
        postDataObj.token = endpoint.token;
    }
    const postData = querystring.stringify(postDataObj);

    return new Promise((resolve, reject) => {
        const options = {
            hostname: endpoint.ip,
            port: endpoint.port,
            path: '/action',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 5000
        };

        const req = http.request(options, (response) => {
            let body = '';
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve({ ok: true, statusCode: response.statusCode, body });
                } else {
                    reject(new Error(`Plugin returned HTTP ${response.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (err) => {
            console.error('Error sending selection to plugin:', err.message);
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout sending selection to plugin'));
        });

        req.write(postData);
        req.end();
    });
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
    const { username, password, role } = req.body;
    const users = readUsers();

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    let newRole = 'streamer';
    if (role === 'admin') {
        // Only the main "admin" account may create other admin accounts
        if (!req.session.user || req.session.user.username !== 'admin') {
            return res.status(403).json({ error: 'Only main admin can create admin accounts' });
        }
        newRole = 'admin';
    }

    users.push({
        username,
        password: bcrypt.hashSync(password, 10),
        role: newRole
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
// For streamers, only return players that are not already chosen by another streamer.
app.get('/api/players', requireAuth, (req, res) => {
    const data = readData();
    const username = req.session.user.username;

    const allPlayers = data.globalPlayers || [];
    const selections = data.selections || {};

    // Build a set of player IDs that are already selected by someone ELSE
    const excludedIds = new Set();
    Object.entries(selections).forEach(([user, ids]) => {
        if (user !== username && Array.isArray(ids)) {
            ids.forEach(id => excludedIds.add(id));
        }
    });

    const availablePlayers = allPlayers.filter(p => !excludedIds.has(p.id));
    res.json(availablePlayers);
});

// Get streamer's selections
app.get('/api/selections', requireAuth, (req, res) => {
    const data = readData();
    const username = req.session.user.username;
    if (!data.selections) data.selections = {};
    res.json(data.selections[username] || []);
});

// Toggle player selection
app.post('/api/selections/:playerId', requireAuth, async (req, res) => {
    const data = readData();
    const username = req.session.user.username;
    const playerId = parseInt(req.params.playerId);
    const limit = data.selectionLimit || 5;
    
    if (!data.selections) data.selections = {};
    if (!data.selections[username]) data.selections[username] = [];

    const player = (data.globalPlayers || []).find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    const index = data.selections[username].indexOf(playerId);
    if (index > -1) {
        data.selections[username].splice(index, 1);
        writeData(data);
        try {
            await sendSelectionToPlugin(player.name, username, 'remove');
        } catch (e) {
            console.error('Failed to sync removal to plugin:', e.message);
        }
        res.json({ selected: false });
    } else {
        // Check selection limit
        if (data.selections[username].length >= limit) {
            return res.status(400).json({ error: `You can only select up to ${limit} players` });
        }
        
        // Check if player is already selected by someone else
        const alreadySelected = Object.entries(data.selections).some(
            ([user, ids]) => user !== username && ids.includes(playerId)
        );
        
        if (alreadySelected) {
            return res.status(400).json({ error: 'This player has already been chosen by another streamer' });
        }
        
        data.selections[username].push(playerId);
        writeData(data);
        try {
            await sendSelectionToPlugin(player.name, username, 'add');
        } catch (e) {
            console.error('Failed to sync addition to plugin:', e.message);
        }
        res.json({ selected: true });
    }
});

// Admin get any streamer's selections
app.get('/api/admin/selections/:streamer', requireAdmin, (req, res) => {
    const data = readData();
    if (!data.selections) data.selections = {};
    res.json(data.selections[req.params.streamer] || []);
});

// Admin add player to streamer's selection
app.post('/api/admin/selections/:streamer/:playerId', requireAdmin, async (req, res) => {
    const data = readData();
    const streamer = req.params.streamer;
    const playerId = parseInt(req.params.playerId);
    const limit = data.selectionLimit || 5;
    
    if (!data.selections) data.selections = {};
    if (!data.selections[streamer]) data.selections[streamer] = [];

    const player = (data.globalPlayers || []).find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    // Check selection limit
    if (data.selections[streamer].length >= limit && !data.selections[streamer].includes(playerId)) {
        return res.status(400).json({ error: `Cannot add more players. The limit is ${limit} players per streamer.` });
    }
    
    // Check if player is already selected by someone else
    const alreadySelected = Object.entries(data.selections).some(
        ([user, ids]) => user !== streamer && ids.includes(playerId)
    );
    
    if (alreadySelected) {
        return res.status(400).json({ error: 'This player has already been chosen by another streamer' });
    }
    
    if (!data.selections[streamer].includes(playerId)) {
        data.selections[streamer].push(playerId);
        writeData(data);
        try {
            await sendSelectionToPlugin(player.name, streamer, 'add');
        } catch (e) {
            console.error('Failed to sync admin addition to plugin:', e.message);
        }
    }
    
    res.json({ success: true, selections: data.selections[streamer] });
});

// Admin remove player from streamer's selection
app.delete('/api/admin/selections/:streamer/:playerId', requireAdmin, async (req, res) => {
    const data = readData();
    const streamer = req.params.streamer;
    const playerId = parseInt(req.params.playerId);
    
    if (!data.selections) data.selections = {};
    if (!data.selections[streamer]) data.selections[streamer] = [];

    const player = (data.globalPlayers || []).find(p => p.id === playerId);
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    data.selections[streamer] = data.selections[streamer].filter(id => id !== playerId);
    writeData(data);

    try {
        await sendSelectionToPlugin(player.name, streamer, 'remove');
    } catch (e) {
        console.error('Failed to sync admin removal to plugin:', e.message);
    }
    
    res.json({ success: true, selections: data.selections[streamer] });
});

// Admin selection limit management
app.get('/api/admin/selection-limit', requireAdmin, (req, res) => {
    const data = readData();
    res.json({ limit: data.selectionLimit || 5 });
});

// Streamer get selection limit
app.get('/api/selection-limit', requireAuth, (req, res) => {
    const data = readData();
    res.json({ limit: data.selectionLimit || 5 });
});

app.post('/api/admin/selection-limit', requireAdmin, (req, res) => {
    const data = readData();
    const limit = parseInt(req.body.limit);
    
    if (!limit || limit < 1) {
        return res.status(400).json({ error: 'Limit must be at least 1' });
    }
    
    data.selectionLimit = limit;
    writeData(data);
    res.json({ success: true, limit: data.selectionLimit });
});

// Admin plugin endpoint management
app.get('/api/admin/plugin-endpoint', requireAdmin, (req, res) => {
    const data = readData();
    res.json(data.pluginEndpoint || { ip: 'localhost', port: 8123, token: '' });
});

app.post('/api/admin/plugin-endpoint', requireAdmin, (req, res) => {
    const data = readData();
    const { ip, port, token } = req.body;
    
    if (!ip || !port) {
        return res.status(400).json({ error: 'IP and port are required' });
    }
    
    if (port < 1 || port > 65535) {
        return res.status(400).json({ error: 'Port must be between 1 and 65535' });
    }
    
    data.pluginEndpoint = { ip, port: parseInt(port), token: token || '' };
    writeData(data);
    res.json({ success: true, endpoint: data.pluginEndpoint });
});

// Admin test ping to plugin
app.post('/api/admin/test-ping', requireAdmin, async (req, res) => {
    const data = readData();
    const endpoint = data.pluginEndpoint || { ip: 'localhost', port: 8123, token: '' };
    
    console.log('=== Test Ping to Plugin ===');
    console.log(`URL: http://${endpoint.ip}:${endpoint.port}/action`);
    console.log(`Token: ${endpoint.token ? 'configured' : 'none'}`);
    
    const http = require('http');
    const querystring = require('querystring');
    
    const postDataObj = {
        playerName: 'TestPlayer',
        streamer: 'TestStreamer',
        action: 'add'
    };
    
    if (endpoint.token) {
        postDataObj.token = endpoint.token;
    }
    
    const postData = querystring.stringify(postDataObj);
    console.log('POST Data:', postData);
    
    try {
        const result = await new Promise((resolve, reject) => {
            console.log('Connecting to:', endpoint.ip + ':' + endpoint.port);
            
            const options = {
                hostname: endpoint.ip,
                port: parseInt(endpoint.port),
                path: '/action',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 5000
            };
            
            console.log('Request options:', JSON.stringify(options, null, 2));
            
            const req = http.request(options, (response) => {
                console.log('Response status:', response.statusCode);
                let body = '';
                response.on('data', (chunk) => { 
                    body += chunk;
                    console.log('Response chunk:', chunk.toString());
                });
                response.on('end', () => {
                    console.log('Response complete. Body:', body);
                    if (response.statusCode === 200) {
                        resolve({ success: true, message: 'Connection successful', body, statusCode: response.statusCode });
                    } else {
                        reject(new Error(`HTTP ${response.statusCode}: ${body}`));
                    }
                });
            });
            
            req.on('error', (e) => {
                console.error('Request error:', e);
                reject(new Error(`Connection failed: ${e.message}. Make sure the plugin is running and accessible at ${endpoint.ip}:${endpoint.port}`));
            });
            
            req.on('timeout', () => {
                console.error('Request timed out');
                req.destroy();
                reject(new Error('Connection timed out after 5 seconds. Check if plugin is running.'));
            });
            
            console.log('Sending request...');
            req.write(postData);
            req.end();
        });
        
        console.log('Success! Result:', result);
        res.json(result);
    } catch (e) {
        console.error('Error in test-ping:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin resend all selections to plugin
app.post('/api/admin/resend-all', requireAdmin, async (req, res) => {
    const data = readData();
    const endpoint = data.pluginEndpoint || { ip: 'localhost', port: 8123, token: '' };
    
    if (!data.selections || !data.globalPlayers) {
        return res.json({ success: true, count: 0 });
    }
    
    let sentCount = 0;
    const http = require('http');
    const querystring = require('querystring');
    
    for (const [streamer, playerIds] of Object.entries(data.selections)) {
        for (const playerId of playerIds) {
            const player = data.globalPlayers.find(p => p.id === playerId);
            if (!player) continue;
            
            const postDataObj = {
                playerName: player.name,
                streamer: streamer,
                action: 'add'
            };
            
            if (endpoint.token) {
                postDataObj.token = endpoint.token;
            }
            
            const postData = querystring.stringify(postDataObj);
            
            try {
                await new Promise((resolve, reject) => {
                    const options = {
                        hostname: endpoint.ip,
                        port: endpoint.port,
                        path: '/action',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': Buffer.byteLength(postData)
                        },
                        timeout: 5000
                    };
                    
                    const req = http.request(options, (response) => {
                        response.on('data', () => {});
                        response.on('end', () => {
                            console.log(`Sent player ${player.name} to ${streamer} - Status: ${response.statusCode}`);
                            resolve();
                        });
                    });
                    
                    req.on('error', (e) => {
                        console.error(`Failed to send to plugin: ${e.message}`);
                        resolve(); // Continue even if one fails
                    });
                    
                    req.on('timeout', () => {
                        req.destroy();
                        resolve();
                    });
                    
                    req.write(postData);
                    req.end();
                });
                
                sentCount++;
            } catch (e) {
                console.error('Error sending to plugin:', e);
            }
        }
    }
    
    res.json({ success: true, count: sentCount });
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

app.patch('/api/admin/tags/:oldName', requireAdmin, (req, res) => {
    const data = readData();
    const oldName = req.params.oldName;
    const newName = (req.body.newName || '').trim();
    
    if (!newName) {
        return res.status(400).json({ error: 'New tag name is required' });
    }
    
    if (!data.globalTags) data.globalTags = [];
    
    const index = data.globalTags.indexOf(oldName);
    if (index === -1) {
        return res.status(404).json({ error: 'Tag not found' });
    }
    
    if (data.globalTags.includes(newName) && oldName !== newName) {
        return res.status(400).json({ error: 'Tag name already exists' });
    }
    
    data.globalTags[index] = newName;
    
    if (data.globalPlayers) {
        data.globalPlayers.forEach(player => {
            if (player.tags) {
                const tagIndex = player.tags.indexOf(oldName);
                if (tagIndex !== -1) {
                    player.tags[tagIndex] = newName;
                }
            }
        });
    }
    
    writeData(data);
    res.json({ success: true, tags: data.globalTags });
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
