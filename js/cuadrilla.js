/**
 * Cuadrilla Module - Boss Directory & Squads
 * Directorio de trabajadores y cuadrillas para el Modo Jefe
 */

// ============================================
// STATE
// ============================================
let bossWorkers = [];
let squads = [];
let cuadrillaDataListening = false;
let currentCuadrillaTab = 'directorio';

// Worker modal state
let editingWorkerId = null;
let workerMode = 'search'; // 'search' | 'manual'
let foundUser = null;
let usernameSearchTimer = null;

// Squad modal state
let editingSquadId = null;
let squadMemberIds = [];
let squadMemberSearchQuery = '';

// ============================================
// DATA LOADING
// ============================================

function loadCuadrillaData() {
    if (!currentUser || cuadrillaDataListening) return;
    cuadrillaDataListening = true;

    // Listen to bossWorkers
    db.ref(`bossWorkers/${currentUser.uid}`).on('value', (snapshot) => {
        bossWorkers = [];
        snapshot.forEach((child) => {
            bossWorkers.push({ id: child.key, ...child.val() });
        });
        bossWorkers.sort((a, b) => {
            if (!a.lastWorked && !b.lastWorked) return 0;
            if (!a.lastWorked) return 1;
            if (!b.lastWorked) return -1;
            return b.lastWorked - a.lastWorked;
        });
        renderDirectory();
    });

    // Listen to squads
    db.ref(`squads/${currentUser.uid}`).on('value', (snapshot) => {
        squads = [];
        snapshot.forEach((child) => {
            squads.push({ id: child.key, ...child.val() });
        });
        squads.sort((a, b) => {
            if (!a.lastUsed && !b.lastUsed) return 0;
            if (!a.lastUsed) return 1;
            if (!b.lastUsed) return -1;
            return b.lastUsed - a.lastUsed;
        });
        renderSquads();
    });
}

function unloadCuadrillaData() {
    if (currentUser) {
        db.ref(`bossWorkers/${currentUser.uid}`).off();
        db.ref(`squads/${currentUser.uid}`).off();
    }
    bossWorkers = [];
    squads = [];
    cuadrillaDataListening = false;
    renderDirectory();
    renderSquads();
}

// ============================================
// SUBTAB SWITCHING
// ============================================

function switchCuadrillaTab(tab) {
    currentCuadrillaTab = tab;
    document.querySelectorAll('.subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.subsection').forEach(s => s.classList.remove('active'));
    const targetTab = document.querySelector(`.subtab[data-subtab="${tab}"]`);
    if (targetTab) targetTab.classList.add('active');
    const targetSection = document.getElementById(tab + 'Subsection');
    if (targetSection) targetSection.classList.add('active');
}

// ============================================
// DIRECTORIO - RENDER
// ============================================

function renderDirectory() {
    const list = document.getElementById('workersList');
    if (!list) return;

    if (bossWorkers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="icon">👷</div>
                <h3>Sin trabajadores</h3>
                <p>Toca "+" para agregar tu primer trabajador</p>
            </div>
        `;
        return;
    }

    list.innerHTML = bossWorkers.map(worker => {
        const safeName = escapeHtml(worker.displayName);
        const safeUsername = worker.username ? escapeHtml(worker.username) : null;
        const safeRut = worker.rut ? escapeHtml(worker.rut) : null;
        const badge = worker.linkedAccount
            ? `<span class="worker-badge linked">Cuenta vinculada</span>`
            : `<span class="worker-badge">Sin cuenta</span>`;
        const lastWorkedStr = worker.lastWorked
            ? new Date(worker.lastWorked).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
            : null;

        return `
            <div class="worker-card" onclick="openWorkerModal('${worker.id}')">
                <div class="worker-card-header">
                    <div class="worker-info">
                        <span class="worker-name">${safeName}</span>
                        ${safeUsername ? `<span class="worker-username">@${safeUsername}</span>` : ''}
                        ${safeRut ? `<span class="worker-rut">${safeRut}</span>` : ''}
                    </div>
                    ${badge}
                </div>
                ${lastWorkedStr ? `<div class="worker-last-worked">Último trabajo: ${lastWorkedStr}</div>` : ''}
            </div>
        `;
    }).join('');
}

// ============================================
// CUADRILLAS - RENDER
// ============================================

function renderSquads() {
    const list = document.getElementById('squadsList');
    if (!list) return;

    if (squads.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="icon">👥</div>
                <h3>Sin cuadrillas</h3>
                <p>Toca "+" para crear tu primera cuadrilla</p>
            </div>
        `;
        return;
    }

    list.innerHTML = squads.map(squad => {
        const safeName = escapeHtml(squad.name);
        const memberCount = (squad.memberIds || []).length;
        const lastUsedStr = squad.lastUsed
            ? new Date(squad.lastUsed).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Nunca usado';

        return `
            <div class="squad-card" onclick="openSquadModal('${squad.id}')">
                <div class="squad-header">
                    <span class="squad-name">${safeName}</span>
                    <span class="squad-member-count">${memberCount} ${memberCount === 1 ? 'miembro' : 'miembros'}</span>
                </div>
                <div class="squad-last-used">Último uso: ${lastUsedStr}</div>
            </div>
        `;
    }).join('');
}

