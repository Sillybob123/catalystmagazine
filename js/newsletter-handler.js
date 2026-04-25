// js/newsletter-handler.js
// Replaces mailchimp-handler.js. Posts the newsletter form to /api/subscribe.

document.addEventListener('DOMContentLoaded', function () {
  const layoutPromise =
    window.layoutReady && typeof window.layoutReady.then === 'function'
      ? window.layoutReady.catch((err) =>
          console.error('[newsletter] layout load issue', err)
        )
      : Promise.resolve();

  layoutPromise.finally(() => {
    initForms();
  });
});

function initForms() {
  document
    .querySelectorAll(
      'form#mc-embedded-subscribe-form, form#mc-embedded-subscribe-form-modal, form[data-newsletter-form]'
    )
    .forEach((form) => {
      if (form.dataset.newsletterBound === '1') return;
      form.dataset.newsletterBound = '1';
      const responseDiv =
        form.querySelector('.newsletter-response') ||
        document.getElementById(
          form.id === 'mc-embedded-subscribe-form-modal'
            ? 'mce-response-modal'
            : 'mce-response'
        );
      wire(form, responseDiv);
    });
}
window.initNewsletterForms = initForms;

function wire(form, responseDiv) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submit = form.querySelector('button[type="submit"]');
    const originalText = submit ? submit.innerHTML : '';

    const data = new FormData(form);
    const email = String(data.get('EMAIL') || data.get('email') || '').trim().toLowerCase();
    const firstName = normalizeName(data.get('FNAME') || data.get('firstName') || '');
    const lastName = normalizeName(data.get('LNAME') || data.get('lastName') || '');

    const firstNameInput = form.querySelector('input[name="FNAME"], input[name="firstName"]');
    const lastNameInput = form.querySelector('input[name="LNAME"], input[name="lastName"]');
    const requiresFirstName = !!firstNameInput?.required;
    const requiresLastName = !!lastNameInput?.required;

    if (!email || (requiresFirstName && !firstName) || (requiresLastName && !lastName)) {
      showResponse(responseDiv, 'Please enter your first name, last name, and email.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showResponse(responseDiv, 'Please enter a valid email address.', 'error');
      return;
    }
    if ((firstName && !isValidName(firstName)) || (lastName && !isValidName(lastName))) {
      showResponse(responseDiv, 'Please enter your name without numbers or symbols.', 'error');
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.innerHTML = 'Subscribing…';
      form.setAttribute('aria-busy', 'true');
    }

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          source: form.id || form.dataset.newsletterForm || 'website-form',
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload.ok) {
        showResponse(
          responseDiv,
          payload.error || 'Something went wrong. Please try again.',
          'error'
        );
      } else if (payload.alreadySubscribed) {
        showResponse(
          responseDiv,
          "You're already on the list. Thanks for being here!",
          'success'
        );
        form.reset();
      } else {
        showResponse(
          responseDiv,
          'Thanks! Check your inbox for a confirmation.',
          'success'
        );
        form.reset();
      }
    } catch (err) {
      console.error('[newsletter] error', err);
      showResponse(
        responseDiv,
        'Network error. Please check your connection.',
        'error'
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.innerHTML = originalText;
        form.removeAttribute('aria-busy');
      }
      setTimeout(() => {
        if (responseDiv) responseDiv.style.display = 'none';
      }, 6000);
    }
  });
}

function showResponse(div, message, type) {
  if (!div) return;
  div.textContent = message;
  div.className = 'newsletter-response ' + type;
  div.style.display = 'block';
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isValidName(value) {
  if (value.length > 80) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$|^[\p{L}\p{M}]$/u.test(value);
}
