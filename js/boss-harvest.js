/**
 * Boss Harvest Module
 * HarvestCalendar class + Boss registration modal + Boss calendar
 */

// ============================================
// HARVEST CALENDAR CLASS
// ============================================

class HarvestCalendar {
    /**
     * @param {string} containerId - ID of the grid div
     * @param {string} monthDisplayId - ID of the month label span
     * @param {Function} dataSource - returns array of entries
     * @param {"worker"|"boss"} mode
     */
    constructor(containerId, monthDisplayId, dataSource, mode = 'worker') {
        this.containerId = containerId;
        this.monthDisplayId = monthDisplayId;
        this.dataSource = dataSource;
        this.mode = mode;
        this.currentDate = new Date();
        this.onDayClick = null; // callback(dateStr, dayEntries)
    }

    changeMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.render();
    }

    render() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const monthDisplay = document.getElementById(this.monthDisplayId);
        if (monthDisplay) monthDisplay.textContent = `${monthNames[month]} ${year}`;

        const grid = document.getElementById(this.containerId);
        if (!grid) return;
        grid.innerHTML = '';

        const entries = this.dataSource();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        // Day headers
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        dayNames.forEach((day, idx) => {
            const header = document.createElement('div');
            header.className = 'calendar-day-header';
            if (idx === 0) header.classList.add('sunday');
            if (idx === 6) header.classList.add('saturday');
            header.textContent = day;
            grid.appendChild(header);
        });

        // Previous month padding
        const prevMonth = new Date(year, month, 0);
        for (let i = startDay - 1; i >= 0; i--) {
            const dayOfWeek = startDay - 1 - i;
            const prevDayNum = prevMonth.getDate() - i;
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            if (dayOfWeek === 0) day.classList.add('sunday');
            if (dayOfWeek === 6) day.classList.add('saturday');
            day.innerHTML = `<span class="day-number">${prevDayNum}</span>`;
            day.onclick = () => this.changeMonth(-1);
            grid.appendChild(day);
        }

        const today = new Date();

        for (let i = 1; i <= daysInMonth; i++) {
            const dayDate = new Date(year, month, i);
            const dayOfWeek = dayDate.getDay();
            const day = document.createElement('div');
            day.className = 'calendar-day';

            if (dayOfWeek === 0) day.classList.add('sunday');
            if (dayOfWeek === 6) day.classList.add('saturday');

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const dayEntries = entries.filter(e => e.date === dateStr);

            if (today.getDate() === i && today.getMonth() === month && today.getFullYear() === year) {
                day.classList.add('today');
            }

            if (this.mode === 'worker') {
                this._renderWorkerDay(day, dayEntries, dateStr);
            } else {
                this._renderBossDay(day, dayEntries, dateStr, i);
            }

            day.onclick = () => {
                if (this.onDayClick) this.onDayClick(dateStr, dayEntries);
            };

            grid.appendChild(day);
        }

        // Next month padding
        const totalCells = startDay + daysInMonth;
        const totalRows = Math.ceil(totalCells / 7);
        const remainingDays = (totalRows * 7) - totalCells;

        for (let i = 1; i <= remainingDays; i++) {
            const dayDate = new Date(year, month + 1, i);
            const dayOfWeek = dayDate.getDay();
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            if (dayOfWeek === 0) day.classList.add('sunday');
            if (dayOfWeek === 6) day.classList.add('saturday');
            day.innerHTML = `<span class="day-number">${i}</span>`;
            day.onclick = () => this.changeMonth(1);
            grid.appendChild(day);
        }
    }

    _renderWorkerDay(dayEl, dayEntries, dateStr) {
        const dayTotal = dayEntries.reduce((sum, e) => sum + (e.total || 0), 0);
        const hasPending = dayEntries.some(e => !e.paid);
        const dayNum = parseInt(dateStr.split('-')[2], 10);

        if (dayEntries.length > 0) {
            dayEl.classList.add(hasPending ? 'has-pending' : 'has-entries');
        }

        if (selectedDays && selectedDays.has(dateStr)) {
            dayEl.classList.add('selected');
        }

        const dayNotes = dayEntries.filter(e => e.notes).map(e => e.notes).join(' | ');
        const truncatedNotes = dayNotes.length > 30 ? dayNotes.substring(0, 30) + '...' : dayNotes;

        dayEl.innerHTML = `
            <span class="day-number">${dayNum}</span>
            ${dayEntries.length > 0 ? `<span class="day-entries-count">${dayEntries.length} reg</span>` : ''}
            ${dayTotal > 0 ? `<span class="day-amount">$${dayTotal.toFixed(0)}</span>` : ''}
            ${truncatedNotes ? `<span class="day-notes">${escapeHtml(truncatedNotes)}</span>` : ''}
        `;
    }

    _renderBossDay(dayEl, dayEntries, dateStr, dayNum) {
        if (dayEntries.length === 0) {
            dayEl.innerHTML = `<span class="day-number">${dayNum}</span>`;
            return;
        }

        // Calculate total paid to squad this day
        let totalPaid = 0;
        const workerIds = new Set();
        let hasNonCompleted = false;

        dayEntries.forEach(entry => {
            if (entry.totalByMember) {
                Object.keys(entry.totalByMember).forEach(wid => {
                    totalPaid += entry.totalByMember[wid] || 0;
                    workerIds.add(wid);
                });
            }
            if (entry.paymentStatus) {
                Object.values(entry.paymentStatus).forEach(status => {
                    if (status !== 'completed') hasNonCompleted = true;
                });
            }
        });

        dayEl.classList.add(hasNonCompleted ? 'has-pending' : 'has-entries');

        dayEl.innerHTML = `
            <span class="day-number">${dayNum}</span>
            <span class="day-entries-count">${workerIds.size} pers</span>
            <span class="day-amount">$${totalPaid.toFixed(0)}</span>
            ${hasNonCompleted ? '<span class="day-alert-icon">⚠</span>' : ''}
        `;
    }
}

