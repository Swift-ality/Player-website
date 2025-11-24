// State management
let players = JSON.parse(localStorage.getItem('players')) || [];
let activeFilters = new Set();

// DOM elements
const playerForm = document.getElementById('playerForm');
const playerNameInput = document.getElementById('playerName');
const playerTagsInput = document.getElementById('playerTags');
const playersList = document.getElementById('playersList');
const tagFilters = document.getElementById('tagFilters');
const clearFiltersBtn = document.getElementById('clearFilters');

// Initialize
init();

function init() {
    renderPlayers();
    renderTagFilters();
    setupEventListeners();
}

function setupEventListeners() {
    playerForm.addEventListener('submit', handleAddPlayer);
    clearFiltersBtn.addEventListener('click', clearAllFilters);
}

function handleAddPlayer(e) {
    e.preventDefault();
    
    const name = playerNameInput.value.trim();
    const tagsString = playerTagsInput.value.trim();
    const tags = tagsString ? tagsString.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    
    if (name) {
        const player = {
            id: Date.now(),
            name,
            tags
        };
        
        players.push(player);
        saveToLocalStorage();
        renderPlayers();
        renderTagFilters();
        
        // Clear form
        playerNameInput.value = '';
        playerTagsInput.value = '';
    }
}

function deletePlayer(id) {
    players = players.filter(player => player.id !== id);
    saveToLocalStorage();
    renderPlayers();
    renderTagFilters();
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

function getAllTags() {
    const tagsSet = new Set();
    players.forEach(player => {
        player.tags.forEach(tag => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
}

function playerMatchesFilters(player) {
    if (activeFilters.size === 0) return true;
    return player.tags.some(tag => activeFilters.has(tag));
}

function renderPlayers() {
    if (players.length === 0) {
        playersList.innerHTML = '<div class="empty-state">No players added yet. Add your first player above!</div>';
        return;
    }
    
    playersList.innerHTML = '';
    
    const filteredPlayers = players.filter(playerMatchesFilters);
    
    if (filteredPlayers.length === 0) {
        playersList.innerHTML = '<div class="empty-state">No players match the selected filters.</div>';
        return;
    }
    
    filteredPlayers.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        
        const tagsHTML = player.tags.length > 0
            ? player.tags.map(tag => `<span class="tag">${tag}</span>`).join('')
            : '<span class="tag" style="background: #f0f0f0; color: #999;">No tags</span>';
        
        playerCard.innerHTML = `
            <div class="player-header">
                <div class="player-name">${player.name}</div>
                <button class="delete-btn" onclick="deletePlayer(${player.id})">Delete</button>
            </div>
            <div class="player-tags">
                ${tagsHTML}
            </div>
        `;
        
        playersList.appendChild(playerCard);
    });
}

function renderTagFilters() {
    const allTags = getAllTags();
    
    if (allTags.length === 0) {
        tagFilters.innerHTML = '<div style="color: #999;">No tags available yet.</div>';
        clearFiltersBtn.style.display = 'none';
        return;
    }
    
    clearFiltersBtn.style.display = 'block';
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

function saveToLocalStorage() {
    localStorage.setItem('players', JSON.stringify(players));
}
