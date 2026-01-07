let streamers = [];
let players = [];
let globalTags = [];
let selectedPlayerTags = [];
let activeFilters = new Set();
let selectedStreamer = '';
let selectedPlayerIds = [];
let allSelections = {};
let selectionLimit = 5;

async function checkAuth() {
    const response = await fetch('/api/session');
    const data = await response.json();

    if (!data.loggedIn || data.user.role !== 'admin') {
        window.location.href = '/login.html';
        return;
    }

    document.getElementById('welcomeMsg').textContent = `Welcome, ${data.user.username}`;
    await Promise.all([loadPlayers(), loadTags(), loadSelectionLimit(), loadPluginEndpoint()]);
    await loadStreamers();
}

async function loadStreamers() {
    const response = await fetch('/api/admin/users');
    streamers = await response.json();
    await loadAllSelections();
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

async function loadSelectionLimit() {
    const response = await fetch('/api/admin/selection-limit');
    const data = await response.json();
    selectionLimit = data.limit || 5;
    document.getElementById('selectionLimit').value = selectionLimit;
    document.getElementById('currentLimit').innerHTML = `<p style=\"color: #ffb366; margin-top: 10px;\">Current limit: ${selectionLimit} players</p>`;
    if (streamers.length) {
        populateStreamerSelect();
    }
}

async function loadPluginEndpoint() {
    const response = await fetch('/api/admin/plugin-endpoint');
    const data = await response.json();
    document.getElementById('pluginIp').value = data.ip || 'localhost';
    document.getElementById('pluginPort').value = data.port || 8123;
    document.getElementById('pluginToken').value = data.token || '';
    const tokenDisplay = data.token ? ' (with auth token)' : '';
    document.getElementById('currentEndpoint').innerHTML = `<p style="color: #ffb366;">Current endpoint: ${data.ip}:${data.port}${tokenDisplay}</p>`;
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

document.getElementById('selectionLimitForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const limit = parseInt(document.getElementById('selectionLimit').value);

    const response = await fetch('/api/admin/selection-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit })
    });

    if (response.ok) {
        await loadSelectionLimit();
        alert('Selection limit updated successfully');
    } else {
        const data = await response.json();
        alert(data.error || 'Failed to update limit');
    }
});

document.getElementById('pluginEndpointForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const ip = document.getElementById('pluginIp').value.trim();
    const port = parseInt(document.getElementById('pluginPort').value);
    const token = document.getElementById('pluginToken').value.trim();

    const response = await fetch('/api/admin/plugin-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, port, token })
    });

    if (response.ok) {
        await loadPluginEndpoint();
        alert('Plugin endpoint updated successfully');
    } else {
        const data = await response.json();
        alert(data.error || 'Failed to update endpoint');
    }
});

