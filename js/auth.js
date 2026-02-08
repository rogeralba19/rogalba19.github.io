/**
 * Authentication Module
 * Manejo de autenticacion con Firebase Auth
 */

// Auth state listener
auth.onAuthStateChanged((user) => {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const userEmail = document.getElementById('userEmail');

    if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userMenu) userMenu.classList.add('visible');
        if (userEmail) userEmail.textContent = user.displayName || user.email;
    } else {
        if (loginBtn) loginBtn.style.display = 'block';
        if (userMenu) userMenu.classList.remove('visible');
    }
});

// Modal Functions
function openAuthModal() {
    const overlay = document.getElementById('authModalOverlay');
    if (overlay) {
        overlay.classList.add('visible');
        hideAuthMessages();
    }
}

function closeAuthModal(event) {
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

// Google Sign-In
async function loginWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        const result = await auth.signInWithPopup(provider);
        const user = result.user;

        // Save/update user in database
        const userRef = db.ref('users/' + user.uid);
        const snapshot = await userRef.once('value');

        if (!snapshot.exists()) {
            await userRef.set({
                email: user.email,
                displayName: user.displayName || '',
                photoURL: user.photoURL || '',
                createdAt: Date.now(),
                role: 'user',
                provider: 'google'
            });
        } else {
            await userRef.update({
                lastLogin: Date.now(),
                displayName: user.displayName || '',
                photoURL: user.photoURL || ''
            });
        }

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

// Email/Password Login
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

// Email/Password Register
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
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await db.ref('users/' + userCredential.user.uid).set({
            email: email,
            createdAt: Date.now(),
            role: 'user'
        });
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

// Logout
function logoutUser() {
    auth.signOut();
}
