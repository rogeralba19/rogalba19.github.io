/**
 * Cosecha App - Harvest Tracking Application
 * Aplicacion para registro de trabajo de cosecha
 */

// State
let currentUser = null;
let jobs = [];
let entries = [];
let currentDate = new Date();
let selectedJob = null;
let selectedDayDate = null;

// Job modal state
let jobType = 'trato';

// Entry modal state
let entryPaid = false;

// Unit names mapping
const unitNames = {
    'totens': 'Totens',
    'capacho_grande': 'Capacho Grande',
    'capacho_pequeno': 'Capacho Pequeño',
    'kilo': 'Kilos',
    'bandeja': 'Bandejas',
    'bins': 'Bins'
};

// Lista de frutas disponibles
const availableFruits = [
    'Fresa',
    'Frambuesa',
    'Arandano',
    'Mora',
    'Cereza',
    'Ciruela',
    'Manzana',
    'Pera',
    'Uva'
];

// Auth listener
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        loadData();
    } else {
        window.location.href = 'index.html';
    }
});

// Load data from Firebase
function loadData() {
    if (!currentUser) return;

    // Load jobs
    db.ref(`jobs/${currentUser.uid}`).on('value', (snapshot) => {
        jobs = [];
        snapshot.forEach((child) => {
            jobs.push({ id: child.key, ...child.val() });
        });

        // Verificar que todas las frutas existan, agregar las faltantes
        checkAndAddMissingFruits();
        renderJobs();
        updateJobSelect();
    });

    // Load entries
    db.ref(`harvest/${currentUser.uid}`).on('value', (snapshot) => {
        entries = [];
        snapshot.forEach((child) => {
            entries.push({ id: child.key, ...child.val() });
        });
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        updateStats();
        renderCalendar();
        renderEntries();
    });
}

// Update statistics
function updateStats() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const monthEntries = entries.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === month && d.getFullYear() === year;
    });

    const total = monthEntries.reduce((sum, e) => sum + (e.total || 0), 0);
    const pending = monthEntries.filter(e => !e.paid).reduce((sum, e) => sum + (e.total || 0), 0);
    const days = new Set(monthEntries.map(e => e.date)).size;
    const units = monthEntries.reduce((sum, e) => sum + (e.quantity || 0), 0);

    document.getElementById('totalEarnings').textContent = '$' + total.toFixed(2);
    document.getElementById('pendingAmount').textContent = '$' + pending.toFixed(2);
    document.getElementById('totalDays').textContent = days;
    document.getElementById('totalUnits').textContent = Math.round(units);
}

// Tab switching
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');
    document.getElementById(tab + 'Section').classList.add('active');
}

// ============================================
// JOBS
// ============================================

// Verificar y agregar frutas faltantes
async function checkAndAddMissingFruits() {
    if (!currentUser) return;

    const existingProducts = jobs.map(j => j.product);
    const missingFruits = availableFruits.filter(f => !existingProducts.includes(f));

    if (missingFruits.length === 0) return;

    const batch = {};
    missingFruits.forEach((fruit, idx) => {
        const key = db.ref(`jobs/${currentUser.uid}`).push().key;
        batch[key] = {
            product: fruit,
            type: 'trato',
            unit: 'totens',
            price: 0,
            employer: '',
            active: true,
            createdAt: Date.now() + idx
        };
    });

    try {
        await db.ref(`jobs/${currentUser.uid}`).update(batch);
    } catch (error) {
        console.error('Error agregando frutas faltantes:', error);
    }
}

// Agregar nueva fruta personalizada
async function addCustomFruit(fruitName) {
    if (!currentUser || !fruitName) return;

    // Verificar que no exista
    if (jobs.some(j => j.product.toLowerCase() === fruitName.toLowerCase())) {
        showToast('Esta fruta ya existe', 'error');
        return;
    }

    try {
        await db.ref(`jobs/${currentUser.uid}`).push({
            product: fruitName,
            type: 'trato',
            unit: 'totens',
            price: 0,
            employer: '',
            active: true,
            createdAt: Date.now()
        });
        showToast('Fruta agregada');
    } catch (error) {
        showToast('Error al agregar', 'error');
    }
}