// ============================================
// WORKER MODAL
// ============================================

function openWorkerModal(workerId = null) {
    editingWorkerId = workerId;
    foundUser = null;
    if (usernameSearchTimer) clearTimeout(usernameSearchTimer);

    document.getElementById('workerModalTitle').textContent = workerId ? 'Editar Trabajador' : 'Agregar Trabajador';
    document.getElementById('workerDeleteBtn').style.display = workerId ? 'block' : 'none';
    document.getElementById('workerUsernameSearch').value = '';
    document.getElementById('workerSearchResult').innerHTML = '';
    document.getElementById('workerManualName').value = '';
    document.getElementById('workerManualRut').value = '';

    if (workerId) {
        const worker = bossWorkers.find(w => w.id === workerId);
        if (worker) {
            if (worker.linkedAccount) {
                setWorkerMode('search');
                _showLinkedWorkerPreview(worker);
            } else {
                setWorkerMode('manual');
                document.getElementById('workerManualName').value = worker.displayName || '';
                document.getElementById('workerManualRut').value = worker.rut || '';
            }
        }
    } else {
        setWorkerMode('search');
    }

    openModal('workerModal');
}

function _showLinkedWorkerPreview(worker) {
    const resultEl = document.getElementById('workerSearchResult');
    const safeName = escapeHtml(worker.displayName);
    const safeUsername = escapeHtml(worker.username || '');
    resultEl.innerHTML = `
        <div class="worker-found-card">
            <div class="worker-found-avatar">${safeName.charAt(0).toUpperCase()}</div>
            <div class="worker-found-info">
                <span class="worker-found-name">${safeName}</span>
                <span class="worker-found-username">@${safeUsername}</span>
            </div>
            <span class="worker-badge linked">Vinculado</span>
        </div>
    `;
    foundUser = { uid: worker.linkedUid, displayName: worker.displayName, username: worker.username };
}

function closeWorkerModal() {
    closeModal('workerModal');
    editingWorkerId = null;
    foundUser = null;
    if (usernameSearchTimer) clearTimeout(usernameSearchTimer);
}

function setWorkerMode(mode) {
    workerMode = mode;
    document.getElementById('workerModeSearch').classList.toggle('selected', mode === 'search');
    document.getElementById('workerModeManual').classList.toggle('selected', mode === 'manual');
    document.getElementById('workerSearchSection').style.display = mode === 'search' ? 'block' : 'none';
    document.getElementById('workerManualSection').style.display = mode === 'manual' ? 'block' : 'none';
}

function onUsernameSearchInput(input) {
    const value = input.value.replace(/[^a-z0-9]/g, '').substring(0, 12);
    input.value = value;

    foundUser = null;
    const resultEl = document.getElementById('workerSearchResult');

    if (!value) {
        resultEl.innerHTML = '';
        return;
    }

    resultEl.innerHTML = '<div class="worker-search-status">Buscando...</div>';
    clearTimeout(usernameSearchTimer);
    usernameSearchTimer = setTimeout(() => _searchByUsername(value), 400);
}

