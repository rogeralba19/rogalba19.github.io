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
let jobsLoaded = false;
let entriesLoaded = false;

// Job modal state
let jobType = 'trato';

// Entry modal state
let entryPaid = false;
let editingEntry = null; // Registro que se está editando (para preservar snapshot)

// Entries filter state
let paymentFilter = 'all'; // 'all', 'pending', 'paid'

// Selection state
let selectedDays = new Set(); // Días seleccionados en calendario
let selectedEntries = new Set(); // Registros seleccionados
let selectionMode = false; // Modo selección activo

// Long press state
let longPressTriggered = false;

// Helper: get local date as YYYY-MM-DD
function getLocalDateString(date) {
    if (!date) date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Helper: escape HTML to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Helper: open/close modal with scroll lock
function openModal(modalId) {
    document.getElementById(modalId).classList.add('visible');
    document.body.classList.add('modal-open');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('visible');
    // Only remove scroll lock if no other modals are visible
    const anyVisible = document.querySelector('.modal-overlay.visible, .auth-modal-overlay.visible');
    if (!anyVisible) {
        document.body.classList.remove('modal-open');
    }
}

// Unit names mapping
const unitNames = {
    'totens': 'Totens',
    'capacho_grande': 'Capacho Grande',
    'capacho_pequeno': 'Capacho Pequeño',
    'kilo': 'Kilos',
    'bandeja': 'Bandejas',
    'bins': 'Bins'
};

// Helper: crear snapshot del trabajo para guardar en el registro
function createJobSnapshot(job) {
    if (!job) return null;
    return {
        product: job.product || '',
        type: job.type || 'trato',
        unit: job.unit || null,
        price: job.price || null,
        dailyRate: job.dailyRate || null,
        employer: job.employer || ''
    };
}

// Helper: obtener datos del trabajo desde el registro (snapshot o fallback para registros viejos)
function getEntryJobData(entry) {
    if (entry.snapshot) return entry.snapshot;
    // Fallback para registros antiguos sin snapshot (solo lectura, para mostrar en lista)
    const job = jobs.find(j => j.id === entry.jobId);
    if (job) return createJobSnapshot(job);
    return { product: 'Trabajo eliminado', type: 'trato', unit: null, price: 0, dailyRate: 0, employer: '' };
}

// Helper: nombre para mostrar desde datos de trabajo (snapshot o job)
function getDisplayName(jobData) {
    const parts = [];
    if (jobData.product) parts.push(jobData.product);
    if (jobData.unit && unitNames[jobData.unit]) parts.push(unitNames[jobData.unit]);
    if (jobData.price) parts.push('$' + jobData.price);
    if (jobData.employer) parts.push(jobData.employer);
    return parts.length > 0 ? parts.join(' - ') : 'Sin configurar';
}

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

// User profile data from Firebase
let userProfile = null;

// Auth listener (single unified listener - auth.js only handles UI elements it owns)
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        // Cerrar modal de auth si estaba abierto
        const authOverlay = document.getElementById('authModalOverlay');
        if (authOverlay) {
            authOverlay.classList.remove('visible');
            document.body.classList.remove('modal-open');
        }
        // Mostrar contenido de la app
        document.querySelector('.header').style.display = '';
        document.querySelector('.container').style.display = '';
        // Actualizar menu de usuario en header
        const userMenuContainer = document.getElementById('userMenuContainer');
        if (userMenuContainer) userMenuContainer.style.display = 'flex';
        updateUserProfileUI(user);
        showLoading(true);

        // Ensure user profile exists (creates on first login)
        try {
            const result = await ensureUserProfile(user);
            userProfile = result.userProfile;

            // Load boss mode state from Firebase
            await loadBossModeState();

            // Show welcome modal for new users
            if (result.isNewUser) {
                showWelcomeModal(userProfile);
            }
        } catch (e) {
            console.error('Error creating user profile:', e);
        }

        loadData();
    } else {
        currentUser = null;
        userProfile = null;
        bossMode = false;
        applyBossModeUI(false);
        if (typeof unloadCuadrillaData === 'function') unloadCuadrillaData();
        jobs = [];
        entries = [];
        jobsLoaded = false;
        entriesLoaded = false;
        // Ocultar contenido y mostrar formulario de registro/login
        document.querySelector('.header').style.display = 'none';
        document.querySelector('.container').style.display = 'none';
        const userMenuContainer = document.getElementById('userMenuContainer');
        if (userMenuContainer) userMenuContainer.style.display = 'none';
        const authOverlay = document.getElementById('authModalOverlay');
        if (authOverlay) {
            authOverlay.classList.add('visible');
            document.body.classList.add('modal-open');
        }
    }
});

// Loading state
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.toggle('visible', show);
    }
}

function checkDataReady() {
    if (jobsLoaded && entriesLoaded) {
        showLoading(false);
    }
}

// Load data from Firebase
let fruitsChecked = false;

function loadData() {
    if (!currentUser) return;

    fruitsChecked = false;

    // Load jobs
    db.ref(`jobs/${currentUser.uid}`).on('value', (snapshot) => {
        jobs = [];
        snapshot.forEach((child) => {
            jobs.push({ id: child.key, ...child.val() });
        });

        // Solo verificar frutas faltantes una vez por sesión de carga
        if (!fruitsChecked) {
            fruitsChecked = true;
            checkAndAddMissingFruits();
        }
        jobsLoaded = true;
        renderJobs();
        updateJobSelect();
        // Re-render entries si ya están cargadas (para mostrar nombres de trabajo)
        if (entriesLoaded) {
            renderEntries();
            renderCalendar();
            renderActivityCalendar();
        }
        checkDataReady();
    });

    // Load entries
    db.ref(`harvest/${currentUser.uid}`).on('value', (snapshot) => {
        entries = [];
        snapshot.forEach((child) => {
            entries.push({ id: child.key, ...child.val() });
        });
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        entriesLoaded = true;
        updateStats();
        renderCalendar();
        renderActivityCalendar();
        if (jobsLoaded) {
            renderEntries();
        }
        checkDataReady();
    });
}

// Update statistics - usar el mes del calendario
function updateStats() {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const monthEntries = entries.filter(e => {
        const d = new Date(e.date + 'T12:00:00');
        return d.getMonth() === month && d.getFullYear() === year;
    });

    const total = monthEntries.reduce((sum, e) => sum + (e.total || 0), 0);
    const pending = monthEntries.filter(e => !e.paid).reduce((sum, e) => sum + (e.total || 0), 0);
    const days = new Set(monthEntries.map(e => e.date)).size;

    document.getElementById('totalEarnings').textContent = '$' + total.toFixed(2);
    document.getElementById('pendingAmount').textContent = '$' + pending.toFixed(2);
    document.getElementById('totalDays').textContent = days;
    document.getElementById('totalLabel').textContent = 'Total ' + monthNames[month];
}

// Mostrar total general por 10 segundos
let totalGeneralTimeout = null;
let isShowingGeneral = false;

