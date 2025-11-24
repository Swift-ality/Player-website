let streamers = [];
let players = [];
let globalTags = [];
let selectedPlayerTags = [];
let activeFilters = new Set();
let selectedStreamer = '';
let selectedPlayerIds = [];

async function checkAuth() {
    const response = await fetch('/api/session');
    const data = await response.json();

    if (!data.loggedIn || data.user.role !== 'admin') {
        window.location.href = '/login.html';
        return;
    }

    document.getElementById('welcomeMsg').textContent = `Welcome, ${data.user.username}`;
    await Promise.all([loadStreamers(), loadPlayers(), loadTags()]);
}

async function loadStreamers() {
    const response = await fetch('/api/admin/users');
    streamers = await response.json();
    renderStreamers();
    populateStreamerSelect();
}

async function loadPlayers() {
    const response = await fetch('/api/admin/players');
    players = await response.json();
    renderPlayers();
    renderTagFilters();
    if (selectedStreamer) {
        await loadStreamerSelections();
    }
}

async function loadTags() {
    const response = await fetch('/api/admin/tags');
    globalTags = await response.json();
    renderGlobalTags();
    renderPlayerTagChoices();
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;

    const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'streamer' })
    });

    if (response.ok) {
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        loadStreamers();
    } else {
        const data = await response.json();
        alert(data.error || 'Failed to create streamer');
    }
});

document.getElementById('createAdminForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value;

    const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'admin' })
    });

    if (response.ok) {
        document.getElementById('newAdminUsername').value = '';
        document.getElementById('newAdminPassword').value = '';
        alert('Admin account created');
    } else {
        const data = await response.json();
        alert(data.error || 'Failed to create admin');
    }
});

async function deleteStreamer(username) {
    if (!confirm(`Delete streamer "${username}"?`)) return;

    await fetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    loadStreamers();
}

function renderStreamers() {
    const streamersList = document.getElementById('streamersList');

    if (streamers.length === 0) {
        streamersList.innerHTML = '<div class="empty-state">No streamers created yet.</div>';
        return;
    }

    streamersList.innerHTML = '<div class="streamers-grid"></div>';
    const grid = streamersList.querySelector('.streamers-grid');

    streamers.forEach(streamer => {
        const card = document.createElement('div');
        card.className = 'streamer-card';
        card.innerHTML = `
            <div class="player-header">
                <div class="player-name">${streamer.username}</div>
                <button class="delete-btn" onclick="deleteStreamer('${streamer.username}')">Delete</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function populateStreamerSelect() {
    const select = document.getElementById('streamerSelect');
    select.innerHTML = '<option value="">Select a streamer</option>';

    streamers.forEach(streamer => {
        const option = document.createElement('option');
        option.value = streamer.username;
        option.textContent = streamer.username;
        select.appendChild(option);
    });
}

document.getElementById('streamerSelect').addEventListener('change', async (e) => {
    selectedStreamer = e.target.value;
    if (selectedStreamer) {
        document.getElementById('streamerSelections').style.display = 'block';
        await loadStreamerSelections();
    } else {
        document.getElementById('streamerSelections').style.display = 'none';
    }
});

async function loadStreamerSelections() {
    const response = await fetch(`/api/admin/selections/${encodeURIComponent(selectedStreamer)}`);
    if (response.ok) {
        selectedPlayerIds = await response.json();
    } else {
        selectedPlayerIds = [];
    }
    renderStreamerSelections();
}

function renderStreamerSelections() {
    const container = document.getElementById('selectedPlayersList');

    if (!players || players.length === 0) {
        container.innerHTML = '<div class="empty-state">No players in the pool yet.</div>';
        return;
    }

    const selected = players.filter(p => selectedPlayerIds.includes(p.id));

    if (selected.length === 0) {
        container.innerHTML = '<div class="empty-state">This streamer has not selected any players yet.</div>';
        return;
    }

    container.innerHTML = '<div class="streamers-grid"></div>';
    const grid = container.querySelector('.streamers-grid');

    selected.forEach(player => {
        const card = document.createElement('div');
        card.className = 'player-card';
        const color = player.color || '#ffb366';
        const avatarUrl = `https://minotar.net/helm/${encodeURIComponent(player.name)}/64.png`;

        const tagsHTML = (player.tags && player.tags.length > 0)
            ? player.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
            : '<span class="tag" style="background: #444; color: #bbb;">No tags</span>';

        card.innerHTML = `
            <div class="player-header">
                <div class="player-info">
                    <div class="player-circle" style="border-color: ${color};">
                        <img src="${avatarUrl}" alt="${player.name}">
                    </div>
                    <div class="player-name">${player.name}</div>
                </div>
            </div>
            <div class="player-tags">${tagsHTML}</div>
        `;
        grid.appendChild(card);
    });
}

document.getElementById('addPlayerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('playerName').value.trim();
    const tagsString = document.getElementById('playerTags').value.trim();
    const extraTags = tagsString ? tagsString.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    const color = document.getElementById('playerColor').value;
    const tags = Array.from(new Set([...selectedPlayerTags, ...extraTags]));

    if (name) {
        await fetch('/api/admin/players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, tags, color })
        });

        document.getElementById('playerName').value = '';
        document.getElementById('playerTags').value = '';
        document.getElementById('playerColor').value = '#667eea';
        selectedPlayerTags = [];
        renderPlayerTagChoices();
        await loadPlayers();
    }
});