// ============================================
// BOSS HARVEST STATE
// ============================================
let bossEntries = [];
let bossEntriesLoaded = false;
let bossCalendar = null;
let bossCurrentDate = new Date();

// Modal state
let bossModalStep = 1;
let bossActiveMembers = {}; // workerId -> { displayName, username, rut, linkedUid, active }
let bossBinSegmentsList = []; // [{ bins: 0, memberIds: [...] }]

// ============================================
// BOSS CALENDAR
// ============================================

function initBossCalendar() {
    if (bossCalendar) return;
    bossCalendar = new HarvestCalendar(
        'bossCalendarGrid',
        'bossCurrentMonth',
        () => bossEntries,
        'boss'
    );
    bossCalendar.onDayClick = (dateStr, dayEntries) => {
        openBossDayModal(dateStr, dayEntries);
    };
    bossCalendar.render();
}

function changeBossMonth(delta) {
    if (bossCalendar) {
        bossCalendar.changeMonth(delta);
    }
}

function renderBossCalendar() {
    if (bossCalendar) bossCalendar.render();
}

// ============================================
// BOSS DATA LOADING
// ============================================

let bossHarvestListening = false;

function loadBossHarvestData() {
    if (!currentUser || bossHarvestListening) return;
    bossHarvestListening = true;

    db.ref(`bossHarvest/${currentUser.uid}`).on('value', (snapshot) => {
        bossEntries = [];
        snapshot.forEach((child) => {
            bossEntries.push({ id: child.key, ...child.val() });
        });
        bossEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
        bossEntriesLoaded = true;
        renderBossCalendar();
    });
}

function unloadBossHarvestData() {
    if (currentUser) {
        db.ref(`bossHarvest/${currentUser.uid}`).off();
    }
    bossEntries = [];
    bossEntriesLoaded = false;
    bossHarvestListening = false;
}

// ============================================
// BOSS DAY MODAL
// ============================================