function toggleTotalGeneral() {
    const cards = document.querySelectorAll('.stat-card');
    const totalEl = document.getElementById('totalEarnings');
    const pendingEl = document.getElementById('pendingAmount');
    const daysEl = document.getElementById('totalDays');
    const totalLabel = document.getElementById('totalLabel');
    const pendingLabel = document.getElementById('pendingLabel');
    const daysLabel = document.getElementById('daysLabel');

    // Limpiar timeout anterior
    if (totalGeneralTimeout) {
        clearTimeout(totalGeneralTimeout);
    }

    // Calcular totales generales
    const totalGeneral = entries.reduce((sum, e) => sum + (e.total || 0), 0);
    const pendingGeneral = entries.filter(e => !e.paid).reduce((sum, e) => sum + (e.total || 0), 0);
    const daysGeneral = new Set(entries.map(e => e.date)).size;

    // Paso 1: Animar salida
    cards.forEach(card => card.classList.add('animating'));

    // Paso 2: Cambiar datos mientras estan ocultos
    setTimeout(() => {
        totalEl.textContent = '$' + totalGeneral.toFixed(2);
        pendingEl.textContent = '$' + pendingGeneral.toFixed(2);
        daysEl.textContent = daysGeneral;
        totalLabel.textContent = 'TOTAL GENERAL';
        pendingLabel.textContent = 'PEND. GENERAL';
        daysLabel.textContent = 'DÍAS TOTALES';

        // Agregar clase showing-general
        cards.forEach(card => card.classList.add('showing-general'));

        // Paso 3: Animar entrada
        setTimeout(() => {
            cards.forEach(card => card.classList.remove('animating'));
        }, 50);
    }, 400);

    isShowingGeneral = true;

    // Volver al mes actual despues de 10 segundos
    totalGeneralTimeout = setTimeout(() => {
        restoreMonthStats();
    }, 10000);
}

function restoreMonthStats() {
    if (!isShowingGeneral) return;

    const cards = document.querySelectorAll('.stat-card');

    // Animar salida
    cards.forEach(card => card.classList.add('animating'));

    setTimeout(() => {
        // Restaurar datos del mes
        updateStats();

        // Restaurar labels
        document.getElementById('pendingLabel').textContent = 'Pendiente';
        document.getElementById('daysLabel').textContent = 'Días';

        // Quitar clase showing-general
        cards.forEach(card => card.classList.remove('showing-general'));

        // Animar entrada
        setTimeout(() => {
            cards.forEach(card => card.classList.remove('animating'));
        }, 50);
    }, 400);

    isShowingGeneral = false;
}

