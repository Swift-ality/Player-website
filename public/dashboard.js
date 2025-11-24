let players = [];
let selections = [];
let activeFilters = new Set();

async function checkAuth() {
    const response = await fetch('/api/session');
    const data = await response.json();

    if (!data.loggedIn) {
        window.location.href = '/login.html';
        return;
    }

    document.getElementById('welcomeMsg').textContent = `Welcome, ${data.user.username}`;
    await loadData();
}

async function loadData() {
    const [playersRes, selectionsRes] = await Promise.all([
        fetch('/api/players'),
        fetch('/api/selections')
    ]);

    players = await playersRes.json();
    selections = await selectionsRes.json();
    renderPlayers();
    renderSelectedPlayers();
    renderTagFilters();
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

async function toggleSelection(playerId) {
    const response = await fetch(`/api/selections/${playerId}`, {
        method: 'POST'
    });

    if (!response.ok) return;

    if (selections.includes(playerId)) {
        selections = selections.filter(id => id !== playerId);
    } else {
        selections.push(playerId);
    }

    renderPlayers();
    renderSelectedPlayers();
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
        playersList.innerHTML = '<div class="empty-state">No players available.</div>';
        return;
    }

    playersList.innerHTML = '';
    const filteredPlayers = players.filter(playerMatchesFilters);

    if (filteredPlayers.length === 0) {
        playersList.innerHTML = '<div class="empty-state">No players match the selected filters.</div>';
        return;
    }

    filteredPlayers.forEach(player => {
        const isSelected = selections.includes(player.id);
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card' + (isSelected ? ' selected' : '');

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
                <button class="select-btn${isSelected ? ' selected' : ''}" onclick="event.stopPropagation(); toggleSelection(${player.id})">
                    ${isSelected ? 'Deselect' : 'Select'}
                </button>
            </div>
            <div class="player-tags">
                ${tagsHTML}
            </div>
        `;

        playersList.appendChild(playerCard);
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

function renderSelectedPlayers() {
    const container = document.getElementById('selectedPlayers');
    if (!container) return;

    const selected = players.filter(p => selections.includes(p.id));

    if (!selected || selected.length === 0) {
        container.innerHTML = '<div class="empty-state">No players selected yet.</div>';
        return;
    }

    container.innerHTML = '<div class="selected-grid"></div>';
    const grid = container.querySelector('.selected-grid');

    selected.forEach(player => {
        const color = player.color || '#ffb366';
        const avatarUrl = `https://minotar.net/helm/${encodeURIComponent(player.name)}/64.png`;
        const tagsHTML = (player.tags && player.tags.length > 0)
            ? player.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
            : '<span class="tag" style="background: #444; color: #bbb;">No tags</span>';

        const card = document.createElement('div');
        card.className = 'player-card selected';
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

checkAuth();
