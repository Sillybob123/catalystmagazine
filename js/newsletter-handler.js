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

function wire(form, responseDiv) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submit = form.querySelector('button[type="submit"]');
    const originalText = submit ? submit.innerHTML : '';

    const data = new FormData(form);
    const email = String(data.get('EMAIL') || data.get('email') || '').trim();
    const firstName = String(data.get('FNAME') || data.get('firstName') || '').trim();
    const lastName = String(data.get('LNAME') || data.get('lastName') || '').trim();

    if (!email || !firstName) {
      showResponse(responseDiv, 'Please fill in all fields.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showResponse(responseDiv, 'Please enter a valid email address.', 'error');
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.innerHTML = 'Subscribing…';
    }

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, lastName }),
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
          "You're already on the list — thanks for being here!",
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