// Tab switching - mantener selección al cambiar de pestaña
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const targetTab = document.querySelector(`.tab[data-tab="${tab}"]`);
    if (targetTab) targetTab.classList.add('active');
    document.getElementById(tab + 'Section').classList.add('active');

    // Si hay días seleccionados y vamos a registros, sincronizar
    if (tab === 'registros' && selectedDays.size > 0) {
        syncSelectionToEntries();
    }

    // Cargar datos de cuadrilla cuando se abre esa tab (lazy)
    if (tab === 'cuadrilla' && bossMode && typeof loadCuadrillaData === 'function') {
        loadCuadrillaData();
    }
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

    // Obtener ultimo uso de cada trabajo
    const lastUsed = {};
    entries.forEach(e => {
        if (!lastUsed[e.jobId] || new Date(e.date) > new Date(lastUsed[e.jobId])) {
            lastUsed[e.jobId] = e.date;
        }
    });

    // Separar trabajos configurados y no configurados
    const configured = [];
    const unconfigured = [];

    jobs.forEach(job => {
        const isConfigured = job.price > 0 || job.dailyRate > 0;
        if (isConfigured) {
            configured.push({ ...job, lastUsed: lastUsed[job.id] || null });
        } else {
            unconfigured.push(job);
        }
    });

    // Ordenar no configurados alfabeticamente
    unconfigured.sort((a, b) => (a.product || '').localeCompare(b.product || ''));

    // Ordenar configurados por ultimo uso (mas reciente primero)
    configured.sort((a, b) => {
        if (!a.lastUsed && !b.lastUsed) return 0;
        if (!a.lastUsed) return 1;
        if (!b.lastUsed) return -1;
        return new Date(b.lastUsed) - new Date(a.lastUsed);
    });

    // Combinar: primero usados, luego no configurados
    const sortedJobs = [...configured, ...unconfigured];

    grid.innerHTML = sortedJobs.map(job => {
        const isConfigured = job.price > 0 || job.dailyRate > 0;
        const safeProduct = escapeHtml(job.product);
        const safeEmployer = escapeHtml(job.employer);

        return `
            <div class="job-card ${isConfigured ? 'active' : ''}" onclick="editJob('${job.id}')">
                <div class="job-header">
                    <span class="job-title">${safeProduct}</span>
                    <span class="job-status ${!isConfigured ? 'inactive' : ''}">${isConfigured ? 'Configurado' : 'Sin configurar'}</span>
                </div>
                <div class="job-details">
                    <span>${job.type === 'dia' ? '📅 Al Día' : '📦 Al Trato'}</span>
                    ${safeEmployer ? `<span>📍 ${safeEmployer}</span>` : '<span>📍 Sin ubicación</span>'}
                    <span>${job.type === 'dia' ? '$' + (job.dailyRate || 0) + '/día' : '$' + (job.price || 0) + '/' + (unitNames[job.unit] || 'unidad')}</span>
                </div>
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
    document.getElementById('quickDate').value = getLocalDateString();
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
            createdAt: Date.now(),
            snapshot: createJobSnapshot(selectedJob)
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

    openModal('jobModal');
}

function editJob(jobId) {
    openJobModal(jobId);
}

function closeJobModal() {
    closeModal('jobModal');
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
        // Limpiar campos del tipo contrario
        data.dailyRate = null;
    } else {
        data.dailyRate = parseFloat(document.getElementById('jobDailyRate').value) || 0;
        // Limpiar campos del tipo contrario
        data.unit = null;
        data.price = null;
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

    showConfirmModal('Eliminar trabajo', '¿Eliminar este trabajo? Los registros asociados no se eliminaran.', 'Eliminar', async () => {
        try {
            await db.ref(`jobs/${currentUser.uid}/${id}`).remove();
            showToast('Trabajo eliminado');
            closeJobModal();
        } catch (error) {
            showToast('Error al eliminar', 'error');
        }
    });
}

// ============================================
// ENTRY MODAL
// ============================================
function openEntryModal(entryId = null, preselectedJobId = null) {
    // Limpiar estado de edición
    editingEntry = null;

    // Update job select options first
    updateJobSelect();

    // Reset todos los campos
    document.getElementById('entryId').value = '';
    document.getElementById('entryJob').value = preselectedJobId || '';
    document.getElementById('entryDate').value = selectedDayDate || getLocalDateString();
    document.getElementById('entryQuantity').value = '';
    document.getElementById('entryHours').value = '';
    document.getElementById('entryNotes').value = '';
    document.getElementById('entryPeople').value = '1';
    entryPaid = false;
    updateEntryPaidUI();
    document.getElementById('deleteEntryBtn').style.display = 'none';
    document.getElementById('entryModalTitle').textContent = 'Nuevo Registro';

    if (entryId) {
        const entry = entries.find(e => e.id === entryId);
        if (entry) {
            editingEntry = entry;
            document.getElementById('entryId').value = entry.id;
            document.getElementById('entryJob').value = entry.jobId || '';
            document.getElementById('entryDate').value = entry.date;
            document.getElementById('entryQuantity').value = entry.quantity || '';
            document.getElementById('entryHours').value = entry.hours || '';
            document.getElementById('entryNotes').value = entry.notes || '';
            document.getElementById('entryPeople').value = entry.people || '1';
            entryPaid = entry.paid || false;
            updateEntryPaidUI();
            document.getElementById('deleteEntryBtn').style.display = 'block';
            document.getElementById('entryModalTitle').textContent = 'Editar Registro';
        }
    }

    // Una sola llamada a onJobSelect después de configurar todo
    onJobSelect();
    openModal('entryModal');
}

function closeEntryModal() {
    closeModal('entryModal');
    selectedDayDate = null;
    editingEntry = null;
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
    const selectWrapper = document.getElementById('entryJobSelectWrapper');
    const jobDisplay = document.getElementById('entryJobDisplay');
    const configFields = document.getElementById('entryConfigFields');
    const binsFields = document.getElementById('entryBinsFields');

    // Ocultar todo primero
    configFields.classList.remove('visible');
    binsFields.classList.remove('visible');
    document.getElementById('editJobBtn').style.display = 'none';
    document.getElementById('entryTratoFields').classList.remove('visible');
    document.getElementById('entryDiaFields').classList.remove('visible');
    document.getElementById('entryTotal').textContent = '$0.00';

    if (!jobId) {
        // Sin trabajo seleccionado: mostrar selector, ocultar display
        selectWrapper.style.display = '';
        jobDisplay.style.display = 'none';
        return;
    }

    // Trabajo seleccionado: ocultar selector, mostrar display fijo
    selectWrapper.style.display = 'none';
    jobDisplay.style.display = 'flex';

    // Limpiar campos al cambiar de trabajo (no al abrir para editar)
    if (!editingEntry) {
        document.getElementById('entryQuantity').value = '';
        document.getElementById('entryHours').value = '';
        document.getElementById('entryPeople').value = '1';
    }

    const unitLabels = {
        'totens': 'totens', 'capacho_grande': 'capachos grandes',
        'capacho_pequeno': 'capachos pequeños', 'kilo': 'kilos',
        'bandeja': 'bandejas', 'bins': 'bins'
    };

    // Si estamos editando un registro existente con el mismo trabajo, usar snapshot
    if (editingEntry && editingEntry.jobId === jobId && editingEntry.snapshot) {
        const snap = editingEntry.snapshot;
        document.getElementById('entryJobName').textContent = getDisplayName(snap);
        document.getElementById('editJobBtn').style.display = 'inline-block';

        if (snap.type === 'dia') {
            document.getElementById('entryDiaFields').classList.add('visible');
            document.getElementById('entryTotal').textContent = '$' + (snap.dailyRate || 0).toFixed(2);
        } else {
            document.getElementById('entryTratoFields').classList.add('visible');
            document.getElementById('entryUnitLabel').textContent = `(${unitLabels[snap.unit] || 'unidades'})`;
            if (snap.unit === 'bins') {
                binsFields.classList.add('visible');
            }
            calculateEntryTotal();
        }
        return;
    }

    // Para registros nuevos o si cambió el trabajo, usar trabajo actual
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    document.getElementById('entryJobName').textContent = getJobDisplayName(job);

    const isConfigured = (job.type === 'dia' && job.dailyRate > 0) || (job.type === 'trato' && job.price > 0);

    if (!isConfigured) {
        // Mostrar campos de configuración inline
        configFields.classList.add('visible');
        document.getElementById('entryConfigUnit').value = job.unit || 'totens';
        document.getElementById('entryConfigPrice').value = job.price || '';
        document.getElementById('entryConfigDailyRate').value = job.dailyRate || '';
        document.getElementById('entryConfigEmployer').value = job.employer || '';
        document.getElementById('entryConfigType').value = job.type || 'trato';
        updateEntryConfigType();
    } else {
        // Trabajo configurado: mostrar botón editar y campos correspondientes
        document.getElementById('editJobBtn').style.display = 'inline-block';

        if (job.type === 'dia') {
            document.getElementById('entryDiaFields').classList.add('visible');
            document.getElementById('entryTotal').textContent = '$' + (job.dailyRate || 0).toFixed(2);
        } else {
            document.getElementById('entryTratoFields').classList.add('visible');
            document.getElementById('entryUnitLabel').textContent = `(${unitLabels[job.unit] || 'unidades'})`;
            if (job.unit === 'bins') {
                binsFields.classList.add('visible');
            }
            calculateEntryTotal();
        }
    }
}

// Volver a mostrar el selector de trabajo
function changeEntryJob() {
    document.getElementById('entryJobSelectWrapper').style.display = '';
    document.getElementById('entryJobDisplay').style.display = 'none';
    document.getElementById('entryJob').focus();
    // Si cambia de trabajo estando editando, limpiar editingEntry para que use datos del nuevo trabajo
    editingEntry = null;
}

// Abrir/cerrar campos de configuración del trabajo (botón lápiz)
function toggleEntryEdit() {
    const configFields = document.getElementById('entryConfigFields');
    const jobId = document.getElementById('entryJob').value;

    configFields.classList.toggle('visible');
    if (configFields.classList.contains('visible')) {
        // Decidir fuente de datos: snapshot (editando) o trabajo actual (nuevo)
        if (editingEntry && editingEntry.jobId === jobId && editingEntry.snapshot) {
            const snap = editingEntry.snapshot;
            document.getElementById('entryConfigUnit').value = snap.unit || 'totens';
            document.getElementById('entryConfigPrice').value = snap.price || '';
            document.getElementById('entryConfigDailyRate').value = snap.dailyRate || '';
            document.getElementById('entryConfigEmployer').value = snap.employer || '';
            document.getElementById('entryConfigType').value = snap.type || 'trato';
        } else {
            const job = jobs.find(j => j.id === jobId);
            if (!job) return;
            document.getElementById('entryConfigUnit').value = job.unit || 'totens';
            document.getElementById('entryConfigPrice').value = job.price || '';
            document.getElementById('entryConfigDailyRate').value = job.dailyRate || '';
            document.getElementById('entryConfigEmployer').value = job.employer || '';
            document.getElementById('entryConfigType').value = job.type || 'trato';
        }
        updateEntryConfigType();
    }
}

function updateEntryConfigType() {
    const type = document.getElementById('entryConfigType').value;
    document.getElementById('entryConfigTratoFields').style.display = type === 'trato' ? 'block' : 'none';
    document.getElementById('entryConfigDiaFields').style.display = type === 'dia' ? 'block' : 'none';

    // Actualizar campos de cantidad/horas y bins
    const configFields = document.getElementById('entryConfigFields');
    if (configFields.classList.contains('visible')) {
        document.getElementById('entryTratoFields').classList.toggle('visible', type === 'trato');
        document.getElementById('entryDiaFields').classList.toggle('visible', type === 'dia');

        // Mostrar/ocultar bins según unidad seleccionada
        const unit = document.getElementById('entryConfigUnit').value;
        document.getElementById('entryBinsFields').classList.toggle('visible', type === 'trato' && unit === 'bins');

        calculateEntryTotal();
    }
}

// Cuando cambia el recipiente en config: mostrar/ocultar bins y recalcular
function onConfigUnitChange() {
    const unit = document.getElementById('entryConfigUnit').value;
    document.getElementById('entryBinsFields').classList.toggle('visible', unit === 'bins');
    calculateEntryTotal();
}

// Leer datos de configuración desde los campos del formulario
function readConfigFields() {
    const type = document.getElementById('entryConfigType').value;
    const config = {
        type: type,
        employer: document.getElementById('entryConfigEmployer').value
    };
    if (type === 'trato') {
        config.unit = document.getElementById('entryConfigUnit').value;
        config.price = parseFloat(document.getElementById('entryConfigPrice').value) || 0;
        config.dailyRate = null;
    } else {
        config.dailyRate = parseFloat(document.getElementById('entryConfigDailyRate').value) || 0;
        config.unit = null;
        config.price = null;
    }
    return config;
}

function calculateEntryTotal() {
    const jobId = document.getElementById('entryJob').value;
    const quantity = parseFloat(document.getElementById('entryQuantity').value) || 0;
    const configVisible = document.getElementById('entryConfigFields').classList.contains('visible');

    let total = 0;
    let type, price, dailyRate, unit;

    if (configVisible) {
        // Leer precios directamente de los campos de configuración visibles
        const config = readConfigFields();
        type = config.type;
        price = config.price || 0;
        dailyRate = config.dailyRate || 0;
        unit = config.unit;
    } else if (editingEntry && editingEntry.jobId === jobId && editingEntry.snapshot) {
        // Editando mismo trabajo: usar snapshot
        const snap = editingEntry.snapshot;
        type = snap.type;
        price = snap.price || 0;
        dailyRate = snap.dailyRate || 0;
        unit = snap.unit;
    } else {
        // Registro nuevo con trabajo configurado
        const job = jobs.find(j => j.id === jobId);
        if (!job) {
            document.getElementById('entryTotal').textContent = '$0.00';
            return 0;
        }
        type = job.type;
        price = job.price || 0;
        dailyRate = job.dailyRate || 0;
        unit = job.unit;
    }

    if (type === 'dia') {
        total = dailyRate;
    } else {
        total = quantity * price;
        if (unit === 'bins') {
            let people = parseInt(document.getElementById('entryPeople').value) || 1;
            people = Math.max(1, Math.min(50, people));
            total = total / people;
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
    const date = document.getElementById('entryDate').value;
    const configVisible = document.getElementById('entryConfigFields').classList.contains('visible');

    if (!jobId || !date) {
        showToast('Selecciona trabajo y fecha', 'error');
        return;
    }

    const job = jobs.find(j => j.id === jobId);
    const isEditingSameJob = id && editingEntry && editingEntry.jobId === jobId && editingEntry.snapshot;

    // Determinar fuente de datos para el snapshot y precios
    let snapshot, sType, sPrice, sDailyRate, sUnit;

    if (configVisible) {
        // Config fields visibles: leer valores de ahí y también guardar en el trabajo
        const config = readConfigFields();
        sType = config.type;
        sPrice = config.price || 0;
        sDailyRate = config.dailyRate || 0;
        sUnit = config.unit;

        // Guardar configuración en el trabajo para usos futuros
        if (job) {
            const jobUpdate = {
                type: sType,
                employer: config.employer,
                updatedAt: Date.now()
            };
            if (sType === 'trato') {
                jobUpdate.unit = sUnit;
                jobUpdate.price = sPrice;
                jobUpdate.dailyRate = null;
            } else {
                jobUpdate.dailyRate = sDailyRate;
                jobUpdate.unit = null;
                jobUpdate.price = null;
            }
            await db.ref(`jobs/${currentUser.uid}/${jobId}`).update(jobUpdate);
        }

        // Crear snapshot desde los campos de config
        snapshot = {
            product: job ? job.product : '',
            type: sType,
            unit: sUnit,
            price: sPrice,
            dailyRate: sDailyRate,
            employer: config.employer || ''
        };
    } else if (isEditingSameJob) {
        // Editando mismo trabajo: PRESERVAR snapshot original
        snapshot = editingEntry.snapshot;
        sType = snapshot.type;
        sPrice = snapshot.price || 0;
        sDailyRate = snapshot.dailyRate || 0;
        sUnit = snapshot.unit;
    } else {
        // Registro nuevo con trabajo ya configurado
        if (!job) {
            showToast('Trabajo no encontrado', 'error');
            return;
        }
        snapshot = createJobSnapshot(job);
        sType = job.type;
        sPrice = job.price || 0;
        sDailyRate = job.dailyRate || 0;
        sUnit = job.unit;
    }

    // Validaciones
    if (sType === 'dia' && sDailyRate <= 0) {
        showToast('Configura el pago por día', 'error');
        return;
    }
    if (sType === 'trato' && sPrice <= 0) {
        showToast('Configura el precio por unidad', 'error');
        return;
    }

    const data = {
        jobId,
        date,
        paid: entryPaid,
        notes: document.getElementById('entryNotes').value,
        updatedAt: Date.now(),
        snapshot: snapshot
    };

    if (sType === 'dia') {
        data.total = sDailyRate;
        data.hours = parseFloat(document.getElementById('entryHours').value) || null;
    } else {
        data.quantity = parseFloat(document.getElementById('entryQuantity').value) || 0;

        if (data.quantity <= 0) {
            showToast('Ingresa una cantidad válida', 'error');
            return;
        }

        data.total = data.quantity * sPrice;

        if (sUnit === 'bins') {
            let people = parseInt(document.getElementById('entryPeople').value) || 1;
            people = Math.max(1, Math.min(50, people));
            data.people = people;
            data.total = data.total / people;
        }
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

    showConfirmModal('Eliminar registro', '¿Eliminar este registro?', 'Eliminar', async () => {
        try {
            await db.ref(`harvest/${currentUser.uid}/${id}`).remove();
            showToast('Registro eliminado');
            closeEntryModal();
        } catch (error) {
            showToast('Error al eliminar', 'error');
        }
    });
}

// ============================================
// ACTIVITY CALENDAR (GitHub-style)
// ============================================
const AC_PAID_COLOR = '0,255,136';      // green neon
const AC_PENDING_COLOR = '255,90,30';   // orange-red
const AC_OPACITIES = [0, 0.15, 0.3, 0.45, 0.65, 0.8, 1.0];
const AC_MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function renderActivityCalendar() {
    const graph = document.getElementById('acGraph');
    const monthsBar = document.getElementById('acMonths');
    const titleEl = document.getElementById('acTitle');
    if (!graph) return;

    const now = new Date();
    const year = now.getFullYear();
    titleEl.textContent = `Actividad ${year}`;

    // Build day->earnings map
    const dayMap = {};
    entries.forEach(e => {
        const d = new Date(e.date + 'T12:00:00');
        if (d.getFullYear() !== year) return;
        if (!dayMap[e.date]) dayMap[e.date] = { total: 0, pending: 0, allPaid: true };
        dayMap[e.date].total += (e.total || 0);
        if (!e.paid) { dayMap[e.date].pending += (e.total || 0); dayMap[e.date].allPaid = false; }
    });

    // Max for level scaling
    const totals = Object.values(dayMap).map(d => d.total);
    const maxTotal = totals.length ? Math.max(...totals) : 1;

    function getLevel(amount) {
        if (amount <= 0) return 0;
        const r = amount / maxTotal;
        if (r <= 0.08) return 1;
        if (r <= 0.2) return 2;
        if (r <= 0.4) return 3;
        if (r <= 0.6) return 4;
        if (r <= 0.8) return 5;
        return 6;
    }

    // Build 2D grid: gridData[col][row] where col=week, row=dayOfWeek(0=Sun)
    const jan1 = new Date(year, 0, 1);
    const startDate = new Date(jan1);
    startDate.setDate(startDate.getDate() - jan1.getDay());

    const dec31 = new Date(year, 11, 31);
    const endDate = new Date(dec31);
    endDate.setDate(endDate.getDate() + (6 - dec31.getDay()));

    const todayStr = getLocalDateString(now);
    const curMonth = now.getMonth();

    const gridData = [];
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const dateStr = getLocalDateString(cursor);
            const m = cursor.getMonth();
            const y = cursor.getFullYear();
            const inYear = y === year;
            week.push({
                dateStr, month: inYear ? m : -1, inYear,
                info: inYear ? (dayMap[dateStr] || null) : null,
                isToday: dateStr === todayStr
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        gridData.push(week);
    }

    const numWeeks = gridData.length;
    const cellSize = 13, gap = 2, weekWidth = cellSize + gap;
    const curBorder = '1.5px solid rgba(0,170,255,0.55)';
    const sepBorder = '1px solid rgba(255,255,255,0.13)';

    // Helper: get month of neighbor cell
    function neighborMonth(col, row) {
        if (col < 0 || col >= numWeeks || row < 0 || row > 6) return -1;
        return gridData[col][row].month;
    }

    // Render
    graph.innerHTML = '';
    monthsBar.innerHTML = '';
    monthsBar.style.width = (numWeeks * weekWidth) + 'px';

    // Month labels
    let lastLabelMonth = -1;
    for (let col = 0; col < numWeeks; col++) {
        for (let row = 0; row < 7; row++) {
            const c = gridData[col][row];
            if (c.inYear && c.month !== lastLabelMonth) {
                const lbl = document.createElement('span');
                lbl.className = 'ac-month-label';
                lbl.textContent = AC_MONTH_NAMES[c.month];
                lbl.style.left = (col * weekWidth) + 'px';
                monthsBar.appendChild(lbl);
                lastLabelMonth = c.month;
                break;
            }
        }
    }

    // Render cells with per-cell borders
    for (let col = 0; col < numWeeks; col++) {
        const weekEl = document.createElement('div');
        weekEl.className = 'ac-week';

        for (let row = 0; row < 7; row++) {
            const cell = gridData[col][row];
            const el = document.createElement('div');
            el.className = 'ac-day';

            if (!cell.inYear) {
                el.style.visibility = 'hidden';
                weekEl.appendChild(el);
                continue;
            }

            // Color: opacity-based on single base color
            if (cell.info) {
                const lvl = getLevel(cell.info.total);
                const base = cell.info.allPaid ? AC_PAID_COLOR : AC_PENDING_COLOR;
                el.style.background = `rgba(${base},${AC_OPACITIES[lvl]})`;
            }

            if (cell.isToday) el.classList.add('ac-today');

            // Borders: irregular month boundaries + current month outline
            const m = cell.month;
            const isCur = m === curMonth;
            const topM = neighborMonth(col, row - 1);
            const botM = neighborMonth(col, row + 1);
            const leftM = neighborMonth(col - 1, row);
            const rightM = neighborMonth(col + 1, row);
            const borders = [];

            if (isCur) {
                // Current month: full outline on all edges touching different months
                if (topM !== m) borders.push('border-top:' + curBorder);
                if (botM !== m) borders.push('border-bottom:' + curBorder);
                if (leftM !== m) borders.push('border-left:' + curBorder);
                if (rightM !== m) borders.push('border-right:' + curBorder);
            } else {
                // Separator: draw on the cell with GREATER month to avoid double borders
                // Skip edges adjacent to current month (those are drawn by the current month cell)
                if (topM >= 0 && topM !== m && m > topM && topM !== curMonth) borders.push('border-top:' + sepBorder);
                if (botM >= 0 && botM !== m && m > botM && botM !== curMonth) borders.push('border-bottom:' + sepBorder);
                if (leftM >= 0 && leftM !== m && m > leftM && leftM !== curMonth) borders.push('border-left:' + sepBorder);
                if (rightM >= 0 && rightM !== m && m > rightM && rightM !== curMonth) borders.push('border-right:' + sepBorder);
            }

            if (borders.length) el.style.cssText += borders.join(';') + ';';

            // Events
            const clickMonth = m;
            el.onclick = () => navigateToMonth(year, clickMonth);
            el.onmouseenter = (ev) => showAcTooltip(ev, cell.dateStr, cell.info);
            el.onmouseleave = hideAcTooltip;

            weekEl.appendChild(el);
        }
        graph.appendChild(weekEl);
    }
}

// Tooltip
let acTooltipEl = null;
function getAcTooltip() {
    if (!acTooltipEl) {
        acTooltipEl = document.createElement('div');
        acTooltipEl.className = 'ac-tooltip';
        document.body.appendChild(acTooltipEl);
    }
    return acTooltipEl;
}

function showAcTooltip(ev, dateStr, info) {
    const tip = getAcTooltip();
    const d = new Date(dateStr + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

    if (info && info.total > 0) {
        let html = `<span class="ac-tooltip-amount">$${info.total.toFixed(0)}</span>`;
        if (info.pending > 0) html += ` <span class="ac-tooltip-pending">(pend: $${info.pending.toFixed(0)})</span>`;
        if (info.allPaid) html += ' <span style="color:#00ff88">&#10003;</span>';
        html += `<div class="ac-tooltip-date">${dateLabel}</div>`;
        tip.innerHTML = html;
    } else {
        tip.innerHTML = `<span style="color:rgba(255,255,255,0.4)">Sin actividad</span><div class="ac-tooltip-date">${dateLabel}</div>`;
    }

    tip.classList.add('visible');
    const rect = ev.target.getBoundingClientRect();
    tip.style.left = Math.max(0, rect.left + rect.width / 2 - tip.offsetWidth / 2) + 'px';
    tip.style.top = (rect.top - tip.offsetHeight - 6) + 'px';
}

function hideAcTooltip() {
    if (acTooltipEl) acTooltipEl.classList.remove('visible');
}

function navigateToMonth(year, month) {
    currentDate = new Date(year, month, 1);
    renderCalendar();
    updateStats();
    const container = document.getElementById('monthlyCalendarContainer');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    dayNames.forEach((day, idx) => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        if (idx === 0) header.classList.add('sunday');
        if (idx === 6) header.classList.add('saturday');
        header.textContent = day;
        grid.appendChild(header);
    });

    // Días del mes anterior (relleno)
    const prevMonth = new Date(year, month, 0);
    for (let i = startDay - 1; i >= 0; i--) {
        const dayOfWeek = startDay - 1 - i;
        const prevDayNum = prevMonth.getDate() - i;
        const day = document.createElement('div');
        day.className = 'calendar-day other-month';
        if (dayOfWeek === 0) day.classList.add('sunday');
        if (dayOfWeek === 6) day.classList.add('saturday');
        day.innerHTML = `<span class="day-number">${prevDayNum}</span>`;
        // Click navega al mes anterior
        day.onclick = () => { changeMonth(-1); };
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

        // Marcar si está seleccionado
        if (selectedDays.has(dateStr)) {
            day.classList.add('selected');
        }

        // Obtener notas del día (sanitizado)
        const dayNotes = dayEntries.filter(e => e.notes).map(e => e.notes).join(' | ');
        const truncatedNotes = dayNotes.length > 30 ? dayNotes.substring(0, 30) + '...' : dayNotes;

        day.innerHTML = `
            <span class="day-number">${i}</span>
            ${dayEntries.length > 0 ? `<span class="day-entries-count">${dayEntries.length} reg</span>` : ''}
            ${dayTotal > 0 ? `<span class="day-amount">$${dayTotal.toFixed(0)}</span>` : ''}
            ${truncatedNotes ? `<span class="day-notes">${escapeHtml(truncatedNotes)}</span>` : ''}
        `;

        // Click normal abre modal, con Ctrl/Cmd selecciona
        day.onclick = (e) => {
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            if (e.ctrlKey || e.metaKey || selectionMode) {
                toggleDaySelection(dateStr);
            } else {
                openDayModal(dateStr, dayEntries);
            }
        };

        // Long press para activar modo selección
        let pressTimer;
        const startPress = (e) => {
            longPressTriggered = false;
            pressTimer = setTimeout(() => {
                longPressTriggered = true;
                selectionMode = true;
                toggleDaySelection(dateStr);
                showToast('Modo selección activado');
            }, 500);
        };
        const cancelPress = () => {
            clearTimeout(pressTimer);
        };

        day.addEventListener('mousedown', startPress);
        day.addEventListener('touchstart', startPress, { passive: true });
        day.addEventListener('mouseup', cancelPress);
        day.addEventListener('touchend', cancelPress);
        day.addEventListener('mouseleave', cancelPress);

        grid.appendChild(day);
    }

    // Calcular filas dinámicas (solo las necesarias)
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
        // Click navega al mes siguiente
        day.onclick = () => { changeMonth(1); };
        grid.appendChild(day);
    }

    // Mostrar botón para limpiar selección si hay días seleccionados
    updateSelectionUI();
}

function toggleDaySelection(dateStr) {
    if (selectedDays.has(dateStr)) {
        selectedDays.delete(dateStr);
    } else {
        selectedDays.add(dateStr);
    }

    // Si no queda ninguna selección, desactivar modo selección
    if (selectedDays.size === 0) {
        selectionMode = false;
    }

    renderCalendar();
    updateSelectionStats();
    updateSelectionUI();
}

function clearDaySelection() {
    selectedDays.clear();
    selectedEntries.clear();
    selectionMode = false;
    renderCalendar();
    updateStats();
    updateSelectionUI();
}

// Sincronizar seleccion de dias a registros
function syncSelectionToEntries() {
    selectedEntries.clear();
    entries.forEach(e => {
        if (selectedDays.has(e.date)) {
            selectedEntries.add(e.id);
        }
    });
    renderEntries();
}

function updateSelectionStats() {
    if (selectedDays.size === 0 && selectedEntries.size === 0) {
        updateStats();
        return;
    }

    // Obtener registros seleccionados (por dias o directamente)
    let selected;
    if (selectedDays.size > 0) {
        selected = entries.filter(e => selectedDays.has(e.date));
    } else {
        selected = entries.filter(e => selectedEntries.has(e.id));
    }

    const total = selected.reduce((sum, e) => sum + (e.total || 0), 0);
    const pending = selected.filter(e => !e.paid).reduce((sum, e) => sum + (e.total || 0), 0);
    const days = new Set(selected.map(e => e.date)).size;

    document.getElementById('totalEarnings').textContent = '$' + total.toFixed(2);
    document.getElementById('pendingAmount').textContent = '$' + pending.toFixed(2);
    document.getElementById('totalDays').textContent = days;
    document.getElementById('totalLabel').textContent = 'Selección';
    document.getElementById('pendingLabel').textContent = 'Pendiente';
    document.getElementById('daysLabel').textContent = 'Días';

    // Agregar clase visual
    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.add('showing-selection');
    });
}

function updateSelectionUI() {
    let actionsContainer = document.getElementById('selectionActions');

    if (selectedDays.size > 0 || selectedEntries.size > 0) {
        if (!actionsContainer) {
            actionsContainer = document.createElement('div');
            actionsContainer.id = 'selectionActions';
            actionsContainer.className = 'selection-actions';
            actionsContainer.innerHTML = `
                <button class="selection-btn clear" onclick="clearDaySelection()">✕ Limpiar</button>
                <button class="selection-btn paid" onclick="confirmMarkAsPaid()">Marcar Pagado</button>
            `;
            document.querySelector('.stats-grid').after(actionsContainer);
        }
        actionsContainer.style.display = 'flex';
    } else {
        if (actionsContainer) actionsContainer.style.display = 'none';
        document.querySelectorAll('.stat-card').forEach(card => {
            card.classList.remove('showing-selection');
        });
    }
}

// ============================================
// CONFIRM MODAL (in-page)
// ============================================
let confirmCallback = null;

function showConfirmModal(title, messageHtml, confirmLabel, callback) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').innerHTML = messageHtml;
    document.getElementById('confirmModalBtn').textContent = confirmLabel || 'Confirmar';
    confirmCallback = callback;
    openModal('confirmModal');
}

function closeConfirmModal(accepted) {
    closeModal('confirmModal');
    if (accepted && confirmCallback) {
        confirmCallback();
    }
    confirmCallback = null;
}

// Mostrar confirmacion antes de marcar como pagado
function confirmMarkAsPaid() {
    // Obtener registros seleccionados
    let selected;
    if (selectedDays.size > 0) {
        selected = entries.filter(e => selectedDays.has(e.date));
    } else {
        selected = entries.filter(e => selectedEntries.has(e.id));
    }

    const pendingOnly = selected.filter(e => !e.paid);
    if (pendingOnly.length === 0) {
        showToast('No hay registros pendientes en la selección', 'error');
        return;
    }

    const total = pendingOnly.reduce((sum, e) => sum + (e.total || 0), 0);
    const days = new Set(pendingOnly.map(e => e.date)).size;

    // Agrupar por fruta (usar snapshot)
    const byFruit = {};
    pendingOnly.forEach(e => {
        const jobData = getEntryJobData(e);
        const fruit = jobData.product || 'Sin trabajo';
        if (!byFruit[fruit]) byFruit[fruit] = { count: 0, total: 0 };
        byFruit[fruit].count++;
        byFruit[fruit].total += (e.total || 0);
    });

    let fruitLines = '';
    Object.keys(byFruit).forEach(fruit => {
        fruitLines += `<div class="confirm-fruit-line"><span>${fruit}: ${byFruit[fruit].count} reg</span><span>$${byFruit[fruit].total.toFixed(2)}</span></div>`;
    });

    const messageHtml = `
        <div class="confirm-summary">${fruitLines}</div>
        <div class="confirm-totals">Total: $${total.toFixed(2)}</div>
        <div class="confirm-stats">
            <span>Días: ${days}</span>
            <span>Registros: ${pendingOnly.length}</span>
        </div>
    `;

    showConfirmModal('Marcar como PAGADO', messageHtml, 'Marcar Pagado', () => {
        markSelectionAs(true);
    });
}

// Marcar registros seleccionados como pagado o pendiente
async function markSelectionAs(paid) {
    if (!currentUser) return;

    let selected;
    if (selectedDays.size > 0) {
        selected = entries.filter(e => selectedDays.has(e.date));
    } else {
        selected = entries.filter(e => selectedEntries.has(e.id));
    }

    if (selected.length === 0) return;

    try {
        const updates = {};
        selected.forEach(e => {
            updates[`harvest/${currentUser.uid}/${e.id}/paid`] = paid;
        });

        await db.ref().update(updates);
        showToast(paid ? 'Marcados como pagado' : 'Marcados como pendiente');
        clearDaySelection();
    } catch (error) {
        showToast('Error al actualizar', 'error');
    }
}

function changeMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    renderCalendar();
    if (selectedDays.size > 0) {
        updateSelectionStats();
    } else {
        updateStats();
    }
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
        list.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">No hay registros para este día</p>';
    } else {
        list.innerHTML = dayEntries.map(e => {
            const jobData = getEntryJobData(e);
            const safeDisplayName = escapeHtml(getDisplayName(jobData));
            return `
                <div class="entry-card" onclick="closeDayModal(); openEntryModal('${e.id}')">
                    <div class="entry-info">
                        <div class="entry-date">${safeDisplayName}</div>
                        <div class="entry-details">${e.quantity ? e.quantity + ' unidades' : 'Jornada'} ${e.paid ? '• Pagado' : '• Pendiente'}</div>
                    </div>
                    <div class="entry-total">$${(e.total || 0).toFixed(2)}</div>
                </div>
            `;
        }).join('');
    }

    openModal('dayModal');
}

function closeDayModal() {
    closeModal('dayModal');
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

    // Actualizar filtro de frutas
    updateFruitFilter();

    // Aplicar filtros
    const fruitFilter = document.getElementById('filterFruit')?.value || '';
    let filteredEntries = entries.filter(e => {
        const jobData = getEntryJobData(e);

        // Filtro por fruta (usar snapshot)
        if (fruitFilter && jobData.product !== fruitFilter) return false;

        // Filtro por pago
        if (paymentFilter === 'pending' && e.paid) return false;
        if (paymentFilter === 'paid' && !e.paid) return false;

        return true;
    });

    // Si hay seleccion activa, mover seleccionados arriba ordenados cronologicamente
    if (selectionMode && selectedEntries.size > 0) {
        const selectedList = filteredEntries.filter(e => selectedEntries.has(e.id));
        const unselectedList = filteredEntries.filter(e => !selectedEntries.has(e.id));
        // Ordenar seleccionados cronologicamente (mas reciente primero)
        selectedList.sort((a, b) => new Date(b.date) - new Date(a.date));
        filteredEntries = [...selectedList, ...unselectedList];
    }

    if (filteredEntries.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="icon">📋</div>
                <h3>No hay registros</h3>
                <p>${entries.length > 0 ? 'No hay registros con estos filtros' : 'Agrega tu primer registro de cosecha'}</p>
            </div>
        `;
        return;
    }

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

    // Agrupar por mes
    const groupedByMonth = {};
    filteredEntries.forEach(e => {
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

    // Ordenar meses de mas reciente a mas antiguo
    const sortedMonths = Object.keys(groupedByMonth).sort().reverse();

    let html = '';
    sortedMonths.forEach(monthKey => {
        const group = groupedByMonth[monthKey];
        const monthLabel = `${monthNames[group.month]} ${group.year}`;

        // Separador de mes
        html += `
            <div class="month-separator">
                <span class="month-separator-title">${monthLabel}</span>
                <span class="month-separator-line"></span>
                <span class="month-separator-stats">${group.entries.length} registros - <span class="total">$${group.total.toFixed(2)}</span></span>
            </div>
        `;

        // Entradas del mes
        group.entries.forEach(e => {
            const jobData = getEntryJobData(e);
            const date = new Date(e.date + 'T12:00:00');
            const dayName = dayNames[date.getDay()];
            const dateStr = `${date.getDate()} ${monthNames[date.getMonth()].substring(0, 3)}`;
            const fruta = escapeHtml(jobData.product || 'Sin trabajo');
            const safeEmployer = escapeHtml(jobData.employer || '');
            const precio = '$' + (e.total || 0).toFixed(2);
            const isSelected = selectedEntries.has(e.id);

            html += `
                <div class="entry-card ${isSelected ? 'selected' : ''}" data-entry-id="${e.id}">
                    <div class="entry-info">
                        <div class="entry-date">${dayName} - ${dateStr} - ${fruta}</div>
                        <div class="entry-details">${e.quantity ? e.quantity + ' unidades' : 'Jornada'} ${safeEmployer ? '• ' + safeEmployer : ''} ${e.paid ? '• Pagado' : '• Pendiente'}</div>
                    </div>
                    <div class="entry-amount">
                        <div class="entry-total">${precio}</div>
                    </div>
                </div>
            `;
        });
    });

    list.innerHTML = html;

    // Agregar eventos de long press a cada entry-card
    list.querySelectorAll('.entry-card').forEach(card => {
        const entryId = card.dataset.entryId;
        let pressTimer;

        // Click normal o con Ctrl/Cmd
        card.onclick = (e) => {
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            if (e.ctrlKey || e.metaKey || selectionMode) {
                toggleEntrySelection(entryId);
            } else {
                openEntryModal(entryId);
            }
        };

        // Long press para activar modo selección
        const startPress = () => {
            longPressTriggered = false;
            pressTimer = setTimeout(() => {
                longPressTriggered = true;
                selectionMode = true;
                toggleEntrySelection(entryId);
                showToast('Modo selección activado');
            }, 500);
        };
        const cancelPress = () => {
            clearTimeout(pressTimer);
        };

        card.addEventListener('mousedown', startPress);
        card.addEventListener('touchstart', startPress, { passive: true });
        card.addEventListener('mouseup', cancelPress);
        card.addEventListener('touchend', cancelPress);
        card.addEventListener('mouseleave', cancelPress);
    });
}

function toggleEntrySelection(entryId) {
    if (selectedEntries.has(entryId)) {
        selectedEntries.delete(entryId);
    } else {
        selectedEntries.add(entryId);
    }

    // Si no queda ninguna selección, desactivar modo selección y limpiar días
    if (selectedEntries.size === 0) {
        selectedDays.clear();
        selectionMode = false;
        renderCalendar();
    } else {
        // Sincronizar registros seleccionados hacia el calendario
        syncSelectionToDays();
    }

    renderEntries();
    updateSelectionStats();
    updateSelectionUI();
}

// Sincronizar seleccion de registros a dias del calendario
function syncSelectionToDays() {
    selectedDays.clear();
    entries.forEach(e => {
        if (selectedEntries.has(e.id)) {
            selectedDays.add(e.date);
        }
    });
    renderCalendar();
}

function clearEntrySelection() {
    selectedEntries.clear();
    selectedDays.clear();
    selectionMode = false;
    renderEntries();
    renderCalendar();
    updateStats();
    updateSelectionUI();
}

// Actualizar filtro de frutas
function updateFruitFilter() {
    const select = document.getElementById('filterFruit');
    if (!select) return;

    const currentVal = select.value;

    // Obtener frutas unicas de los registros (usar snapshot)
    const fruitsInEntries = new Set();
    entries.forEach(e => {
        const jobData = getEntryJobData(e);
        if (jobData.product) fruitsInEntries.add(jobData.product);
    });

    let options = '<option value="">Todas las frutas</option>';
    Array.from(fruitsInEntries).sort().forEach(fruit => {
        options += `<option value="${fruit}">${fruit}</option>`;
    });

    select.innerHTML = options;
    if (currentVal) select.value = currentVal;
}

// Cambiar filtro de pago
function setPaymentFilter(filter) {
    paymentFilter = filter;

    // Actualizar UI de botones
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    renderEntries();
}

// ============================================
// TOAST
// ============================================
let toastTimeout = null;

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    // Limpiar toast anterior
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toast.classList.remove('visible');
    }
    // Pequeño delay para permitir la transición de salida si había un toast previo
    requestAnimationFrame(() => {
        toast.textContent = message;
        toast.className = 'toast visible' + (type === 'error' ? ' error' : '');
        toastTimeout = setTimeout(() => {
            toast.classList.remove('visible');
            toastTimeout = null;
        }, 3000);
    });
}