document.getElementById('testPing').addEventListener('click', async () => {
    console.log('[CLIENT] Test Ping button clicked');
    const debugOutput = document.getElementById('debugOutput');
    const debugText = document.getElementById('debugText');
    debugOutput.style.display = 'block';
    
    // Get current endpoint settings
    console.log('[CLIENT] Fetching plugin endpoint...');
    const endpointResponse = await fetch('/api/admin/plugin-endpoint');
    console.log('[CLIENT] Endpoint response status:', endpointResponse.status);
    const endpoint = await endpointResponse.json();
    console.log('[CLIENT] Endpoint data:', endpoint);
    
    const debugInfo = [];
    debugInfo.push('=== Test Connection ===');
    debugInfo.push(`URL: http://${endpoint.ip}:${endpoint.port}/action`);
    debugInfo.push(`Auth Token: ${endpoint.token ? '***configured***' : 'none'}`);
    debugInfo.push('');
    debugInfo.push('POST Data:');
    debugInfo.push(`  playerName: TestPlayer`);
    debugInfo.push(`  streamer: TestStreamer`);
    debugInfo.push(`  action: add`);
    if (endpoint.token) {
        debugInfo.push(`  token: ${endpoint.token}`);
    }
    debugInfo.push('');
    debugInfo.push('Waiting for response...');
    debugText.textContent = debugInfo.join('\n');
    
    console.log('[CLIENT] Sending test-ping request...');
    const response = await fetch('/api/admin/test-ping', {
        method: 'POST'
    });
    console.log('[CLIENT] Test-ping response status:', response.status);

    if (response.ok) {
        const data = await response.json();
        if (data.success) {
            debugInfo.push(`\n✓ Response: ${data.message || 'OK'}`);
            debugInfo.push(`Status: ${response.status}`);
            debugText.textContent = debugInfo.join('\n');
            alert(`✓ Connection successful!\n\nPlugin response: ${data.message || 'OK'}`);
        } else {
            debugInfo.push(`\n✗ Failed: ${data.error}`);
            debugText.textContent = debugInfo.join('\n');
            alert(`✗ Connection failed:\n${data.error}`);
        }
    } else {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        debugInfo.push(`\n✗ HTTP Error: ${response.status}`);
        debugInfo.push(`Error: ${data.error || 'Unknown error'}`);
        debugText.textContent = debugInfo.join('\n');
        alert(`✗ Connection failed:\n${data.error || 'Unknown error'}`);
    }
});