function openBossDayModal(dateStr, dayEntries) {
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
            let hasAlert = false;

            if (entry.totalByMember) {
                const wids = Object.keys(entry.totalByMember);
                workerCount = wids.length;
                totalPaid = wids.reduce((s, w) => s + (entry.totalByMember[w] || 0), 0);
            }
            if (entry.paymentStatus) {
                hasAlert = Object.values(entry.paymentStatus).some(s => s !== 'completed');
            }

            const squadName = entry.squadSnapshot ? escapeHtml(entry.squadSnapshot.name) : 'Cuadrilla';
            const product = escapeHtml(entry.product || '');

            return `
                <div class="entry-card">
                    <div class="entry-info">
                        <div class="entry-date">${product} - ${squadName}</div>
                        <div class="entry-details">${workerCount} personas ${hasAlert ? '• Pago pendiente' : '• Completado'}</div>
                    </div>
                    <div class="entry-total">$${totalPaid.toFixed(2)}</div>
                </div>
            `;
        }).join('');
    }

    openModal('bossDayModal');
}

function closeBossDayModal() {
    closeModal('bossDayModal');
}

// ============================================
// BOSS ENTRY MODAL (3-step wizard)
// ============================================

function openBossEntryModal() {
    bossModalStep = 1;
    bossActiveMembers = {};
    bossBinSegmentsList = [];

    // Set date
    document.getElementById('bossEntryDate').value = getLocalDateString();

    // Populate squad select
    const select = document.getElementById('bossSquadSelect');
    let opts = '<option value="">Seleccionar cuadrilla</option>';
    squads.forEach(s => {
        opts += `<option value="${s.id}">${escapeHtml(s.name)} (${(s.memberIds || []).length})</option>`;
    });
    select.innerHTML = opts;

    // Reset
    document.getElementById('bossSquadMembersGroup').style.display = 'none';
    document.getElementById('bossSquadMembersList').innerHTML = '';

    // Populate product select: catálogo por categorías + personalizados de los trabajos
    const productSelect = document.getElementById('bossProduct');
    let pOpts = '<option value="">Seleccionar producto o tarea</option>';
    const catalogNames = new Set();

    WORK_CATEGORIES.forEach(cat => {
        pOpts += `<optgroup label="${cat.emoji} ${escapeHtml(cat.name)}">`;
        cat.tasks.forEach(t => {
            catalogNames.add(normalizeName(t.name));
            pOpts += `<option value="${escapeHtml(t.name)}">${t.emoji} ${escapeHtml(t.name)}</option>`;
        });
        pOpts += '</optgroup>';
    });

    // Tareas personalizadas creadas por el usuario
    const customProducts = [];
    jobs.forEach(j => {
        if (j.product && !catalogNames.has(normalizeName(j.product))) {
            customProducts.push(j.product);
        }
    });
    if (customProducts.length > 0) {
        pOpts += '<optgroup label="✏️ Personalizados">';
        customProducts.sort().forEach(p => {
            pOpts += `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`;
        });
        pOpts += '</optgroup>';
    }
    productSelect.innerHTML = pOpts;

    // Reset step 2
    document.getElementById('bossUnit').value = 'totens';
    document.getElementById('bossPrice').value = '';
    document.getElementById('bossEmployer').value = '';

    // Reset step 3
    document.getElementById('bossAmountsSection').style.display = 'none';
    document.getElementById('bossBinsSection').style.display = 'none';
    document.getElementById('bossMemberAmountsTable').innerHTML = '';
    document.getElementById('bossBinSegments').innerHTML = '';

    updateBossStepUI();
    openModal('bossEntryModal');
}

function closeBossEntryModal() {
    closeModal('bossEntryModal');
}

function updateBossStepUI() {
    // Step indicators
    document.querySelectorAll('.boss-step-indicator').forEach(ind => {
        const step = parseInt(ind.dataset.step, 10);
        ind.classList.toggle('active', step === bossModalStep);
        ind.classList.toggle('completed', step < bossModalStep);
    });

    // Step panels
    for (let i = 1; i <= 3; i++) {
        const panel = document.getElementById('bossStep' + i);
        if (panel) panel.classList.toggle('active', i === bossModalStep);
    }

    // Buttons
    document.getElementById('bossPrevBtn').style.display = bossModalStep > 1 ? '' : 'none';
    document.getElementById('bossNextBtn').style.display = bossModalStep < 3 ? '' : 'none';
    document.getElementById('bossSaveBtn').style.display = bossModalStep === 3 ? '' : 'none';
}