async function deletePlayer(id) {
    if (!confirm('Delete this player? This will remove it from all streamers.')) return;
    await fetch(`/api/admin/players/${id}`, { method: 'DELETE' });
    await loadPlayers();
    if (selectedStreamer) {
        await loadStreamerSelections();
    }
}

function toggleTagFilter(tag) {
    if (activeFilters.has(tag)) {
        activeFilters.delete(tag);
    } else {
        activeFilters.add(tag);
    }
    renderPlayers();
    renderTagFilters();
}

function clearAllFilters() {
    activeFilters.clear();
    renderPlayers();
    renderTagFilters();
}

document.getElementById('clearFilters').addEventListener('click', clearAllFilters);

function getAllTags() {
    const tagsSet = new Set();
    players.forEach(player => {
        (player.tags || []).forEach(tag => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
}

function playerMatchesFilters(player) {
    if (activeFilters.size === 0) return true;
    return (player.tags || []).some(tag => activeFilters.has(tag));
}

function renderPlayers() {
    const playersList = document.getElementById('playersList');

    if (!players || players.length === 0) {
        playersList.innerHTML = '<div class="empty-state">No players added yet.</div>';
        return;
    }

    const filteredPlayers = players.filter(playerMatchesFilters);

    if (filteredPlayers.length === 0) {
        playersList.innerHTML = '<div class="empty-state">No players match the selected filters.</div>';
        return;
    }

    playersList.innerHTML = '<div id="playersGrid"></div>';
    const grid = document.getElementById('playersGrid');

    filteredPlayers.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';

        const tagsHTML = (player.tags && player.tags.length > 0)
            ? player.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
            : '<span class="tag" style="background: #444; color: #bbb;">No tags</span>';

        const color = player.color || '#ffb366';
        const avatarUrl = `https://minotar.net/helm/${encodeURIComponent(player.name)}/64.png`;

        playerCard.innerHTML = `
            <div class="player-header">
                <div class="player-info">
                    <div class="player-circle" style="border-color: ${color};">
                        <img src="${avatarUrl}" alt="${player.name}">
                    </div>
                    <div class="player-name">${player.name}</div>
                </div>
                <button class="delete-btn" onclick="deletePlayer(${player.id})">Delete</button>
            </div>
            <div class="player-tags">
                ${tagsHTML}
            </div>
        `;

        grid.appendChild(playerCard);
    });
}

function renderTagFilters() {
    const tagFilters = document.getElementById('tagFilters');
    const allTags = getAllTags();

    if (allTags.length === 0) {
        tagFilters.innerHTML = '<div style="color: #999;">No tags available yet.</div>';
        document.getElementById('clearFilters').style.display = 'none';
        return;
    }

    document.getElementById('clearFilters').style.display = 'block';
    tagFilters.innerHTML = '';

    allTags.forEach(tag => {
        const filterBtn = document.createElement('div');
        filterBtn.className = 'tag-filter';
        if (activeFilters.has(tag)) {
            filterBtn.classList.add('active');
        }
        filterBtn.textContent = tag;
        filterBtn.onclick = () => toggleTagFilter(tag);
        tagFilters.appendChild(filterBtn);
    });
}

function renderGlobalTags() {
    const container = document.getElementById('globalTagsList');
    if (!container) return;

    if (!globalTags || globalTags.length === 0) {
        container.innerHTML = '<div class="empty-state">No global tags yet.</div>';
        return;
    }

    container.innerHTML = '';
    globalTags.forEach(tag => {
        const item = document.createElement('div');
        item.className = 'tag-item';
        item.innerHTML = `
            <span class="tag">${tag}</span>
            <button class="delete-btn" onclick="deleteTag('${tag}')">X</button>
        `;
        container.appendChild(item);
    });
}

function renderPlayerTagChoices() {
    const container = document.getElementById('playerTagChoices');
    if (!container) return;

    if (!globalTags || globalTags.length === 0) {
        container.innerHTML = '<div class="empty-state">No global tags to assign.</div>';
        return;
    }

    container.innerHTML = '';
    globalTags.forEach(tag => {
        const btn = document.createElement('div');
        btn.className = 'tag-filter' + (selectedPlayerTags.includes(tag) ? ' active' : '');
        btn.textContent = tag;
        btn.onclick = () => togglePlayerTag(tag);
        container.appendChild(btn);
    });
}

document.getElementById('addTagForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tagName').value.trim();
    if (!name) return;

    await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });

    document.getElementById('tagName').value = '';
    await loadTags();
});

async function deleteTag(name) {
    await fetch(`/api/admin/tags/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await Promise.all([loadTags(), loadPlayers()]);
}

function togglePlayerTag(tag) {
    if (selectedPlayerTags.includes(tag)) {
        selectedPlayerTags = selectedPlayerTags.filter(t => t !== tag);
    } else {
        selectedPlayerTags.push(tag);
    }
    renderPlayerTagChoices();
}

checkAuth();