// ============================================
// ADD FRUIT MODAL
// ============================================
function openAddFruitModal() {
    document.getElementById('newFruitName').value = '';
    openModal('addFruitModal');
}

function closeAddFruitModal() {
    closeModal('addFruitModal');
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
// USER PROFILE DROPDOWN
// ============================================
let bossMode = false;

function updateUserProfileUI(user) {
    if (!user) return;

    const name = user.displayName || '';
    const email = user.email || '';
    const photoURL = user.photoURL || '';

    // Generar iniciales
    let initials = '?';
    if (name) {
        const parts = name.split(' ');
        initials = parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : name.substring(0, 2).toUpperCase();
    } else if (email) {
        initials = email[0].toUpperCase();
    }

    // Avatar en boton
    const avatarImg = document.getElementById('userAvatarImg');
    const avatarInitials = document.getElementById('userAvatarInitials');
    if (photoURL) {
        avatarImg.src = photoURL;
        avatarImg.style.display = 'block';
        avatarInitials.style.display = 'none';
    } else {
        avatarImg.style.display = 'none';
        avatarInitials.style.display = 'flex';
        avatarInitials.textContent = initials;
    }

    // Avatar en dropdown
    const dropdownImg = document.getElementById('dropdownAvatarImg');
    const dropdownInitials = document.getElementById('dropdownAvatarInitials');
    if (photoURL) {
        dropdownImg.src = photoURL;
        dropdownImg.style.display = 'block';
        dropdownInitials.style.display = 'none';
    } else {
        dropdownImg.style.display = 'none';
        dropdownInitials.style.display = 'flex';
        dropdownInitials.textContent = initials;
    }

    // Info en dropdown
    document.getElementById('dropdownUserName').textContent = name || 'Usuario';
    document.getElementById('dropdownUserEmail').textContent = email;
}

function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('visible');
}

function closeUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) dropdown.classList.remove('visible');
}

// ============================================
// BOSS MODE - REAL LOGIC
// ============================================

/**
 * Carga el estado del modo jefe desde Firebase al iniciar la app.
 */
async function loadBossModeState() {
    if (!currentUser) return;

    const userSnap = await db.ref(`users/${currentUser.uid}`).once('value');
    const userData = userSnap.val();
    if (!userData) return;

    const { bossActivatedAt, bossPermanent } = userData;

    if (bossPermanent) {
        // Permanently a boss - just activate
        bossMode = true;
        applyBossModeUI(true);
        return;
    }

    if (!bossActivatedAt) {
        // Never activated
        bossMode = false;
        applyBossModeUI(false);
        return;
    }

    // Check if 24 hours have passed since activation
    const hoursSinceActivation = (Date.now() - bossActivatedAt) / (1000 * 60 * 60);

    if (hoursSinceActivation >= 24) {
        // Check if there are any bossHarvest documents
        const bossHarvestSnap = await db.ref(`bossHarvest/${currentUser.uid}`).once('value');

        if (bossHarvestSnap.exists()) {
            // Has boss harvest data - make permanent
            await db.ref(`users/${currentUser.uid}`).update({
                bossPermanent: true
            });
            bossMode = true;
            applyBossModeUI(true);
        } else {
            // No boss harvest data after 24h - deactivate
            await db.ref(`users/${currentUser.uid}`).update({
                bossActivatedAt: null,
                bossPermanent: false
            });
            bossMode = false;
            applyBossModeUI(false);
        }
    } else {
        // Within 24h window - boss mode is active
        bossMode = true;
        applyBossModeUI(true);
    }
}