function bossNextStep() {
    if (bossModalStep === 1) {
        // Validate squad selected and at least one member active
        const squadId = document.getElementById('bossSquadSelect').value;
        if (!squadId) {
            showToast('Selecciona una cuadrilla', 'error');
            return;
        }
        const activeCount = Object.values(bossActiveMembers).filter(m => m.active).length;
        if (activeCount === 0) {
            showToast('Debe haber al menos un miembro activo', 'error');
            return;
        }
        if (!document.getElementById('bossEntryDate').value) {
            showToast('Selecciona una fecha', 'error');
            return;
        }
    }

    if (bossModalStep === 2) {
        if (!document.getElementById('bossProduct').value) {
            showToast('Selecciona un producto', 'error');
            return;
        }
        const price = parseFloat(document.getElementById('bossPrice').value) || 0;
        if (price <= 0) {
            showToast('Ingresa un precio válido', 'error');
            return;
        }

        // Prepare step 3 based on unit
        prepareStep3();
    }

    bossModalStep++;
    updateBossStepUI();
}

function bossPrevStep() {
    if (bossModalStep > 1) {
        bossModalStep--;
        updateBossStepUI();
    }
}

// ============================================
// STEP 1: Squad selection
// ============================================

function onBossSquadSelect() {
    const squadId = document.getElementById('bossSquadSelect').value;
    bossActiveMembers = {};

    if (!squadId) {
        document.getElementById('bossSquadMembersGroup').style.display = 'none';
        return;
    }

    const squad = squads.find(s => s.id === squadId);
    if (!squad) return;

    // Build members from squad's memberIds
    (squad.memberIds || []).forEach(wid => {
        const worker = bossWorkers.find(w => w.id === wid);
        if (worker) {
            bossActiveMembers[wid] = {
                displayName: worker.displayName,
                username: worker.username || null,
                rut: worker.rut || null,
                linkedUid: worker.linkedUid || null,
                active: true
            };
        }
    });

    renderBossSquadMembers();
    document.getElementById('bossSquadMembersGroup').style.display = '';
}

function renderBossSquadMembers() {
    const list = document.getElementById('bossSquadMembersList');
    const memberIds = Object.keys(bossActiveMembers);

    if (memberIds.length === 0) {
        list.innerHTML = '<div class="squad-no-members">Esta cuadrilla no tiene miembros</div>';
        return;
    }

    list.innerHTML = memberIds.map(wid => {
        const m = bossActiveMembers[wid];
        const safeName = escapeHtml(m.displayName);
        const checked = m.active ? 'checked' : '';
        return `
            <label class="boss-member-check">
                <input type="checkbox" ${checked} onchange="toggleBossMember('${wid}', this.checked)">
                <span class="boss-member-name">${safeName}</span>
                ${m.linkedUid ? '<span class="worker-badge linked small">Vinculado</span>' : ''}
            </label>
        `;
    }).join('');
}

function toggleBossMember(workerId, active) {
    if (bossActiveMembers[workerId]) {
        bossActiveMembers[workerId].active = active;
    }
}

// ============================================
// STEP 3: Amounts preparation
// ============================================

function onBossUnitChange() {
    // Just update UI state, step 3 is prepared on enter
}

function prepareStep3() {
    const unit = document.getElementById('bossUnit').value;
    const price = parseFloat(document.getElementById('bossPrice').value) || 0;
    const activeMembers = Object.entries(bossActiveMembers).filter(([, m]) => m.active);

    if (unit === 'bins') {
        // Bins mode: segments
        document.getElementById('bossAmountsSection').style.display = 'none';
        document.getElementById('bossBinsSection').style.display = '';

        // Start with one segment containing all active members
        bossBinSegmentsList = [{
            bins: 0,
            memberIds: activeMembers.map(([id]) => id)
        }];

        renderBossSegments();
    } else {
        // Non-bins: per-member amounts
        document.getElementById('bossAmountsSection').style.display = '';
        document.getElementById('bossBinsSection').style.display = 'none';

        document.getElementById('bossAmountUnitLabel').textContent = `(${unitQuantityLabels[unit] || 'unidades'})`;

        renderBossMemberAmounts();
    }
}

