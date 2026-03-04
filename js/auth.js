/**
 * Authentication Module
 * Manejo de autenticacion con Firebase Auth
 * Incluye creacion de perfil de usuario con username unico
 */

// ============================================
// USERNAME GENERATION
// ============================================

/**
 * Genera un username desde displayName o email.
 * Quita acentos, espacios y caracteres especiales, convierte a minusculas, trunca a 12 chars.
 */
function generateBaseUsername(displayName, email) {
    let base = displayName || email.split('@')[0] || 'user';
    // Quitar acentos
    base = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Solo letras y numeros, minusculas
    base = base.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // Truncar a 12
    if (base.length > 12) base = base.substring(0, 12);
    // Si queda vacio
    if (!base) base = 'user';
    return base;
}

/**
 * Encuentra un username disponible agregando numeros incrementales si es necesario.
 * Escribe atomicamente en usernames/{username}: uid como indice invertido.
 * Retorna el username final asignado.
 */
async function findAvailableUsername(baseUsername, uid) {
    let candidate = baseUsername;
    let counter = 1;
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
        const usernameRef = db.ref(`usernames/${candidate}`);
        // Intentar escribir atomicamente usando transaction
        const result = await usernameRef.transaction((currentValue) => {
            if (currentValue === null) {
                return uid; // Claim this username
            }
            return; // Abort - username taken
        });

        if (result.committed) {
            return candidate;
        }

        // Username taken, try next
        const suffix = String(counter);
        const maxBaseLen = 12 - suffix.length;
        candidate = baseUsername.substring(0, maxBaseLen) + suffix;
        counter++;
    }

    // Fallback: use uid prefix
    const fallback = uid.substring(0, 12).toLowerCase();
    await db.ref(`usernames/${fallback}`).set(uid);
    return fallback;
}

// ============================================
// USER PROFILE CREATION
// ============================================

/**
 * Crea o actualiza el perfil de usuario en Firebase.
 * Si es primer login (no tiene username), crea el perfil completo.
 * Retorna { isNewUser: boolean, userProfile: object }
 */
async function ensureUserProfile(user) {
    const userRef = db.ref(`users/${user.uid}`);
    const snapshot = await userRef.once('value');
    const existingData = snapshot.val();

    if (existingData && existingData.username) {
        // Usuario existente con username - solo actualizar lastLogin
        await userRef.update({
            lastLogin: Date.now(),
            displayName: user.displayName || existingData.displayName || '',
            photoURL: user.photoURL || existingData.photoURL || ''
        });
        return { isNewUser: false, userProfile: { ...existingData, uid: user.uid } };
    }

    // Usuario nuevo o sin username - crear perfil completo
    const displayName = user.displayName || '';
    const email = user.email || '';
    const photoURL = user.photoURL || '';

    const baseUsername = generateBaseUsername(displayName, email);
    const username = await findAvailableUsername(baseUsername, user.uid);

    const profile = {
        username: username,
        displayName: displayName,
        email: email,
        photoURL: photoURL,
        rut: existingData ? existingData.rut || null : null,
        role: existingData ? existingData.role || 'worker' : 'worker',
        bossActivatedAt: existingData ? existingData.bossActivatedAt || null : null,
        bossPermanent: existingData ? existingData.bossPermanent || false : false,
        usernameChangedAt: null,
        createdAt: existingData ? existingData.createdAt || Date.now() : Date.now(),
        lastLogin: Date.now()
    };

    await userRef.update(profile);

    return { isNewUser: true, userProfile: { ...profile, uid: user.uid } };
}

/**
 * Cambia el username del usuario (solo permitido 1 vez).
 * Valida disponibilidad y escribe en usernames/ atomicamente.
 */
async function changeUsername(uid, oldUsername, newUsername) {
    // Validar formato
    const clean = newUsername.replace(/[^a-z0-9]/g, '');
    if (clean !== newUsername || newUsername.length === 0 || newUsername.length > 12) {
        throw new Error('Username debe tener 1-12 caracteres, solo letras minusculas y numeros');
    }

    // Verificar que no haya cambiado antes
    const userSnap = await db.ref(`users/${uid}/usernameChangedAt`).once('value');
    if (userSnap.val() !== null) {
        throw new Error('Solo puedes cambiar tu username una vez');
    }

    // Intentar reclamar el nuevo username
    const usernameRef = db.ref(`usernames/${newUsername}`);
    const result = await usernameRef.transaction((currentValue) => {
        if (currentValue === null) {
            return uid;
        }
        return; // abort - taken
    });

    if (!result.committed) {
        throw new Error('Ese username ya esta en uso');
    }

    // Liberar el username anterior
    if (oldUsername) {
        await db.ref(`usernames/${oldUsername}`).remove();
    }

    // Actualizar perfil
    await db.ref(`users/${uid}`).update({
        username: newUsername,
        usernameChangedAt: Date.now()
    });

    return newUsername;
}

/**
 * Verifica si un username esta disponible (para validacion en tiempo real).
 */