async function _searchByUsername(username) {
    const resultEl = document.getElementById('workerSearchResult');
    try {
        const uidSnap = await db.ref(`usernames/${username}`).once('value');
        if (!uidSnap.exists()) {
            resultEl.innerHTML = '<div class="worker-search-status empty">Usuario no encontrado</div>';
            return;
        }

        const uid = uidSnap.val();
        const profileSnap = await db.ref(`users/${uid}`).once('value');
        const profile = profileSnap.val();

        if (!profile) {
            resultEl.innerHTML = '<div class="worker-search-status empty">Usuario no encontrado</div>';
            return;
        }

        foundUser = {
            uid,
            displayName: profile.displayName || username,
            username,
            photoURL: profile.photoURL || ''
        };

        const safeName = escapeHtml(foundUser.displayName);
        const avatarHtml = foundUser.photoURL
            ? `<img src="${escapeHtml(foundUser.photoURL)}" class="worker-found-photo" alt="">`
            : `<div class="worker-found-avatar">${safeName.charAt(0).toUpperCase()}</div>`;

        resultEl.innerHTML = `
            <div class="worker-found-card">
                ${avatarHtml}
                <div class="worker-found-info">
                    <span class="worker-found-name">${safeName}</span>
                    <span class="worker-found-username">@${escapeHtml(username)}</span>
                </div>
                <span class="worker-badge linked">Encontrado ✓</span>
            </div>
        `;
    } catch (err) {
        resultEl.innerHTML = '<div class="worker-search-status empty">Error al buscar</div>';
    }
}

async function saveWorker() {
    if (!currentUser) return;

    let workerData = {};

    if (workerMode === 'search') {
        if (!foundUser) {
            showToast('Busca y confirma un usuario primero', 'error');
            return;
        }
        // Check for duplicate linked worker
        const duplicate = bossWorkers.find(w => w.linkedUid === foundUser.uid && w.id !== editingWorkerId);
        if (duplicate) {
            showToast(`${foundUser.displayName} ya está en tu directorio`, 'error');
            return;
        }
        workerData = {
            displayName: foundUser.displayName,
            username: foundUser.username,
            rut: null,
            linkedAccount: true,
            linkedUid: foundUser.uid,
            updatedAt: Date.now()
        };
    } else {
        const name = document.getElementById('workerManualName').value.trim();
        if (!name) {
            showToast('El nombre es obligatorio', 'error');
            return;
        }
        const rut = document.getElementById('workerManualRut').value.trim() || null;
        workerData = {
            displayName: name,
            username: null,
            rut,
            linkedAccount: false,
            linkedUid: null,
            updatedAt: Date.now()
        };
    }

    try {
        if (editingWorkerId) {
            await db.ref(`bossWorkers/${currentUser.uid}/${editingWorkerId}`).update(workerData);
            showToast('Trabajador actualizado');
        } else {
            workerData.lastWorked = null;
            workerData.createdAt = Date.now();
            await db.ref(`bossWorkers/${currentUser.uid}`).push(workerData);
            showToast('Trabajador agregado');
        }
        closeWorkerModal();
    } catch (err) {
        showToast('Error al guardar', 'error');
    }
}

async function deleteWorker() {
    if (!editingWorkerId || !currentUser) return;

    const worker = bossWorkers.find(w => w.id === editingWorkerId);
    const safeName = escapeHtml(worker ? worker.displayName : 'este trabajador');

    showConfirmModal(
        'Eliminar trabajador',
        `¿Eliminar a ${safeName} del directorio?`,
        'Eliminar',
        async () => {
            try {
                await db.ref(`bossWorkers/${currentUser.uid}/${editingWorkerId}`).remove();
                showToast('Trabajador eliminado');
                closeWorkerModal();
            } catch (err) {
                showToast('Error al eliminar', 'error');
            }
        }
    );
}

// ============================================
// SQUAD MODAL
// ============================================

function openSquadModal(squadId = null) {
    editingSquadId = squadId;
    squadMemberIds = [];
    squadMemberSearchQuery = '';

    document.getElementById('squadModalTitle').textContent = squadId ? 'Editar Cuadrilla' : 'Nueva Cuadrilla';
    document.getElementById('squadDeleteBtn').style.display = squadId ? 'block' : 'none';
    document.getElementById('squadName').value = '';
    document.getElementById('squadMemberSearch').value = '';

    if (squadId) {
        const squad = squads.find(s => s.id === squadId);
        if (squad) {
            document.getElementById('squadName').value = squad.name || '';
            squadMemberIds = [...(squad.memberIds || [])];
        }
    }

    renderSquadCurrentMembers();
    renderSquadMemberSearch();
    openModal('squadModal');
}

function closeSquadModal() {
    closeModal('squadModal');
    editingSquadId = null;
    squadMemberIds = [];
    squadMemberSearchQuery = '';
}