function renderJobs() {
    const grid = document.getElementById('jobsGrid');

    if (jobs.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="icon">💼</div>
                <h3>No hay trabajos</h3>
                <p>Crea un trabajo para empezar a registrar tu cosecha</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = jobs.map(job => {
        const jobEntries = entries.filter(e => e.jobId === job.id);
        const totalEarned = jobEntries.reduce((sum, e) => sum + (e.total || 0), 0);
        const totalUnits = jobEntries.reduce((sum, e) => sum + (e.quantity || 0), 0);
        const daysWorked = new Set(jobEntries.map(e => e.date)).size;
        const displayName = getJobDisplayName(job);
        const isConfigured = job.price > 0 || job.employer;

        return `
            <div class="job-card ${isConfigured ? 'active' : ''}" onclick="selectJobForQuickAdd('${job.id}')">
                <div class="job-header">
                    <span class="job-title">${displayName}</span>
                    <span class="job-status ${!isConfigured ? 'inactive' : ''}">${isConfigured ? 'Configurado' : 'Sin configurar'}</span>
                </div>
                <div class="job-details">
                    <span>${job.type === 'dia' ? '📅 Al Dia' : '📦 Al Trato'}</span>
                    ${job.employer ? `<span>📍 ${job.employer}</span>` : ''}
                    <span>${job.type === 'dia' ? '$' + (job.dailyRate || 0) + '/dia' : '$' + (job.price || 0) + '/' + (unitNames[job.unit] || 'unidad')}</span>
                </div>
                <div class="job-stats">
                    <div class="job-stat">
                        <div class="job-stat-value">${daysWorked}</div>
                        <div class="job-stat-label">Dias</div>
                    </div>
                    <div class="job-stat">
                        <div class="job-stat-value">${Math.round(totalUnits)}</div>
                        <div class="job-stat-label">Unidades</div>
                    </div>
                    <div class="job-stat">
                        <div class="job-stat-value" style="color: #00ff88;">$${totalEarned.toFixed(0)}</div>
                        <div class="job-stat-label">Total</div>
                    </div>
                </div>
                <button class="icon-btn" style="position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; font-size: 12px;" onclick="event.stopPropagation(); editJob('${job.id}')">✏️</button>
            </div>
        `;
    }).join('');
}

function selectJobForQuickAdd(jobId) {
    const job = jobs.find(j => j.id === jobId);
    if (!job || job.type === 'dia') {
        openEntryModal(null, jobId);
        return;
    }

    selectedJob = job;
    document.getElementById('quickAddTitle').textContent = `Agregar a: ${getJobDisplayName(job)}`;
    document.getElementById('quickDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('quickQuantity').value = '';
    document.getElementById('quickAddBar').classList.add('visible');
}

function closeQuickAdd() {
    selectedJob = null;
    document.getElementById('quickAddBar').classList.remove('visible');
}

async function quickAddEntry() {
    if (!selectedJob || !currentUser) return;

    const date = document.getElementById('quickDate').value;
    const quantity = parseFloat(document.getElementById('quickQuantity').value) || 0;

    if (!date || quantity <= 0) {
        showToast('Completa fecha y cantidad', 'error');
        return;
    }

    const total = quantity * (selectedJob.price || 0);

    try {
        await db.ref(`harvest/${currentUser.uid}`).push({
            jobId: selectedJob.id,
            date,
            quantity,
            total,
            paid: false,
            createdAt: Date.now()
        });
        showToast('Registro agregado');
        document.getElementById('quickQuantity').value = '';
    } catch (error) {
        showToast('Error al guardar', 'error');
    }
}

// ============================================
// JOB MODAL
// ============================================
function openJobModal(jobId = null) {
    document.getElementById('jobId').value = '';
    document.getElementById('jobProduct').value = '';
    document.getElementById('jobUnit').value = 'totens';
    document.getElementById('jobPrice').value = '';
    document.getElementById('jobDailyRate').value = '';
    document.getElementById('jobEmployer').value = '';
    jobType = 'trato';
    updateJobTypeUI();
    document.getElementById('deleteJobBtn').style.display = 'none';
    document.getElementById('jobModalTitle').textContent = 'Nuevo Trabajo';

    if (jobId) {
        const job = jobs.find(j => j.id === jobId);
        if (job) {
            document.getElementById('jobId').value = job.id;
            document.getElementById('jobProduct').value = job.product || '';
            document.getElementById('jobUnit').value = job.unit || 'totens';
            document.getElementById('jobPrice').value = job.price || '';
            document.getElementById('jobDailyRate').value = job.dailyRate || '';
            document.getElementById('jobEmployer').value = job.employer || '';
            jobType = job.type || 'trato';
            updateJobTypeUI();
            document.getElementById('deleteJobBtn').style.display = 'block';
            document.getElementById('jobModalTitle').textContent = 'Editar Trabajo';
        }
    }

    document.getElementById('jobModal').classList.add('visible');
}

function editJob(jobId) {
    openJobModal(jobId);
}

function closeJobModal() {
    document.getElementById('jobModal').classList.remove('visible');
}

function selectJobType(type) {
    jobType = type;
    updateJobTypeUI();
}

function updateJobTypeUI() {
    document.getElementById('jobTypeTrato').classList.toggle('selected', jobType === 'trato');
    document.getElementById('jobTypeDia').classList.toggle('selected', jobType === 'dia');
    document.getElementById('jobTratoFields').classList.toggle('visible', jobType === 'trato');
    document.getElementById('jobDiaFields').classList.toggle('visible', jobType === 'dia');
}

async function saveJob() {
    if (!currentUser) return;

    const id = document.getElementById('jobId').value;
    const data = {
        product: document.getElementById('jobProduct').value,
        type: jobType,
        employer: document.getElementById('jobEmployer').value,
        active: true,
        updatedAt: Date.now()
    };

    if (jobType === 'trato') {
        data.unit = document.getElementById('jobUnit').value;
        data.price = parseFloat(document.getElementById('jobPrice').value) || 0;
    } else {
        data.dailyRate = parseFloat(document.getElementById('jobDailyRate').value) || 0;
    }

    if (!data.product) {
        showToast('Selecciona un producto', 'error');
        return;
    }

    try {
        if (id) {
            await db.ref(`jobs/${currentUser.uid}/${id}`).update(data);
        } else {
            data.createdAt = Date.now();
            await db.ref(`jobs/${currentUser.uid}`).push(data);
        }
        showToast('Trabajo guardado');
        closeJobModal();
    } catch (error) {
        showToast('Error al guardar', 'error');
    }
}

async function deleteJob() {
    const id = document.getElementById('jobId').value;
    if (!id || !currentUser) return;

    if (confirm('¿Eliminar este trabajo? Los registros asociados no se eliminaran.')) {
        try {
            await db.ref(`jobs/${currentUser.uid}/${id}`).remove();
            showToast('Trabajo eliminado');
            closeJobModal();
        } catch (error) {
            showToast('Error al eliminar', 'error');
        }
    }
}

// ============================================
// ENTRY MODAL
// ============================================
function openEntryModal(entryId = null, preselectedJobId = null) {
    // Update job select options first
    updateJobSelect();

    document.getElementById('entryId').value = '';
    document.getElementById('entryJob').value = preselectedJobId || '';
    document.getElementById('entryDate').value = selectedDayDate || new Date().toISOString().split('T')[0];
    document.getElementById('entryQuantity').value = '';
    document.getElementById('entryHours').value = '';
    document.getElementById('entryNotes').value = '';
    entryPaid = false;
    updateEntryPaidUI();
    document.getElementById('deleteEntryBtn').style.display = 'none';
    document.getElementById('entryModalTitle').textContent = 'Nuevo Registro';
    onJobSelect();

    if (entryId) {
        const entry = entries.find(e => e.id === entryId);
        if (entry) {
            document.getElementById('entryId').value = entry.id;
            document.getElementById('entryJob').value = entry.jobId || '';
            document.getElementById('entryDate').value = entry.date;
            document.getElementById('entryQuantity').value = entry.quantity || '';
            document.getElementById('entryHours').value = entry.hours || '';
            document.getElementById('entryNotes').value = entry.notes || '';
            entryPaid = entry.paid || false;
            updateEntryPaidUI();
            document.getElementById('deleteEntryBtn').style.display = 'block';
            document.getElementById('entryModalTitle').textContent = 'Editar Registro';
            onJobSelect();
        }
    }

    document.getElementById('entryModal').classList.add('visible');
}

function closeEntryModal() {
    document.getElementById('entryModal').classList.remove('visible');
    selectedDayDate = null;
}

function updateJobSelect() {
    const select = document.getElementById('entryJob');
    if (!select) return;

    const currentVal = select.value;
    let options = '<option value="">Seleccionar trabajo</option>';

    jobs.forEach(j => {
        const jobName = getJobDisplayName(j);
        options += `<option value="${j.id}">${jobName}</option>`;
    });

    select.innerHTML = options;
    if (currentVal) select.value = currentVal;
}

// Generate job display name: fruta + recipiente + precio + ubicacion
function getJobDisplayName(job) {
    const parts = [];
    if (job.product) parts.push(job.product);
    if (job.unit && unitNames[job.unit]) parts.push(unitNames[job.unit]);
    if (job.price) parts.push('$' + job.price);
    if (job.employer) parts.push(job.employer);
    return parts.length > 0 ? parts.join(' - ') : 'Sin configurar';
}

function onJobSelect() {
    const jobId = document.getElementById('entryJob').value;
    const job = jobs.find(j => j.id === jobId);

    if (job) {
        const unitLabels = {
            'totens': 'totens',
            'capacho_grande': 'capachos grandes',
            'capacho_pequeno': 'capachos pequeños',
            'kilo': 'kilos',
            'bandeja': 'bandejas',
            'bins': 'bins'
        };

        if (job.type === 'dia') {
            document.getElementById('entryTratoFields').classList.remove('visible');
            document.getElementById('entryDiaFields').classList.add('visible');
            document.getElementById('entryTotal').textContent = '$' + (job.dailyRate || 0).toFixed(2);
        } else {
            document.getElementById('entryTratoFields').classList.add('visible');
            document.getElementById('entryDiaFields').classList.remove('visible');
            document.getElementById('entryUnitLabel').textContent = `(${unitLabels[job.unit] || 'unidades'})`;
            calculateEntryTotal();
        }
    }
}

function calculateEntryTotal() {
    const jobId = document.getElementById('entryJob').value;
    const job = jobs.find(j => j.id === jobId);
    const quantity = parseFloat(document.getElementById('entryQuantity').value) || 0;

    let total = 0;
    if (job) {
        if (job.type === 'dia') {
            total = job.dailyRate || 0;
        } else {
            total = quantity * (job.price || 0);
        }
    }
    document.getElementById('entryTotal').textContent = '$' + total.toFixed(2);
    return total;
}

function toggleEntryPaid() {
    entryPaid = !entryPaid;
    updateEntryPaidUI();
}

function updateEntryPaidUI() {
    document.getElementById('entryPaidToggle').classList.toggle('active', entryPaid);
    document.getElementById('entryPaidLabel').textContent = entryPaid ? 'Pagado' : 'Pendiente de pago';
}

async function saveEntry() {
    if (!currentUser) return;

    const id = document.getElementById('entryId').value;
    const jobId = document.getElementById('entryJob').value;
    const job = jobs.find(j => j.id === jobId);
    const date = document.getElementById('entryDate').value;

    if (!jobId || !date) {
        showToast('Selecciona trabajo y fecha', 'error');
        return;
    }

    const data = {
        jobId,
        date,
        paid: entryPaid,
        notes: document.getElementById('entryNotes').value,
        updatedAt: Date.now()
    };

    if (job.type === 'dia') {
        data.total = job.dailyRate || 0;
        data.hours = parseFloat(document.getElementById('entryHours').value) || null;
    } else {
        data.quantity = parseFloat(document.getElementById('entryQuantity').value) || 0;
        data.total = data.quantity * (job.price || 0);
    }

    try {
        if (id) {
            await db.ref(`harvest/${currentUser.uid}/${id}`).update(data);
        } else {
            data.createdAt = Date.now();
            await db.ref(`harvest/${currentUser.uid}`).push(data);
        }
        showToast('Registro guardado');
        closeEntryModal();
    } catch (error) {
        showToast('Error al guardar', 'error');
    }
}

async function deleteEntry() {
    const id = document.getElementById('entryId').value;
    if (!id || !currentUser) return;

    if (confirm('¿Eliminar este registro?')) {
        try {
            await db.ref(`harvest/${currentUser.uid}/${id}`).remove();
            showToast('Registro eliminado');
            closeEntryModal();
        } catch (error) {
            showToast('Error al eliminar', 'error');
        }
    }
}

// ============================================
// CALENDAR
// ============================================
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    dayNames.forEach((day, idx) => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        if (idx === 0) header.classList.add('sunday');
        if (idx === 6) header.classList.add('saturday');
        header.textContent = day;
        grid.appendChild(header);
    });

    const prevMonth = new Date(year, month, 0);
    for (let i = startDay - 1; i >= 0; i--) {
        const dayOfWeek = startDay - 1 - i;
        const day = document.createElement('div');
        day.className = 'calendar-day other-month';
        if (dayOfWeek === 0) day.classList.add('sunday');
        if (dayOfWeek === 6) day.classList.add('saturday');
        day.innerHTML = `<span class="day-number">${prevMonth.getDate() - i}</span>`;
        grid.appendChild(day);
    }

    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        const dayDate = new Date(year, month, i);
        const dayOfWeek = dayDate.getDay();

        const day = document.createElement('div');
        day.className = 'calendar-day';

        // Weekend classes
        if (dayOfWeek === 0) day.classList.add('sunday');
        if (dayOfWeek === 6) day.classList.add('saturday');

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayEntries = entries.filter(e => e.date === dateStr);
        const dayTotal = dayEntries.reduce((sum, e) => sum + (e.total || 0), 0);
        const hasPending = dayEntries.some(e => !e.paid);

        if (today.getDate() === i && today.getMonth() === month && today.getFullYear() === year) {
            day.classList.add('today');
        }
        if (dayEntries.length > 0) {
            day.classList.add(hasPending ? 'has-pending' : 'has-entries');
        }

        // Obtener notas del dia
        const dayNotes = dayEntries.filter(e => e.notes).map(e => e.notes).join(' | ');
        const truncatedNotes = dayNotes.length > 30 ? dayNotes.substring(0, 30) + '...' : dayNotes;

        day.innerHTML = `
            <span class="day-number">${i}</span>
            ${dayEntries.length > 0 ? `<span class="day-entries-count">${dayEntries.length} reg</span>` : ''}
            ${dayTotal > 0 ? `<span class="day-amount">$${dayTotal.toFixed(0)}</span>` : ''}
            ${truncatedNotes ? `<span class="day-notes">${truncatedNotes}</span>` : ''}
        `;

        day.onclick = () => openDayModal(dateStr, dayEntries);
        grid.appendChild(day);
    }

    const remainingDays = 42 - (startDay + daysInMonth);
    for (let i = 1; i <= remainingDays; i++) {
        const dayDate = new Date(year, month + 1, i);
        const dayOfWeek = dayDate.getDay();

        const day = document.createElement('div');
        day.className = 'calendar-day other-month';
        if (dayOfWeek === 0) day.classList.add('sunday');
        if (dayOfWeek === 6) day.classList.add('saturday');
        day.innerHTML = `<span class="day-number">${i}</span>`;
        grid.appendChild(day);
    }
}

function changeMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    renderCalendar();
}

// ============================================
// DAY MODAL
// ============================================
function openDayModal(dateStr, dayEntries) {
    selectedDayDate = dateStr;
    const date = new Date(dateStr + 'T12:00:00');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dayModalTitle').textContent = date.toLocaleDateString('es-ES', options);

    const list = document.getElementById('dayEntriesList');
    if (dayEntries.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">No hay registros para este dia</p>';
    } else {
        list.innerHTML = dayEntries.map(e => {
            const job = jobs.find(j => j.id === e.jobId);
            return `
                <div class="entry-card" onclick="closeDayModal(); openEntryModal('${e.id}')">
                    <div class="entry-info">
                        <div class="entry-date">${job ? getJobDisplayName(job) : 'Trabajo eliminado'}</div>
                        <div class="entry-details">${e.quantity ? e.quantity + ' unidades' : 'Jornada'} ${e.paid ? '• Pagado' : '• Pendiente'}</div>
                    </div>
                    <div class="entry-total">$${(e.total || 0).toFixed(2)}</div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('dayModal').classList.add('visible');
}

function closeDayModal() {
    document.getElementById('dayModal').classList.remove('visible');
}

function addEntryForDay() {
    closeDayModal();
    openEntryModal();
}

// ============================================
// ENTRIES LIST
// ============================================
function renderEntries() {
    const list = document.getElementById('entriesList');

    if (entries.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="icon">📋</div>
                <h3>No hay registros</h3>
                <p>Agrega tu primer registro de cosecha</p>
            </div>
        `;
        return;
    }

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    list.innerHTML = entries.slice(0, 50).map(e => {
        const job = jobs.find(j => j.id === e.jobId);
        const date = new Date(e.date + 'T12:00:00');
        return `
            <div class="entry-card" onclick="openEntryModal('${e.id}')">
                <div class="entry-info">
                    <div class="entry-date">${date.getDate()} ${monthNames[date.getMonth()]} - ${job ? job.product : 'Trabajo eliminado'}</div>
                    <div class="entry-details">${e.quantity ? e.quantity + ' unidades' : 'Jornada'} ${job?.employer ? '• ' + job.employer : ''}</div>
                </div>
                <div class="entry-amount">
                    <div class="entry-total">$${(e.total || 0).toFixed(2)}</div>
                    <span class="entry-status ${e.paid ? 'paid' : 'pending'}">${e.paid ? 'Pagado' : 'Pendiente'}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// TOAST
// ============================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast visible' + (type === 'error' ? ' error' : '');
    setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ============================================
// ADD FRUIT MODAL
// ============================================
function openAddFruitModal() {
    document.getElementById('newFruitName').value = '';
    document.getElementById('addFruitModal').classList.add('visible');
}

function closeAddFruitModal() {
    document.getElementById('addFruitModal').classList.remove('visible');
}

async function saveNewFruit() {
    const fruitName = document.getElementById('newFruitName').value.trim();
    if (!fruitName) {
        showToast('Ingresa un nombre', 'error');
        return;
    }
    await addCustomFruit(fruitName);
    closeAddFruitModal();
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    renderCalendar();
});