/**
 * Aplica los cambios visuales del modo jefe.
 */
function applyBossModeUI(active) {
    const toggle = document.getElementById('bossModeToggle');
    if (toggle) toggle.classList.toggle('active', active);

    if (active) {
        document.body.classList.add('boss-mode');
    } else {
        document.body.classList.remove('boss-mode');
        // If currently on cuadrilla tab, switch away
        const cuadrillaTab = document.querySelector('.tab[data-tab="cuadrilla"]');
        if (cuadrillaTab && cuadrillaTab.classList.contains('active')) {
            switchTab('calendario');
        }
        // Unsubscribe cuadrilla data listeners
        if (typeof unloadCuadrillaData === 'function') {
            unloadCuadrillaData();
        }
    }
}

/**
 * Toggle del modo jefe conectado a Firebase.
 */
async function toggleBossMode(event) {
    event.stopPropagation();
    if (!currentUser) return;

    const newState = !bossMode;

    if (newState) {
        // Activating boss mode
        const userSnap = await db.ref(`users/${currentUser.uid}`).once('value');
        const userData = userSnap.val() || {};

        if (userData.bossPermanent) {
            // Already permanent - just toggle UI
            bossMode = true;
            applyBossModeUI(true);
            showToast('Modo Jefe activado');
            return;
        }

        if (!userData.bossActivatedAt) {
            // First time activation - write timestamp
            await db.ref(`users/${currentUser.uid}`).update({
                bossActivatedAt: Date.now()
            });
        }

        bossMode = true;
        applyBossModeUI(true);
        showToast('Modo Jefe activado');
    } else {
        // Deactivating boss mode (UI only, keeps bossActivatedAt for the 24h check)
        bossMode = false;
        applyBossModeUI(false);
        showToast('Modo Jefe desactivado');
    }
}