function renderBossMemberAmounts() {
    const table = document.getElementById('bossMemberAmountsTable');
    const price = parseFloat(document.getElementById('bossPrice').value) || 0;
    const activeMembers = Object.entries(bossActiveMembers).filter(([, m]) => m.active);

    table.innerHTML = activeMembers.map(([wid, m]) => {
        const safeName = escapeHtml(m.displayName);
        return `
            <div class="boss-amount-row">
                <span class="boss-amount-name">${safeName}</span>
                <input type="number" class="boss-amount-input" id="bossAmt_${wid}"
                    placeholder="0" step="0.5" min="0"
                    oninput="calculateBossAmountsTotal()">
                <span class="boss-amount-value" id="bossAmtVal_${wid}">$0</span>
            </div>
        `;
    }).join('');

    calculateBossAmountsTotal();
}

function calculateBossAmountsTotal() {
    const price = parseFloat(document.getElementById('bossPrice').value) || 0;
    const activeMembers = Object.entries(bossActiveMembers).filter(([, m]) => m.active);
    let grandTotal = 0;

    activeMembers.forEach(([wid]) => {
        const input = document.getElementById('bossAmt_' + wid);
        const valEl = document.getElementById('bossAmtVal_' + wid);
        if (input && valEl) {
            const qty = parseFloat(input.value) || 0;
            const total = qty * price;
            valEl.textContent = '$' + total.toFixed(0);
            grandTotal += total;
        }
    });

    document.getElementById('bossAmountsTotal').textContent = 'Total cuadrilla: $' + grandTotal.toFixed(2);
}

// ============================================
// STEP 3: Bins segments
// ============================================

function renderBossSegments() {
    const container = document.getElementById('bossBinSegments');
    container.innerHTML = '';

    bossBinSegmentsList.forEach((seg, idx) => {
        const isFirst = idx === 0;
        const segEl = document.createElement('div');
        segEl.className = 'boss-segment';

        let membersHtml = '';
        if (isFirst) {
            // First segment: all active members (read-only list)
            membersHtml = `<div class="boss-segment-members-label">${seg.memberIds.length} miembros activos</div>`;
        } else {
            // Subsequent segments: checkboxes to mark who stayed
            const prevMembers = bossBinSegmentsList[idx - 1].memberIds;
            membersHtml = `
                <div class="boss-segment-members-label">Quién se retiró:</div>
                <div class="boss-segment-checkboxes">
                    ${prevMembers.map(wid => {
                        const m = bossActiveMembers[wid];
                        if (!m) return '';
                        const retired = !seg.memberIds.includes(wid);
                        return `
                            <label class="boss-member-check small">
                                <input type="checkbox" ${retired ? 'checked' : ''}
                                    onchange="toggleSegmentMember(${idx}, '${wid}', !this.checked)">
                                <span class="boss-member-name">${escapeHtml(m.displayName)}</span>
                            </label>
                        `;
                    }).filter(Boolean).join('')}
                </div>
            `;
        }

        segEl.innerHTML = `
            <div class="boss-segment-header">
                <span class="boss-segment-title">Segmento ${idx + 1}</span>
                ${!isFirst ? `<button type="button" class="boss-segment-remove" onclick="removeBossSegment(${idx})">&times;</button>` : ''}
            </div>
            ${membersHtml}
            <div class="boss-segment-bins-row">
                <label>Bins:</label>
                <input type="number" class="boss-segment-bins-input" id="bossSeg_${idx}"
                    value="${seg.bins || ''}" placeholder="0" min="0" step="0.5"
                    oninput="updateSegmentBins(${idx}, this.value)">
            </div>
        `;

        container.appendChild(segEl);
    });

    calculateBossBinsTotal();
}

function toggleSegmentMember(segIdx, workerId, stayed) {
    const seg = bossBinSegmentsList[segIdx];
    if (!seg) return;

    if (stayed && !seg.memberIds.includes(workerId)) {
        seg.memberIds.push(workerId);
    } else if (!stayed) {
        seg.memberIds = seg.memberIds.filter(id => id !== workerId);
    }

    // Update subsequent segments to also remove this member
    for (let i = segIdx + 1; i < bossBinSegmentsList.length; i++) {
        if (!stayed) {
            bossBinSegmentsList[i].memberIds = bossBinSegmentsList[i].memberIds.filter(id => id !== workerId);
        }
    }

    calculateBossBinsTotal();
}

