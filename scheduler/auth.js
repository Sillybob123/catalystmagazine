// WARNING: Do NOT deploy this app with sensitive information exposed!
// This configuration is safe to be client-side.
const firebaseConfig = {
    apiKey: "AIzaSyBT6urJvPCtuYQ1c2iH77QTDfzE3yGw-Xk", // Your Web API Key
    authDomain: "catalystmonday.firebaseapp.com",
    projectId: "catalystmonday",
    storageBucket: "catalystmonday.appspot.com",
    // These values are often not needed for Auth/Firestore but are good to have
    // You can find them in your Firebase Project Settings
    messagingSenderId: "394311851220", 
    appId: "1:394311851220:web:86e4939b7d5a085b46d75d" // Check your firebase console for this value
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Login functionality
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.querySelector('.login-submit');
const passwordToggle = document.getElementById('toggle-password');

// Focus email on load for quicker sign in
setTimeout(() => emailInput && emailInput.focus(), 150);

const setLoadingState = (isLoading) => {
    if (!loginButton) return;
    loginButton.disabled = isLoading;
    loginButton.classList.toggle('is-loading', isLoading);
    loginButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
};

const showError = (message = '') => {
    if (!loginError) return;
    loginError.textContent = message;
    loginError.hidden = !message;
};

showError('');

if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showError('Please enter both your email and password.');
            (!email ? emailInput : passwordInput).focus();
            return;
        }

        showError('');
        setLoadingState(true);

        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                // Signed in
                const user = userCredential.user;
                console.log('User logged in:', user.uid);
                window.location.href = 'dashboard.html'; // Redirect to dashboard
            })
            .catch((error) => {
                showError(error.message || 'Unable to sign in right now.');
                console.error('Login error:', error);
            })
            .finally(() => {
                setLoadingState(false);
            });
    });
} else {
    console.warn('Login form not found on this page.');
}

// Toggle password visibility for better UX
if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
        const isHidden = passwordInput.type === 'password';
        passwordInput.type = isHidden ? 'text' : 'password';
        passwordToggle.textContent = isHidden ? 'Hide' : 'Show';
        passwordToggle.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
        passwordInput.focus();
    });
}

// Clear error message when the user edits fields
[emailInput, passwordInput].forEach((input) => {
    if (input) {
        input.addEventListener('input', () => showError(''));
    }
});

// Check if a user is already logged in
auth.onAuthStateChanged((user) => {
    if (user) {
        // If user is logged in and on the login page, redirect to dashboard
        if(window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
            window.location.href = 'dashboard.html';
        }
    }
});

// Forgot Password Functionality
const forgotPasswordBtn = document.getElementById('forgot-password-btn');
const backToLoginBtn = document.getElementById('back-to-login-btn');
const forgotPasswordForm = document.getElementById('forgot-password-form');
const forgotEmailInput = document.getElementById('forgot-email');
const forgotError = document.getElementById('forgot-error');
const forgotSuccess = document.getElementById('forgot-success');
const sendResetBtn = document.getElementById('send-reset-btn');

const showForgotError = (message = '') => {
    if (!forgotError) return;
    forgotError.textContent = message;
    forgotError.hidden = !message;
    if (forgotSuccess) forgotSuccess.hidden = true;
};

const showForgotSuccess = (message = '') => {
    if (!forgotSuccess) return;
    forgotSuccess.textContent = message;
    forgotSuccess.hidden = !message;
    if (forgotError) forgotError.hidden = true;
};

const setForgotLoadingState = (isLoading) => {
    if (!sendResetBtn) return;
    sendResetBtn.disabled = isLoading;
    sendResetBtn.classList.toggle('is-loading', isLoading);
    sendResetBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
};

// Show forgot password form
if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', () => {
        if (loginForm) loginForm.style.display = 'none';
        if (forgotPasswordForm) forgotPasswordForm.style.display = 'block';
        if (forgotEmailInput) {
            forgotEmailInput.value = emailInput?.value || '';
            forgotEmailInput.focus();
        }
        showForgotError('');
        showForgotSuccess('');
    });
}

// Back to login form
if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', () => {
        if (forgotPasswordForm) forgotPasswordForm.style.display = 'none';
        if (loginForm) loginForm.style.display = 'block';
        if (emailInput) emailInput.focus();
        showForgotError('');
        showForgotSuccess('');
    });
}

// Handle forgot password submission
if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const email = forgotEmailInput?.value?.trim();

        if (!email) {
            showForgotError('Please enter your email address.');
            forgotEmailInput?.focus();
            return;
        }

        showForgotError('');
        showForgotSuccess('');
        setForgotLoadingState(true);

        auth.sendPasswordResetEmail(email)
            .then(() => {
                showForgotSuccess('Password reset email sent! Please check your inbox and spam folder. The email will come from CatalystTracker@catalystmonday.firebaseapp.com');
                if (forgotEmailInput) forgotEmailInput.value = '';
            })
            .catch((error) => {
                console.error('Password reset error:', error);
                let errorMessage = 'Unable to send reset email. Please try again.';

                if (error.code === 'auth/user-not-found') {
                    errorMessage = 'No account found with this email address.';
                } else if (error.code === 'auth/invalid-email') {
                    errorMessage = 'Please enter a valid email address.';
                } else if (error.code === 'auth/too-many-requests') {
                    errorMessage = 'Too many requests. Please wait a moment and try again.';
                }

                showForgotError(errorMessage);
            })
            .finally(() => {
                setForgotLoadingState(false);
            });
    });
}

// Clear error messages when typing in forgot password form
if (forgotEmailInput) {
    forgotEmailInput.addEventListener('input', () => {
        showForgotError('');
    });
}