document.getElementById('resendAllData').addEventListener('click', async () => {
    if (!confirm('This will re-send all selection data to the plugin. Continue?')) return;

    const response = await fetch('/api/admin/resend-all', {
        method: 'POST'
    });

    if (response.ok) {
        const data = await response.json();
        alert(`Successfully sent ${data.count} selections to the plugin`);
    } else {
        const data = await response.json();
        alert(data.error || 'Failed to resend data');
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
        const selections = allSelections[streamer.username] || [];
        const inviteCount = selections.length;
        const limitText = selectionLimit ? selectionLimit : '∞';

        const option = document.createElement('option');
        option.value = streamer.username;
        option.textContent = `${streamer.username}: ${inviteCount}/${limitText} invited`;
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
    await loadAllSelections();
    renderStreamerSelections();
}

async function loadAllSelections() {
    allSelections = {};
    for (const streamer of streamers) {
        const response = await fetch(`/api/admin/selections/${encodeURIComponent(streamer.username)}`);
        if (response.ok) {
            allSelections[streamer.username] = await response.json();
        }
    }
}

let draggedPlayerId = null;
let dragStartTime = 0;
let dragStartX = 0;
let dragStartY = 0;
let currentX = 0;
let currentY = 0;
let dragGhost = null;
let dragGhostContainer = null;
let lastDragTime = 0;
let deltaX = 0;
let deltaY = 0;
let prevDragPos = {x: 0, y: 0};

function renderStreamerSelections() {
    const container = document.getElementById('selectedPlayersList');

    if (!players || players.length === 0) {
        container.innerHTML = '<div class="empty-state">No players in the pool yet.</div>';
        return;
    }

    const selected = players.filter(p => selectedPlayerIds.includes(p.id));
    const available = players.filter(p => !selectedPlayerIds.includes(p.id) && !isPlayerSelectedByAnyone(p.id));

    container.innerHTML = '';

    container.innerHTML += '<h4>Selected Players</h4><div class="streamers-grid drop-zone" id="selectedGrid" data-zone="selected"></div>';
    const selectedGrid = container.querySelector('#selectedGrid');

    if (selected.length === 0) {
        selectedGrid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">Drag players here to select them</div>';
    } else {
        selected.forEach(player => {
            const card = createDraggablePlayerCard(player, true);
            selectedGrid.appendChild(card);
        });
    }

    if (available.length > 0) {
        container.innerHTML += '<h4 style="margin-top: 20px;">Add Players</h4><div class="streamers-grid drop-zone" id="availableGrid" data-zone="available"></div>';
        const availableGrid = container.querySelector('#availableGrid');

        available.forEach(player => {
            const card = createDraggablePlayerCard(player, false);
            availableGrid.appendChild(card);
        });
    }
    
    setupDropZones();
}

function createDraggablePlayerCard(player, isSelected) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.draggable = true;
    card.dataset.playerId = player.id;
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
            <button class="${isSelected ? 'delete-btn' : 'select-btn'}" onclick="event.stopPropagation(); ${isSelected ? 'removePlayerFromStreamer' : 'addPlayerToStreamer'}(${player.id})">${isSelected ? 'Remove' : 'Add'}</button>
        </div>
        <div class="player-tags">${tagsHTML}</div>
    `;
    
    card.addEventListener('dragstart', (e) => {
        handleDragStart(e);
        if (cardRotationInterval) clearInterval(cardRotationInterval);
        cardRotationInterval = setInterval(updateCardRotation, 16);
    });
    card.addEventListener('drag', handleDrag);
    card.addEventListener('dragend', handleDragEnd);
    
    return card;
}

function handleDragStart(e) {
    draggedPlayerId = parseInt(e.currentTarget.dataset.playerId);
    dragStartTime = Date.now();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    prevDragPos = {x: e.clientX, y: e.clientY};
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    
    // Create drag ghost container with perspective
    dragGhostContainer = document.createElement('div');
    dragGhostContainer.className = 'drag-ghost-container';
    dragGhostContainer.style.left = e.clientX + 'px';
    dragGhostContainer.style.top = e.clientY + 'px';
    document.body.appendChild(dragGhostContainer);
    
    // Create drag ghost card
    dragGhost = e.currentTarget.cloneNode(true);
    dragGhost.classList.add('drag-ghost');
    dragGhost.classList.remove('dragging');
    const cardWidth = e.currentTarget.offsetWidth;
    const cardHeight = e.currentTarget.offsetHeight;
    dragGhost.style.width = cardWidth + 'px';
    dragGhost.style.top = -(cardHeight / 2) + 'px';
    dragGhost.style.left = -(cardWidth / 2) + 'px';
    dragGhostContainer.appendChild(dragGhost);
    
    // Hide default drag image
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    e.dataTransfer.setDragImage(img, 0, 0);
}

function handleDrag(e) {
    if (e.clientX === 0 && e.clientY === 0) return;
    if (!dragGhostContainer || !dragGhost) return;
    
    currentX = e.clientX;
    currentY = e.clientY;
    
    // Update container position
    dragGhostContainer.style.left = currentX + 'px';
    dragGhostContainer.style.top = currentY + 'px';
    
    // Calculate delta for rotation
    deltaX = currentX - prevDragPos.x;
    deltaY = currentY - prevDragPos.y;
    prevDragPos = {x: currentX, y: currentY};
}

let cardRotationInterval = null;

function updateCardRotation() {
    if (!dragGhost) return;
    
    const maxTilt = 35;
    const rotateY = Math.max(Math.min(deltaX * 1.4, maxTilt), -maxTilt);
    const rotateX = Math.max(Math.min(deltaY * 1.4, maxTilt), -maxTilt) * -1;
    
    dragGhost.style.transform = `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`;
    
    // Decay deltas for smooth return to neutral
    deltaX *= 0.85;
    deltaY *= 0.85;
    
    if (Math.abs(deltaX) < 0.1) deltaX = 0;
    if (Math.abs(deltaY) < 0.1) deltaY = 0;
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    e.currentTarget.style.transform = '';
    
    if (cardRotationInterval) {
        clearInterval(cardRotationInterval);
        cardRotationInterval = null;
    }
    
    if (dragGhostContainer) {
        dragGhostContainer.remove();
        dragGhostContainer = null;
    }
    
    dragGhost = null;
    draggedPlayerId = null;
    deltaX = 0;
    deltaY = 0;
}

function setupDropZones() {
    const zones = document.querySelectorAll('.drop-zone');
    zones.forEach(zone => {
        zone.addEventListener('dragover', handleDragOver);
        zone.addEventListener('drop', handleDrop);
        zone.addEventListener('dragleave', handleDragLeave);
        zone.addEventListener('dragenter', handleDragEnter);
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (e.currentTarget.classList.contains('drop-zone')) {
        e.currentTarget.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    if (e.currentTarget.classList.contains('drop-zone')) {
        e.currentTarget.classList.remove('drag-over');
    }
}

async function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    if (!draggedPlayerId) return;
    
    const targetZone = e.currentTarget.dataset.zone;
    const isCurrentlySelected = selectedPlayerIds.includes(draggedPlayerId);
    
    if (targetZone === 'selected' && !isCurrentlySelected) {
        await addPlayerToStreamer(draggedPlayerId);
    } else if (targetZone === 'available' && isCurrentlySelected) {
        await removePlayerFromStreamer(draggedPlayerId);
    }
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

async function editPlayerTags(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    
    const currentTags = player.tags || [];
    const globalTagsInPlayer = currentTags.filter(tag => globalTags.includes(tag));
    const perPlayerTags = currentTags.filter(tag => !globalTags.includes(tag));
    
    const selectedGlobalTags = new Set(globalTagsInPlayer);
    
    const modalHTML = `
        <div id="tagEditModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;">
            <div style="background: #2d2d2d; padding: 30px; border-radius: 12px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
                <h3 style="margin-top: 0;">Edit Tags for ${player.name}</h3>
                
                <h4 style="color: #ffb366; margin: 15px 0 10px 0;">Global Tags</h4>
                <div id="modalTagChoices" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;"></div>
                
                <h4 style="color: #ffb366; margin: 15px 0 10px 0;">Per-Player Tags</h4>
                <div id="modalPerPlayerTags" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; min-height: 40px; padding: 10px; background: #1a1a1a; border-radius: 6px;"></div>
                
                <input type="text" id="modalExtraTags" placeholder="Add per-player tags (comma-separated)" style="width: 100%; padding: 10px; margin-bottom: 15px; background: #1a1a1a; border: 1px solid #444; color: #fff; border-radius: 6px;">
                
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="closeTagEditModal()" style="padding: 10px 20px; background: #444; color: #fff; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="savePlayerTags(${playerId})" style="padding: 10px 20px; background: #667eea; color: #fff; border: none; border-radius: 6px; cursor: pointer;">Save</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modalTagChoices = document.getElementById('modalTagChoices');
    globalTags.forEach(tag => {
        const btn = document.createElement('div');
        btn.className = 'tag-filter' + (selectedGlobalTags.has(tag) ? ' active' : '');
        btn.style.fontSize = '16px';
        btn.style.padding = '10px 18px';
        btn.textContent = tag;
        btn.dataset.tag = tag;
        btn.onclick = () => {
            if (selectedGlobalTags.has(tag)) {
                selectedGlobalTags.delete(tag);
                btn.classList.remove('active');
            } else {
                selectedGlobalTags.add(tag);
                btn.classList.add('active');
            }
        };
        modalTagChoices.appendChild(btn);
    });
    
    const modalPerPlayerTags = document.getElementById('modalPerPlayerTags');
    const perPlayerTagsSet = new Set(perPlayerTags);
    
    function renderPerPlayerTags() {
        modalPerPlayerTags.innerHTML = '';
        if (perPlayerTagsSet.size === 0) {
            modalPerPlayerTags.innerHTML = '<span style="color: #999;">No per-player tags yet</span>';
        } else {
            perPlayerTagsSet.forEach(tag => {
                const tagEl = document.createElement('div');
                tagEl.style.cssText = 'display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; background: #3a3a3a; border-radius: 15px; font-size: 14px;';
                tagEl.innerHTML = `
                    <span>${tag}</span>
                    <button onclick="removePerPlayerTag('${tag.replace(/'/g, "\\'")}')" style="background: #dc3545; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; padding: 0; line-height: 1;">×</button>
                `;
                modalPerPlayerTags.appendChild(tagEl);
            });
        }
    }
    
    renderPerPlayerTags();
    
    window.removePerPlayerTag = (tag) => {
        perPlayerTagsSet.delete(tag);
        renderPerPlayerTags();
    };
    
    window.currentEditingGlobalTags = selectedGlobalTags;
    window.currentEditingPerPlayerTags = perPlayerTagsSet;
}

function closeTagEditModal() {
    const modal = document.getElementById('tagEditModal');
    if (modal) modal.remove();
    window.currentEditingTags = null;
}

async function savePlayerTags(playerId) {
    const extraTagsInput = document.getElementById('modalExtraTags').value.trim();
    const extraTags = extraTagsInput ? extraTagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    
    const allPerPlayerTags = Array.from(new Set([...window.currentEditingPerPlayerTags, ...extraTags]));
    const allTags = Array.from(new Set([...window.currentEditingGlobalTags, ...allPerPlayerTags]));
    
    const response = await fetch(`/api/admin/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: allTags })
    });
    
    if (response.ok) {
        closeTagEditModal();
        await loadPlayers();
    } else {
        alert('Failed to update tags');
    }
}

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

    playersList.innerHTML = '';

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
                <div>
                    <button class="select-btn" onclick="editPlayerTags(${player.id})">Edit Tags</button>
                    <button class="delete-btn" onclick="deletePlayer(${player.id})">Delete</button>
                </div>
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

function renderGlobalTags() {
    const container = document.getElementById('globalTagsList');
    if (!container) return;

    if (!globalTags || globalTags.length === 0) {
        container.innerHTML = '<div class="empty-state">No global tags yet.</div>';
        return;
    }

    container.innerHTML = '<div class="tags-grid"></div>';
    const grid = container.querySelector('.tags-grid');
    
    globalTags.forEach(tag => {
        const item = document.createElement('div');
        item.className = 'tag-card';
        item.innerHTML = `
            <div class="tag-card-content">
                <span class="tag-name" onclick="editTag('${tag.replace(/'/g, "\\'")}')">
                    ${tag}<span class="edit-icon">✏️</span>
                </span>
                <button class="delete-btn" onclick="deleteTag('${tag.replace(/'/g, "\\'")}')">X</button>
            </div>
        `;
        grid.appendChild(item);
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

async function editTag(oldName) {
    const newName = prompt('Edit tag name:', oldName);
    if (!newName || newName === oldName) return;
    
    const response = await fetch(`/api/admin/tags/${encodeURIComponent(oldName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
    });
    
    if (response.ok) {
        await Promise.all([loadTags(), loadPlayers()]);
    } else {
        const error = await response.json();
        alert(error.error || 'Failed to edit tag');
    }
}

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

function isPlayerSelectedByAnyone(playerId) {
    // Check all selections to see if this player is already chosen by any streamer
    return Object.entries(allSelections).some(
        ([username, selections]) => username !== selectedStreamer && selections && selections.includes(playerId)
    );
}

async function addPlayerToStreamer(playerId) {
    if (!selectedStreamer) return;
    
    const limit = selectionLimit || 5;
    
    if (selectedPlayerIds.length >= limit) {
        alert(`Cannot add more players. The limit is ${limit} players per streamer.`);
        return;
    }
    
    const response = await fetch(`/api/admin/selections/${encodeURIComponent(selectedStreamer)}/${playerId}`, {
        method: 'POST'
    });

    if (response.ok) {
        await loadStreamerSelections();
    } else {
        const error = await response.json();
        alert(error.error || 'Failed to add player');
    }
}

async function removePlayerFromStreamer(playerId) {
    if (!selectedStreamer) return;
    
    const response = await fetch(`/api/admin/selections/${encodeURIComponent(selectedStreamer)}/${playerId}`, {
        method: 'DELETE'
    });
    
    if (response.ok) {
        await loadStreamerSelections();
    } else {
        alert('Failed to remove player');
    }
}

checkAuth();