function updateSegmentBins(segIdx, value) {
    if (bossBinSegmentsList[segIdx]) {
        bossBinSegmentsList[segIdx].bins = parseFloat(value) || 0;
    }
    calculateBossBinsTotal();
}

function addBossSegment() {
    if (bossBinSegmentsList.length === 0) return;

    // New segment starts with same members as last segment
    const lastSeg = bossBinSegmentsList[bossBinSegmentsList.length - 1];
    if (lastSeg.memberIds.length <= 1) {
        showToast('Debe haber al menos 2 personas para crear un nuevo segmento', 'error');
        return;
    }

    bossBinSegmentsList.push({
        bins: 0,
        memberIds: [...lastSeg.memberIds]
    });

    renderBossSegments();
}

function removeBossSegment(segIdx) {
    if (segIdx === 0) return; // Can't remove first
    bossBinSegmentsList.splice(segIdx, 1);
    renderBossSegments();
}

function calculateBossBinsTotal() {
    const price = parseFloat(document.getElementById('bossPrice').value) || 0;
    const totalByMember = {};
    let grandTotal = 0;

    // For each segment, calculate (bins * price) / numberOfMembers
    bossBinSegmentsList.forEach(seg => {
        const bins = seg.bins || 0;
        const count = seg.memberIds.length;
        if (count === 0 || bins === 0) return;

        const perPerson = (bins * price) / count;
        seg.memberIds.forEach(wid => {
            if (!totalByMember[wid]) totalByMember[wid] = 0;
            totalByMember[wid] += perPerson;
        });
        grandTotal += bins * price;
    });

    document.getElementById('bossBinsTotal').textContent = 'Total cuadrilla: $' + grandTotal.toFixed(2);

    // Summary per person
    const summaryEl = document.getElementById('bossBinsSummary');
    const entries = Object.entries(totalByMember);
    if (entries.length === 0) {
        summaryEl.innerHTML = '';
        return;
    }

    summaryEl.innerHTML = '<div class="boss-summary-title">Desglose por persona:</div>' +
        entries.map(([wid, total]) => {
            const m = bossActiveMembers[wid];
            const name = m ? escapeHtml(m.displayName) : wid;
            return `<div class="boss-summary-row"><span>${name}</span><span>$${total.toFixed(2)}</span></div>`;
        }).join('');
}

// ============================================
// SAVE BOSS ENTRY
// ============================================