async function checkUsernameAvailable(username) {
    if (!username || username.length === 0 || username.length > 12) return false;
    if (username !== username.replace(/[^a-z0-9]/g, '')) return false;
    const snap = await db.ref(`usernames/${username}`).once('value');
    return !snap.exists();
}

// ============================================
// AUTH STATE LISTENER (index.html)
// ============================================

// Auth state listener - solo para elementos de UI que auth.js gestiona (index.html)
auth.onAuthStateChanged((user) => {
    // Solo ejecutar si los elementos existen (index.html)
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const userEmail = document.getElementById('userEmail');

    if (!loginBtn && !userMenu) return; // No estamos en index.html

    if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userMenu) userMenu.classList.add('visible');
        if (userEmail) userEmail.textContent = user.displayName || user.email;
    } else {
        if (loginBtn) loginBtn.style.display = 'block';
        if (userMenu) userMenu.classList.remove('visible');
    }
});

// ============================================
// MODAL FUNCTIONS
// ============================================

function openAuthModal() {
    const overlay = document.getElementById('authModalOverlay');
    if (overlay) {
        overlay.classList.add('visible');
        hideAuthMessages();
    }
}

function closeAuthModal(event) {
    // No permitir cerrar si estamos en cosecha.html y no hay usuario logueado
    if (window.location.pathname.includes('cosecha') && !auth.currentUser) {
        return;
    }
    const overlay = document.getElementById('authModalOverlay');
    if (!event || event.target === overlay) {
        overlay.classList.remove('visible');
        resetAuthForms();
    }
}

function switchAuthTab(tab) {
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');

    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));

    if (tab === 'login') {
        tabs[0].classList.add('active');
        document.getElementById('loginForm').classList.add('active');
    } else {
        tabs[1].classList.add('active');
        document.getElementById('registerForm').classList.add('active');
    }

    hideAuthMessages();
}

// Helper Functions
function hideAuthMessages() {
    const error = document.getElementById('authError');
    const success = document.getElementById('authSuccess');
    if (error) error.classList.remove('visible');
    if (success) success.classList.remove('visible');
}

function resetAuthForms() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.reset();
    if (registerForm) registerForm.reset();
}

function showAuthError(message) {
    const errorEl = document.getElementById('authError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('visible');
    }
    const successEl = document.getElementById('authSuccess');
    if (successEl) successEl.classList.remove('visible');
}

function showAuthSuccess(message) {
    const successEl = document.getElementById('authSuccess');
    if (successEl) {
        successEl.textContent = message;
        successEl.classList.add('visible');
    }
    const errorEl = document.getElementById('authError');
    if (errorEl) errorEl.classList.remove('visible');
}

// ============================================
// GOOGLE SIGN-IN
// ============================================

async function loginWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        const result = await auth.signInWithPopup(provider);
        showAuthSuccess('Sesion iniciada con Google');
        setTimeout(() => closeAuthModal(), 1000);
    } catch (error) {
        if (error.code === 'auth/cancelled-popup-request') return;
        let message = 'Error al iniciar sesion con Google';
        if (error.code === 'auth/popup-closed-by-user') {
            message = 'Inicio de sesion cancelado';
        } else if (error.code === 'auth/popup-blocked') {
            message = 'Popup bloqueado. Permite popups para este sitio';
        }
        showAuthError(message);
    }
}

// ============================================
// EMAIL/PASSWORD LOGIN
// ============================================

async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const submitBtn = document.getElementById('loginSubmit');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';

    try {
        await auth.signInWithEmailAndPassword(email, password);
        showAuthSuccess('Sesion iniciada correctamente');
        setTimeout(() => closeAuthModal(), 1000);
    } catch (error) {
        const messages = {
            'auth/user-not-found': 'Usuario no encontrado',
            'auth/wrong-password': 'Contrasena incorrecta',
            'auth/invalid-email': 'Correo invalido',
            'auth/too-many-requests': 'Demasiados intentos. Intenta mas tarde'
        };
        showAuthError(messages[error.code] || 'Error al iniciar sesion');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar';
    }
}

// ============================================
// EMAIL/PASSWORD REGISTER
// ============================================

async function handleRegister(event) {
    event.preventDefault();

    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
    const submitBtn = document.getElementById('registerSubmit');

    if (password !== passwordConfirm) {
        showAuthError('Las contrasenas no coinciden');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando cuenta...';

    try {
        await auth.createUserWithEmailAndPassword(email, password);
        showAuthSuccess('Cuenta creada exitosamente');
        setTimeout(() => closeAuthModal(), 1000);
    } catch (error) {
        const messages = {
            'auth/email-already-in-use': 'Este correo ya esta registrado',
            'auth/invalid-email': 'Correo invalido',
            'auth/weak-password': 'La contrasena es muy debil'
        };
        showAuthError(messages[error.code] || 'Error al crear cuenta');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear Cuenta';
    }
}

// ============================================
// LOGOUT
// ============================================

function logoutUser() {
    auth.signOut();
}
