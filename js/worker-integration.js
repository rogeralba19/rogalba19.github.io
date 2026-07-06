/**
 * Worker Integration Module
 * - Worker records from boss (workerRecords/{uid})
 * - Mutual payment confirmation
 * - Notifications badge & dropdown
 * - Public link by RUT/CI
 */

// ============================================
// STATE
// ============================================
let workerRecords = [];
let workerRecordsLoaded = false;
let workerRecordsListening = false;

let notifications = [];
let notificationsListening = false;
let unreadNotifCount = 0;

// ============================================
// WORKER RECORDS - DATA LOADING
// ============================================

function loadWorkerRecords() {
    if (!currentUser || workerRecordsListening) return;
    workerRecordsListening = true;

    db.ref(`workerRecords/${currentUser.uid}`).on('value', (snapshot) => {
        workerRecords = [];
        snapshot.forEach((child) => {
            workerRecords.push({ id: child.key, ...child.val(), _source: 'boss' });
        });
        workerRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
        workerRecordsLoaded = true;
        if (entriesLoaded && jobsLoaded) {
            renderEntries();
        }
    });
}

function unloadWorkerRecords() {
    if (currentUser) {
        db.ref(`workerRecords/${currentUser.uid}`).off();
    }
    workerRecords = [];
    workerRecordsLoaded = false;
    workerRecordsListening = false;
}

// ============================================
// NOTIFICATIONS - DATA LOADING
// ============================================

function loadNotifications() {
    if (!currentUser || notificationsListening) return;
    notificationsListening = true;

    db.ref(`notifications/${currentUser.uid}`)
        .orderByChild('createdAt')
        .limitToLast(50)
        .on('value', (snapshot) => {
            notifications = [];
            snapshot.forEach((child) => {
                notifications.push({ id: child.key, ...child.val() });
            });
            notifications.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            unreadNotifCount = notifications.filter(n => !n.read).length;
            updateNotifBadge();
        });
}

function unloadNotifications() {
    if (currentUser) {
        db.ref(`notifications/${currentUser.uid}`).off();
    }
    notifications = [];
    notificationsListening = false;
    unreadNotifCount = 0;
    updateNotifBadge();
}

function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unreadNotifCount > 0) {
        badge.textContent = unreadNotifCount > 99 ? '99+' : unreadNotifCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
    // Also update dropdown if it's open
    const dropdown = document.getElementById('userDropdown');
    if (dropdown && dropdown.classList.contains('visible')) {
        renderNotificationsInDropdown();
    }
}

// ============================================
// NOTIFICATIONS - RENDER IN DROPDOWN
// ============================================

function renderNotificationsInDropdown() {
    const container = document.getElementById('notifListContainer');
    if (!container) return;

    if (notifications.length === 0) {
        container.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
        return;
    }

    const recentNotifs = notifications.slice(0, 20);
    container.innerHTML = recentNotifs.map(n => {
        const text = getNotifText(n);
        const timeAgo = getTimeAgo(n.createdAt);
        const unreadClass = n.read ? '' : 'unread';
        return `
            <div class="notif-item ${unreadClass}" onclick="handleNotifClick('${n.id}', '${escapeHtml(n.recordId || '')}')">
                <div class="notif-text">${text}</div>
                <div class="notif-time">${timeAgo}</div>
            </div>
        `;
    }).join('');
}

function getNotifText(notif) {
    switch (notif.type) {
        case 'new_boss_record':
            return 'Tu jefe registró una nueva jornada para ti';
        case 'payment_request':
            return 'Se ha solicitado confirmación de pago';
        case 'difference_reported':
            return 'Un trabajador reportó diferencia en un registro';
        case 'payment_completed':
            return 'Pago confirmado completamente';
        case 'record_accepted':
            return 'Un trabajador aceptó tu registro';
        case 'boss_payment_confirmed':
            return 'Tu jefe marcó tu pago como realizado';
        case 'worker_payment_confirmed':
            return 'Un trabajador confirmó haber recibido el pago';
        default:
            return 'Nueva notificación';
    }
}

function getTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `hace ${days}d`;
}

async function handleNotifClick(notifId, recordId) {
    if (!currentUser) return;
    // Mark as read
    await db.ref(`notifications/${currentUser.uid}/${notifId}/read`).set(true);
    // Navigate to registros tab
    switchTab('registros');
    closeUserDropdown();
}

// ============================================
// NOTIFICATION CREATION HELPER
// ============================================

async function createNotification(targetUid, type, recordId) {
    if (!targetUid) return;
    const notifData = {
        type,
        fromUid: currentUser.uid,
        recordId: recordId || null,
        read: false,
        createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    await db.ref(`notifications/${targetUid}`).push(notifData);
}

// ============================================
// WORKER RECORD ACTIONS
// ============================================

async function acceptBossRecord(recordId) {
    if (!currentUser) return;
    try {
        await db.ref(`workerRecords/${currentUser.uid}/${recordId}/status`).set('accepted');
        // Get bossUid to notify
        const snap = await db.ref(`workerRecords/${currentUser.uid}/${recordId}/bossUid`).once('value');
        const bossUid = snap.val();
        if (bossUid) {
            await createNotification(bossUid, 'record_accepted', recordId);
        }
        showToast('Registro aceptado');
    } catch (err) {
        showToast('Error al aceptar', 'error');
    }
}

function openDifferenceModal(recordId) {
    const modal = document.getElementById('differenceModal');
    if (!modal) return;
    document.getElementById('differenceRecordId').value = recordId;
    document.getElementById('differenceNote').value = '';
    openModal('differenceModal');
}

function closeDifferenceModal() {
    closeModal('differenceModal');
}

async function submitDifference() {
    if (!currentUser) return;
    const recordId = document.getElementById('differenceRecordId').value;
    const note = document.getElementById('differenceNote').value.trim();
    if (!note) {
        showToast('Escribe una nota describiendo la diferencia', 'error');
        return;
    }
    try {
        await db.ref(`workerRecords/${currentUser.uid}/${recordId}`).update({
            status: 'difference_reported',
            workerNote: note
        });
        const snap = await db.ref(`workerRecords/${currentUser.uid}/${recordId}/bossUid`).once('value');
        const bossUid = snap.val();
        if (bossUid) {
            await createNotification(bossUid, 'difference_reported', recordId);
        }
        closeDifferenceModal();
        showToast('Diferencia reportada');
    } catch (err) {
        showToast('Error al reportar', 'error');
    }
}

// ============================================
// PAYMENT CONFIRMATION - BOSS SIDE
// ============================================

async function markWorkerPaid(bossRecordId, workerId, workerLinkedUid) {
    if (!currentUser) return;
    try {
        await db.ref(`bossHarvest/${currentUser.uid}/${bossRecordId}/paymentStatus/${workerId}`).set('boss_confirmed');
        if (workerLinkedUid) {
            // Update workerRecord too
            await db.ref(`workerRecords/${workerLinkedUid}/${bossRecordId}/paymentStatus`).set('boss_confirmed');
            await createNotification(workerLinkedUid, 'boss_payment_confirmed', bossRecordId);
        }
        showToast('Pago marcado');
    } catch (err) {
        showToast('Error al marcar pago', 'error');
    }
}

async function confirmBossPayment(bossRecordId, workerId, bossUid) {
    if (!currentUser) return;
    try {
        // Use workerId from workerRecord if available (more reliable)
        let actualWorkerId = workerId;
        if (!actualWorkerId || actualWorkerId === bossRecordId) {
            const wrSnap = await db.ref(`workerRecords/${currentUser.uid}/${bossRecordId}/workerId`).once('value');
            actualWorkerId = wrSnap.val() || workerId;
        }
        // Boss side
        await db.ref(`bossHarvest/${bossUid}/${bossRecordId}/paymentStatus/${actualWorkerId}`).set('completed');
        // Worker side
        await db.ref(`workerRecords/${currentUser.uid}/${bossRecordId}/paymentStatus`).set('completed');
        await createNotification(bossUid, 'worker_payment_confirmed', bossRecordId);
        showToast('Pago confirmado');
    } catch (err) {
        showToast('Error al confirmar', 'error');
    }
}

// Worker initiates payment flow
async function workerInitiatePayment(bossRecordId, bossUid) {
    if (!currentUser) return;
    try {
        // Get workerId from workerRecord
        const wrSnap = await db.ref(`workerRecords/${currentUser.uid}/${bossRecordId}/workerId`).once('value');
        const workerId = wrSnap.val();
        await db.ref(`workerRecords/${currentUser.uid}/${bossRecordId}/paymentStatus`).set('worker_confirmed');
        // Also update boss side if we have workerId
        if (workerId) {
            await db.ref(`bossHarvest/${bossUid}/${bossRecordId}/paymentStatus/${workerId}`).set('worker_confirmed');
        }
        await createNotification(bossUid, 'payment_request', bossRecordId);
        showToast('Solicitud de pago enviada');
    } catch (err) {
        showToast('Error al solicitar', 'error');
    }
}

// Boss confirms worker-initiated payment
async function bossConfirmWorkerPayment(bossRecordId, workerId, workerLinkedUid) {
    if (!currentUser) return;
    try {
        await db.ref(`bossHarvest/${currentUser.uid}/${bossRecordId}/paymentStatus/${workerId}`).set('completed');
        if (workerLinkedUid) {
            await db.ref(`workerRecords/${workerLinkedUid}/${bossRecordId}/paymentStatus`).set('completed');
            await createNotification(workerLinkedUid, 'payment_completed', bossRecordId);
        }
        showToast('Pago confirmado');
    } catch (err) {
        showToast('Error al confirmar', 'error');
    }
}

// ============================================
// RENDER ENTRIES - MIXED (override renderEntries)
// ============================================

{
    const _origRenderEntries = renderEntries;

    renderEntries = function() {
        const list = document.getElementById('entriesList');

        updateFruitFilter();

        const fruitFilter = document.getElementById('filterFruit')?.value || '';

        // Filter own entries
        let filteredOwn = entries.filter(e => {
            const jobData = getEntryJobData(e);
            if (fruitFilter && jobData.product !== fruitFilter) return false;
            if (paymentFilter === 'pending' && e.paid) return false;
            if (paymentFilter === 'paid' && !e.paid) return false;
            return true;
        }).map(e => ({ ...e, _source: 'own' }));

        // Filter boss records
        let filteredBoss = workerRecords.filter(wr => {
            if (fruitFilter && wr.product !== fruitFilter) return false;
            if (paymentFilter === 'paid' && wr.paymentStatus !== 'completed') return false;
            if (paymentFilter === 'pending' && wr.paymentStatus === 'completed') return false;
            return true;
        }).map(wr => ({ ...wr, _source: 'boss' }));

        // Merge and sort chronologically
        let allEntries = [...filteredOwn, ...filteredBoss];
        allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Selection mode sorting
        if (selectionMode && selectedEntries.size > 0) {
            const selectedList = allEntries.filter(e => e._source === 'own' && selectedEntries.has(e.id));
            const unselectedList = allEntries.filter(e => !(e._source === 'own' && selectedEntries.has(e.id)));
            selectedList.sort((a, b) => new Date(b.date) - new Date(a.date));
            allEntries = [...selectedList, ...unselectedList];
        }

        if (allEntries.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📋</div>
                    <h3>No hay registros</h3>
                    <p>${(entries.length + workerRecords.length) > 0 ? 'No hay registros con estos filtros' : 'Agrega tu primer registro de cosecha'}</p>
                </div>
            `;
            return;
        }

        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

        // Group by month
        const groupedByMonth = {};
        allEntries.forEach(e => {
            const date = new Date(e.date + 'T12:00:00');
            const monthKey = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
            if (!groupedByMonth[monthKey]) {
                groupedByMonth[monthKey] = {
                    year: date.getFullYear(),
                    month: date.getMonth(),
                    entries: [],
                    total: 0
                };
            }
            groupedByMonth[monthKey].entries.push(e);
            groupedByMonth[monthKey].total += (e.total || 0);
        });

        const sortedMonths = Object.keys(groupedByMonth).sort().reverse();

        // Build grouped entries (same day + same product = grouped card)
        let html = '';
        sortedMonths.forEach(monthKey => {
            const group = groupedByMonth[monthKey];
            const monthLabel = `${monthNames[group.month]} ${group.year}`;

            html += `
                <div class="month-separator">
                    <span class="month-separator-title">${monthLabel}</span>
                    <span class="month-separator-line"></span>
                    <span class="month-separator-stats">${group.entries.length} registros - <span class="total">$${group.total.toFixed(2)}</span></span>
                </div>
            `;

            // Group same-day same-product entries (own + boss)
            const processed = new Set();
            group.entries.forEach((e, idx) => {
                if (processed.has(idx)) return;
                processed.add(idx);

                const date = new Date(e.date + 'T12:00:00');
                const dayName = dayNames[date.getDay()];
                const dateStr = `${date.getDate()} ${monthNames[date.getMonth()].substring(0, 3)}`;

                if (e._source === 'boss') {
                    // Check if there's an own record for same day+product
                    const matchIdx = group.entries.findIndex((other, oi) => {
                        return oi !== idx && !processed.has(oi) && other._source === 'own' &&
                               other.date === e.date && getEntryJobData(other).product === e.product;
                    });

                    if (matchIdx >= 0) {
                        processed.add(matchIdx);
                        const ownEntry = group.entries[matchIdx];
                        html += renderGroupedCard(e, ownEntry, dayName, dateStr);
                    } else {
                        html += renderBossCard(e, dayName, dateStr);
                    }
                } else if (e._source === 'own') {
                    // Check if boss record matches
                    const matchIdx = group.entries.findIndex((other, oi) => {
                        return oi !== idx && !processed.has(oi) && other._source === 'boss' &&
                               other.date === e.date && other.product === getEntryJobData(e).product;
                    });

                    if (matchIdx >= 0) {
                        processed.add(matchIdx);
                        const bossEntry = group.entries[matchIdx];
                        html += renderGroupedCard(bossEntry, e, dayName, dateStr);
                    } else {
                        html += renderOwnCard(e, dayName, dateStr);
                    }
                }
            });
        });

        list.innerHTML = html;

        // Re-attach entry card events for own records
        list.querySelectorAll('.entry-card[data-entry-id]').forEach(card => {
            const entryId = card.dataset.entryId;
            if (!entryId || card.dataset.source === 'boss') return;
            let pressTimer;
            card.onclick = (ev) => {
                if (longPressTriggered) { longPressTriggered = false; return; }
                if (ev.ctrlKey || ev.metaKey || selectionMode) {
                    toggleEntrySelection(entryId);
                } else {
                    openEntryModal(entryId);
                }
            };
            const startPress = () => {
                longPressTriggered = false;
                pressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    selectionMode = true;
                    toggleEntrySelection(entryId);
                    showToast('Modo selección activado');
                }, 500);
            };
            const cancelPress = () => clearTimeout(pressTimer);
            card.addEventListener('mousedown', startPress);
            card.addEventListener('touchstart', startPress, { passive: true });
            card.addEventListener('mouseup', cancelPress);
            card.addEventListener('touchend', cancelPress);
            card.addEventListener('mouseleave', cancelPress);
        });

        // Toggle grouped cards
        list.querySelectorAll('.grouped-toggle').forEach(btn => {
            btn.onclick = () => {
                const card = btn.closest('.entry-card-grouped');
                if (card) card.classList.toggle('expanded');
            };
        });
    };
}

function renderOwnCard(e, dayName, dateStr) {
    const jobData = getEntryJobData(e);
    const fruta = escapeHtml(jobData.product || 'Sin trabajo');
    const safeEmployer = escapeHtml(jobData.employer || '');
    const precio = '$' + (e.total || 0).toFixed(2);
    const isSelected = selectedEntries.has(e.id);

    return `
        <div class="entry-card ${isSelected ? 'selected' : ''}" data-entry-id="${e.id}" data-source="own">
            <div class="entry-info">
                <div class="entry-date">${dayName} - ${dateStr} - ${fruta}</div>
                <div class="entry-details">${e.quantity ? e.quantity + ' unidades' : 'Jornada'} ${safeEmployer ? '• ' + safeEmployer : ''} ${e.paid ? '• Pagado' : '• Pendiente'}</div>
            </div>
            <div class="entry-amount">
                <div class="entry-total">${precio}</div>
            </div>
        </div>
    `;
}

function renderBossCard(wr, dayName, dateStr) {
    const fruta = escapeHtml(wr.product || '');
    const safeEmployer = escapeHtml(wr.employer || '');
    const precio = '$' + (wr.total || 0).toFixed(2);
    const statusBadge = getBossRecordStatusBadge(wr);
    const actionButtons = getBossRecordActions(wr);
    const unitLabel = wr.unit && unitNames[wr.unit] ? unitNames[wr.unit] : '';
    const priceInfo = wr.pricePerUnit ? '$' + wr.pricePerUnit + '/' + (unitLabel || 'ud') : '';

    return `
        <div class="entry-card boss-record" data-entry-id="${wr.id}" data-source="boss">
            <div class="entry-info">
                <div class="entry-date">${dayName} - ${dateStr} - ${fruta}</div>
                <div class="entry-details">${priceInfo} ${safeEmployer ? '• ' + safeEmployer : ''}</div>
                <span class="boss-record-badge">Registrado por jefe</span>
                ${statusBadge}
            </div>
            <div class="entry-amount">
                <div class="entry-total">${precio}</div>
            </div>
            ${actionButtons}
        </div>
    `;
}

function renderGroupedCard(bossEntry, ownEntry, dayName, dateStr) {
    const fruta = escapeHtml(bossEntry.product || getEntryJobData(ownEntry).product || '');
    const ownTotal = (ownEntry.total || 0).toFixed(2);
    const bossTotal = (bossEntry.total || 0).toFixed(2);
    const statusBadge = getBossRecordStatusBadge(bossEntry);
    const actionButtons = getBossRecordActions(bossEntry);

    return `
        <div class="entry-card-grouped" data-entry-id="${ownEntry.id}" data-boss-id="${bossEntry.id}">
            <div class="grouped-header" >
                <div class="entry-info">
                    <div class="entry-date">${dayName} - ${dateStr} - ${fruta}</div>
                    <span class="grouped-badge">Tu registro + Jefe</span>
                    ${statusBadge}
                </div>
                <button class="grouped-toggle" aria-label="Expandir">▼</button>
            </div>
            <div class="grouped-body">
                <div class="grouped-comparison">
                    <div class="grouped-side own-side">
                        <div class="grouped-side-label">Tu registro</div>
                        <div class="grouped-side-qty">${ownEntry.quantity || '-'} uds</div>
                        <div class="grouped-side-total">$${ownTotal}</div>
                    </div>
                    <div class="grouped-divider"></div>
                    <div class="grouped-side boss-side">
                        <div class="grouped-side-label">Registro jefe</div>
                        <div class="grouped-side-qty">${bossEntry.pricePerUnit ? '$' + bossEntry.pricePerUnit + '/' + (unitNames[bossEntry.unit] || 'ud') : '-'}</div>
                        <div class="grouped-side-total">$${bossTotal}</div>
                    </div>
                </div>
                ${actionButtons}
            </div>
        </div>
    `;
}

function getBossRecordStatusBadge(wr) {
    const ps = wr.paymentStatus;
    if (wr.status === 'difference_reported') {
        return '<span class="payment-badge difference">Diferencia pendiente</span>';
    }
    if (ps === 'completed') {
        return '<span class="payment-badge completed">Pagado ✓✓</span>';
    }
    if (ps === 'boss_confirmed') {
        return '<span class="payment-badge boss-confirmed blink">Pago recibido — ¿Confirmar?</span>';
    }
    if (ps === 'worker_confirmed') {
        return '<span class="payment-badge worker-confirmed">Esperando confirmación del jefe</span>';
    }
    if (wr.status === 'accepted') {
        return '<span class="payment-badge accepted">Aceptado</span>';
    }
    if (wr.status === 'pending_review') {
        return '<span class="payment-badge pending-pay">Pendiente de revisión</span>';
    }
    return '';
}

function getBossRecordActions(wr) {
    if (wr.status === 'difference_reported') {
        return `<div class="boss-record-actions"><span class="difference-note">Nota: ${escapeHtml(wr.workerNote || '')}</span></div>`;
    }
    if (wr.paymentStatus === 'completed') {
        return '';
    }
    if (wr.paymentStatus === 'boss_confirmed') {
        return `
            <div class="boss-record-actions">
                <button class="btn btn-sm btn-confirm" onclick="event.stopPropagation(); confirmBossPayment('${wr.bossRecordId || wr.id}', '${wr.workerId || ''}', '${wr.bossUid}')">Confirmar Pago</button>
            </div>
        `;
    }
    if (wr.status === 'accepted' && wr.paymentStatus !== 'worker_confirmed') {
        return `
            <div class="boss-record-actions">
                <button class="btn btn-sm btn-pay" onclick="event.stopPropagation(); workerInitiatePayment('${wr.bossRecordId || wr.id}', '${wr.bossUid}')">Solicitar Pago</button>
            </div>
        `;
    }
    if (wr.status === 'pending_review') {
        return `
            <div class="boss-record-actions">
                <button class="btn btn-sm btn-accept" onclick="event.stopPropagation(); acceptBossRecord('${wr.id}')">Aceptar</button>
                <button class="btn btn-sm btn-difference" onclick="event.stopPropagation(); openDifferenceModal('${wr.id}')">Reportar diferencia</button>
            </div>
        `;
    }
    return '';
}

// ============================================
// BOSS DAY MODAL - PAYMENT PER WORKER
// ============================================

{
    const _origOpenBossDayModal = openBossDayModal;

    openBossDayModal = function(dateStr, dayEntries) {
        const date = new Date(dateStr + 'T12:00:00');
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('bossDayModalTitle').textContent = date.toLocaleDateString('es-ES', options);

        const list = document.getElementById('bossDayEntriesList');
        if (dayEntries.length === 0) {
            list.innerHTML = '<p class="modal-empty-text">No hay registros para este día</p>';
        } else {
            list.innerHTML = dayEntries.map(entry => {
                let totalPaid = 0;
                let workerCount = 0;

                const squadName = entry.squadSnapshot ? escapeHtml(entry.squadSnapshot.name) : 'Cuadrilla';
                const product = escapeHtml(entry.product || '');

                // Build member breakdown with payment buttons
                let membersHtml = '';
                if (entry.squadSnapshot && entry.squadSnapshot.members && entry.totalByMember) {
                    const members = entry.squadSnapshot.members;
                    const wids = Object.keys(members);
                    workerCount = wids.length;
                    totalPaid = wids.reduce((s, w) => s + (entry.totalByMember[w] || 0), 0);

                    membersHtml = '<div class="boss-day-members">' + wids.map(wid => {
                        const m = members[wid];
                        const memberTotal = (entry.totalByMember[wid] || 0).toFixed(2);
                        const payStatus = entry.paymentStatus ? entry.paymentStatus[wid] : 'pending';
                        const safeName = escapeHtml(m.displayName || wid);
                        let payBtn = '';

                        if (payStatus === 'completed') {
                            payBtn = '<span class="payment-badge completed">Pagado ✓✓</span>';
                        } else if (payStatus === 'boss_confirmed') {
                            payBtn = '<span class="payment-badge boss-confirmed">Esperando confirmación</span>';
                        } else if (payStatus === 'worker_confirmed') {
                            payBtn = `<button class="btn btn-sm btn-confirm" onclick="event.stopPropagation(); bossConfirmWorkerPayment('${entry.id}', '${wid}', '${m.linkedUid || ''}')">Confirmar Pago</button>`;
                        } else {
                            payBtn = `<button class="btn btn-sm btn-pay" onclick="event.stopPropagation(); markWorkerPaid('${entry.id}', '${wid}', '${m.linkedUid || ''}')">Marcar Pagado</button>`;
                        }

                        // Share link button
                        const shareBtn = m.rut
                            ? `<button class="btn btn-sm btn-share" onclick="event.stopPropagation(); generatePublicLink('${escapeHtml(m.rut)}', '${entry.id}')" title="Compartir link">🔗</button>`
                            : '';

                        return `
                            <div class="boss-day-member-row">
                                <span class="member-name">${safeName}</span>
                                <span class="member-total">$${memberTotal}</span>
                                <div class="member-actions">${payBtn}${shareBtn}</div>
                            </div>
                        `;
                    }).join('') + '</div>';
                }

                return `
                    <div class="entry-card boss-day-entry">
                        <div class="entry-info">
                            <div class="entry-date">${product} - ${squadName}</div>
                            <div class="entry-details">${workerCount} personas</div>
                        </div>
                        <div class="entry-total">$${totalPaid.toFixed(2)}</div>
                    </div>
                    ${membersHtml}
                `;
            }).join('');
        }

        openModal('bossDayModal');
    };
}

// ============================================
// PUBLIC LINK - TOKEN GENERATION
// ============================================

function generateToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 4; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

async function generatePublicLink(rut, recordId) {
    if (!currentUser || !rut) {
        showToast('RUT no disponible', 'error');
        return;
    }

    // Normalize rut for path (remove dots and dashes)
    const normalizedRut = rut.replace(/[.\-]/g, '');
    const token = generateToken();
    const now = Date.now();
    const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days

    try {
        await db.ref(`publicTokens/${normalizedRut}/${token}`).set({
            createdAt: now,
            expiresAt,
            bossUid: currentUser.uid
        });

        const baseUrl = window.location.origin + window.location.pathname;
        const consultaUrl = baseUrl.replace('cosecha.html', 'consulta.html') + `?id=${encodeURIComponent(rut)}&t=${token}`;

        // Show link modal
        showPublicLinkModal(consultaUrl);
    } catch (err) {
        showToast('Error al generar link', 'error');
    }
}

function showPublicLinkModal(url) {
    const modal = document.getElementById('publicLinkModal');
    const linkInput = document.getElementById('publicLinkUrl');
    if (!modal || !linkInput) return;
    linkInput.value = url;
    openModal('publicLinkModal');
}

function closePublicLinkModal() {
    closeModal('publicLinkModal');
}

function copyPublicLink() {
    const linkInput = document.getElementById('publicLinkUrl');
    if (!linkInput) return;
    linkInput.select();
    navigator.clipboard.writeText(linkInput.value).then(() => {
        showToast('Link copiado');
    }).catch(() => {
        document.execCommand('copy');
        showToast('Link copiado');
    });
}

// ============================================
// HOOK INTO AUTH STATE
// ============================================

{
    const _origLoadData = loadData;
    loadData = function() {
        _origLoadData();
        loadWorkerRecords();
        loadNotifications();
    };
}

// Hook into logout / unload
{
    const _origAuthListener = auth.onAuthStateChanged;
    // Add a secondary listener for cleanup
    auth.onAuthStateChanged((user) => {
        if (!user) {
            unloadWorkerRecords();
            unloadNotifications();
        }
    });
}

// ============================================
// INIT - Escape key for new modals
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const diffModal = document.getElementById('differenceModal');
            if (diffModal && diffModal.classList.contains('visible')) {
                closeDifferenceModal();
                e.stopImmediatePropagation();
                return;
            }
            const linkModal = document.getElementById('publicLinkModal');
            if (linkModal && linkModal.classList.contains('visible')) {
                closePublicLinkModal();
                e.stopImmediatePropagation();
                return;
            }
        }
    });
});