// ============================================
// WELCOME MODAL
// ============================================

let welcomeUsernameTimer = null;

function showWelcomeModal(profile) {
    const modal = document.getElementById('welcomeModal');
    if (!modal) return;

    const usernameInput = document.getElementById('welcomeUsername');
    if (usernameInput) {
        usernameInput.value = profile.username || '';
    }

    const statusEl = document.getElementById('welcomeUsernameStatus');
    if (statusEl) statusEl.textContent = '';

    openModal('welcomeModal');
}

function onWelcomeUsernameInput(input) {
    // Clean input: only lowercase letters and numbers
    input.value = input.value.replace(/[^a-z0-9]/g, '').substring(0, 12);

    const statusEl = document.getElementById('welcomeUsernameStatus');
    const hintEl = document.getElementById('welcomeUsernameHint');

    if (!input.value) {
        if (statusEl) statusEl.textContent = '';
        if (hintEl) {
            hintEl.textContent = 'Solo letras minusculas y numeros, max 12 caracteres. Solo puedes cambiarlo 1 vez.';
            hintEl.className = 'username-hint';
        }
        return;
    }

    // Debounce the availability check
    clearTimeout(welcomeUsernameTimer);
    if (statusEl) statusEl.textContent = '...';

    welcomeUsernameTimer = setTimeout(async () => {
        const username = input.value;

        // If same as current, it's available
        if (userProfile && username === userProfile.username) {
            if (statusEl) statusEl.textContent = '';
            if (hintEl) {
                hintEl.textContent = 'Tu username actual';
                hintEl.className = 'username-hint success';
            }
            return;
        }

        const available = await checkUsernameAvailable(username);
        if (input.value !== username) return; // Input changed

        if (available) {
            if (statusEl) statusEl.textContent = '';
            if (hintEl) {
                hintEl.textContent = 'Disponible';
                hintEl.className = 'username-hint success';
            }
        } else {
            if (statusEl) statusEl.textContent = '';
            if (hintEl) {
                hintEl.textContent = 'Este username ya esta en uso';
                hintEl.className = 'username-hint error';
            }
        }
    }, 400);
}