async function saveBossEntry() {
    if (!currentUser) return;

    const date = document.getElementById('bossEntryDate').value;
    const squadId = document.getElementById('bossSquadSelect').value;
    const product = document.getElementById('bossProduct').value;
    const unit = document.getElementById('bossUnit').value;
    const pricePerUnit = parseFloat(document.getElementById('bossPrice').value) || 0;
    const employer = document.getElementById('bossEmployer').value;

    if (!date || !squadId || !product || pricePerUnit <= 0) {
        showToast('Datos incompletos', 'error');
        return;
    }

    // Build squad snapshot
    const squad = squads.find(s => s.id === squadId);
    const squadSnapshot = {
        name: squad ? squad.name : 'Cuadrilla',
        members: {}
    };

    const activeMembers = Object.entries(bossActiveMembers).filter(([, m]) => m.active);
    activeMembers.forEach(([wid, m]) => {
        squadSnapshot.members[wid] = {
            displayName: m.displayName,
            username: m.username || null,
            rut: m.rut || null,
            linkedUid: m.linkedUid || null
        };
    });

    // Build record
    const record = {
        date,
        squadId,
        squadSnapshot,
        product,
        unit,
        pricePerUnit,
        employer: employer || '',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    // Calculate totalByMember and paymentStatus
    const totalByMember = {};
    const paymentStatus = {};

    if (unit === 'bins') {
        // Bins: calculate from segments
        record.binSegments = bossBinSegmentsList.map(seg => ({
            bins: seg.bins || 0,
            memberIds: [...seg.memberIds]
        }));

        bossBinSegmentsList.forEach(seg => {
            const bins = seg.bins || 0;
            const count = seg.memberIds.length;
            if (count === 0 || bins === 0) return;
            const perPerson = (bins * pricePerUnit) / count;
            seg.memberIds.forEach(wid => {
                if (!totalByMember[wid]) totalByMember[wid] = 0;
                totalByMember[wid] += perPerson;
            });
        });
    } else {
        // Non-bins: read amounts from inputs
        const memberAmounts = {};
        activeMembers.forEach(([wid]) => {
            const input = document.getElementById('bossAmt_' + wid);
            const qty = input ? parseFloat(input.value) || 0 : 0;
            memberAmounts[wid] = qty;
            totalByMember[wid] = qty * pricePerUnit;
        });
        record.memberAmounts = memberAmounts;
    }

    // Validate at least some work recorded
    const totalSum = Object.values(totalByMember).reduce((s, v) => s + v, 0);
    if (totalSum <= 0) {
        showToast('Ingresa cantidades válidas', 'error');
        return;
    }

    record.totalByMember = totalByMember;

    // Payment status for all members
    activeMembers.forEach(([wid]) => {
        paymentStatus[wid] = 'pending';
    });
    record.paymentStatus = paymentStatus;

    // Save
    try {
        const newRef = db.ref(`bossHarvest/${currentUser.uid}`).push();
        const recordId = newRef.key;
        await newRef.set(record);

        // For each member with linkedUid, write to workerRecords
        const workerUpdates = {};
        activeMembers.forEach(([wid, m]) => {
            if (m.linkedUid && totalByMember[wid] > 0) {
                workerUpdates[`workerRecords/${m.linkedUid}/${recordId}`] = {
                    bossUid: currentUser.uid,
                    bossRecordId: recordId,
                    workerId: wid,
                    date,
                    product,
                    unit,
                    pricePerUnit,
                    employer: employer || '',
                    total: totalByMember[wid],
                    status: 'pending_review',
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                };
            }
        });

        if (Object.keys(workerUpdates).length > 0) {
            await db.ref().update(workerUpdates);

            // Send notifications to linked workers
            if (typeof createNotification === 'function') {
                for (const [wid, m] of activeMembers) {
                    if (m.linkedUid && totalByMember[wid] > 0) {
                        createNotification(m.linkedUid, 'new_boss_record', recordId);
                    }
                }
            }
        }

        // Update squad lastUsed
        if (squad) {
            await db.ref(`squads/${currentUser.uid}/${squadId}/lastUsed`).set(Date.now());
        }

        // Update lastWorked for workers
        const workerLastWorked = {};
        activeMembers.forEach(([wid]) => {
            workerLastWorked[`bossWorkers/${currentUser.uid}/${wid}/lastWorked`] = Date.now();
        });
        if (Object.keys(workerLastWorked).length > 0) {
            await db.ref().update(workerLastWorked);
        }

        showToast('Registro de cuadrilla guardado');
        closeBossEntryModal();
    } catch (error) {
        console.error('Error saving boss entry:', error);
        showToast('Error al guardar', 'error');
    }
}

// ============================================
// INTEGRATION: Hook into cuadrilla tab loading
// ============================================

// Override switchCuadrillaTab to also init boss calendar
{
    const _origSwitch = switchCuadrillaTab;
    switchCuadrillaTab = function(tab) {
        currentCuadrillaTab = tab;
        document.querySelectorAll('.subtab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.subsection').forEach(s => s.classList.remove('active'));
        const targetTab = document.querySelector(`.subtab[data-subtab="${tab}"]`);
        if (targetTab) targetTab.classList.add('active');
        const targetSection = document.getElementById(tab + 'Subsection');
        if (targetSection) targetSection.classList.add('active');

        if (tab === 'bossCalendario') {
            initBossCalendar();
            loadBossHarvestData();
        }
    };
}

// Hook into loadCuadrillaData to also load boss harvest
{
    const _origLoad = loadCuadrillaData;
    loadCuadrillaData = function() {
        _origLoad();
        initBossCalendar();
        loadBossHarvestData();
    };
}

// Hook into unloadCuadrillaData
{
    const _origUnload = unloadCuadrillaData;
    unloadCuadrillaData = function() {
        _origUnload();
        unloadBossHarvestData();
    };
}