function renderSquadCurrentMembers() {
    const list = document.getElementById('squadCurrentMembers');
    if (!list) return;

    if (squadMemberIds.length === 0) {
        list.innerHTML = '<div class="squad-no-members">Sin miembros aún</div>';
        return;
    }

    list.innerHTML = squadMemberIds.map(id => {
        const worker = bossWorkers.find(w => w.id === id);
        if (!worker) return '';
        const safeName = escapeHtml(worker.displayName);
        const badge = worker.linkedAccount
            ? `<span class="worker-badge linked small">Vinculado</span>`
            : '';
        return `
            <div class="squad-member-item">
                <span class="squad-member-name">${safeName}</span>
                ${badge}
                <button class="squad-member-remove" onclick="removeSquadMember('${id}')" aria-label="Quitar">&times;</button>
            </div>
        `;
    }).filter(Boolean).join('');
}

function renderSquadMemberSearch() {
    const resultsEl = document.getElementById('squadMemberResults');
    if (!resultsEl) return;

    const query = squadMemberSearchQuery.toLowerCase();
    const available = bossWorkers.filter(w => {
        if (squadMemberIds.includes(w.id)) return false;
        if (!query) return true;
        return (w.displayName || '').toLowerCase().includes(query)
            || (w.username || '').toLowerCase().includes(query)
            || (w.rut || '').toLowerCase().includes(query);
    });

    if (bossWorkers.length === 0) {
        resultsEl.innerHTML = '<div class="worker-search-status empty">No hay trabajadores en el directorio</div>';
        return;
    }

    if (available.length === 0) {
        resultsEl.innerHTML = '<div class="worker-search-status empty">Todos los trabajadores ya están en la cuadrilla</div>';
        return;
    }

    resultsEl.innerHTML = available.map(worker => {
        const safeName = escapeHtml(worker.displayName);
        const badge = worker.linkedAccount
            ? `<span class="worker-badge linked small">Vinculado</span>`
            : '';
        return `
            <div class="squad-member-result" onclick="addSquadMember('${worker.id}')">
                <span class="squad-member-name">${safeName}</span>
                ${badge}
                <button class="btn-add-member" onclick="event.stopPropagation(); addSquadMember('${worker.id}')">+</button>
            </div>
        `;
    }).join('');
}

function onSquadMemberSearch(input) {
    squadMemberSearchQuery = input.value;
    renderSquadMemberSearch();
}

function addSquadMember(workerId) {
    if (!squadMemberIds.includes(workerId)) {
        squadMemberIds.push(workerId);
        renderSquadCurrentMembers();
        renderSquadMemberSearch();
    }
}

function removeSquadMember(workerId) {
    squadMemberIds = squadMemberIds.filter(id => id !== workerId);
    renderSquadCurrentMembers();
    renderSquadMemberSearch();
}

async function saveSquad() {
    if (!currentUser) return;

    const name = document.getElementById('squadName').value.trim();
    if (!name) {
        showToast('El nombre de la cuadrilla es obligatorio', 'error');
        return;
    }

    const squadData = {
        name,
        memberIds: squadMemberIds,
        updatedAt: Date.now()
    };

    try {
        if (editingSquadId) {
            await db.ref(`squads/${currentUser.uid}/${editingSquadId}`).update(squadData);
            showToast('Cuadrilla actualizada');
        } else {
            squadData.createdAt = Date.now();
            squadData.lastUsed = null;
            await db.ref(`squads/${currentUser.uid}`).push(squadData);
            showToast('Cuadrilla creada');
        }
        closeSquadModal();
    } catch (err) {
        showToast('Error al guardar', 'error');
    }
}

async function deleteSquad() {
    if (!editingSquadId || !currentUser) return;

    const squad = squads.find(s => s.id === editingSquadId);
    const safeName = escapeHtml(squad ? squad.name : 'esta cuadrilla');

    showConfirmModal(
        'Eliminar cuadrilla',
        `¿Eliminar la cuadrilla "${safeName}"?`,
        'Eliminar',
        async () => {
            try {
                await db.ref(`squads/${currentUser.uid}/${editingSquadId}`).remove();
                showToast('Cuadrilla eliminada');
                closeSquadModal();
            } catch (err) {
                showToast('Error al eliminar', 'error');
            }
        }
    );
}