async function saveWelcomeProfile() {
    if (!currentUser || !userProfile) return;

    const usernameInput = document.getElementById('welcomeUsername');
    const rutInput = document.getElementById('welcomeRut');
    const saveBtn = document.getElementById('welcomeSaveBtn');

    const newUsername = usernameInput ? usernameInput.value.trim() : '';
    const rut = rutInput ? rutInput.value.trim() : '';

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
        // Handle username change
        if (newUsername && newUsername !== userProfile.username) {
            await changeUsername(currentUser.uid, userProfile.username, newUsername);
            userProfile.username = newUsername;
        }

        // Handle RUT
        if (rut) {
            await db.ref(`users/${currentUser.uid}/rut`).set(rut);
            userProfile.rut = rut;
        }

        closeModal('welcomeModal');
        showToast('Perfil guardado');
    } catch (e) {
        showToast(e.message || 'Error al guardar', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar';
    }
}

function skipWelcomeModal() {
    closeModal('welcomeModal');
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    renderCalendar();

    // Cerrar dropdown de usuario al hacer click fuera
    document.addEventListener('click', (e) => {
        const container = document.getElementById('userMenuContainer');
        if (container && !container.contains(e.target)) {
            closeUserDropdown();
        }
    });

    // Cerrar modales con Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modals = [
                { id: 'addFruitModal', close: closeAddFruitModal },
                { id: 'confirmModal', close: () => closeConfirmModal(false) },
                { id: 'dayModal', close: closeDayModal },
                { id: 'entryModal', close: closeEntryModal },
                { id: 'jobModal', close: closeJobModal }
            ];
            for (const modal of modals) {
                const el = document.getElementById(modal.id);
                if (el && el.classList.contains('visible')) {
                    modal.close();
                    break;
                }
            }
        }
    });
});
