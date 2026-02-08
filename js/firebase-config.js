/**
 * Firebase Configuration
 * Configuracion centralizada de Firebase para toda la aplicacion
 */

const firebaseConfig = {
    apiKey: "AIzaSyBvju4gyCpz6E6R3TsvO1uR1KZB7ZbW9VU",
    authDomain: "albastudio-e0d5b.firebaseapp.com",
    databaseURL: "https://albastudio-e0d5b-default-rtdb.firebaseio.com",
    projectId: "albastudio-e0d5b",
    storageBucket: "albastudio-e0d5b.firebasestorage.app",
    messagingSenderId: "519359936167",
    appId: "1:519359936167:web:8c2680ed1e4583def28d82"
};

// Initialize Firebase (solo una vez)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Export references
const auth = firebase.auth();
const db = firebase.database();
