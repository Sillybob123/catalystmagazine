// =====================================================================
// Editorial Studio — Apple-inspired Quill editor with slash menu.
// Preserves the exact Firestore save schema used by the prior studio:
//   stories doc: { title, deck, category, tags[], content (HTML),
//                  coverImage, authorId, authorName, status,
//                  createdAt, updatedAt }
// Cover image path: covers/cover-{timestamp}-{name}
// Inline image path: covers/inline-{timestamp}-{name}
// =====================================================================

import { auth, db, storage } from './firebase-config.js';
import {
    onAuthStateChanged,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// ---------------------------------------------------------------------
// Register a divider blot so we can insert <hr> blocks.
// ---------------------------------------------------------------------
const BlockEmbed = Quill.import('blots/block/embed');
class DividerBlot extends BlockEmbed {}
DividerBlot.blotName = 'divider';
DividerBlot.tagName = 'hr';
Quill.register(DividerBlot, true);

// ---------------------------------------------------------------------
// Initialise Quill in snow mode with a persistent toolbar (Wix-style).
// Custom buttons (divider + image) are wired up below.
// ---------------------------------------------------------------------
const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Tell your story… press / for blocks, or use the toolbar above.',
    modules: {
        toolbar: {
            container: '#studio-toolbar',
            handlers: {
                // 'image' handler intercepted so we upload to Firebase Storage
                image: () => openInlineImagePicker(getCaretIndex())
            }
        },
        clipboard: { matchVisual: false },
        keyboard: {
            bindings: {
                // Let Enter on blockquote/heading return to paragraph
                'header exit': {
                    key: 'Enter',
                    collapsed: true,
                    format: ['blockquote'],
                    empty: true,
                    handler(range, context) {
                        this.quill.format('blockquote', false, 'user');
                    }
                }
            }
        }
    }
});

function getCaretIndex() {
    const r = quill.getSelection(true);
    return r ? r.index : quill.getLength();
}

// Wire up the custom toolbar buttons (divider + image).
document.getElementById('btn-divider').addEventListener('click', (e) => {
    e.preventDefault();
    const idx = getCaretIndex();
    quill.insertText(idx, '\n', 'user');
    quill.insertEmbed(idx + 1, 'divider', true, 'user');
    quill.insertText(idx + 2, '\n', 'user');
    quill.setSelection(idx + 3, 'silent');
});

document.getElementById('btn-image').addEventListener('click', (e) => {
    e.preventDefault();
    openInlineImagePicker(getCaretIndex());
});

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const titleInput        = $('#story-title');
const deckInput         = $('#story-deck');
const categorySelect    = $('#story-category');
const tagEntry          = $('#tags-entry');
const tagWrap           = $('#tag-input-wrap');
const wordCountEl       = $('#word-count');
const readTimeEl        = $('#read-time');
const bylineName        = $('#byline-name');
const bylineRole        = $('#byline-role');
const breadcrumbLabel   = $('#breadcrumb-label');
const autosaveEl        = $('#autosave-indicator');

const coverUploader     = $('#cover-uploader');
const coverPlaceholder  = $('#cover-placeholder');
const coverInput        = $('#cover-input');
const coverChangeBtn    = $('#cover-change-btn');
const coverRemoveBtn    = $('#cover-remove-btn');

const saveDraftBtn      = $('#save-draft-btn');
const submitBtn         = $('#submit-btn');

const slashMenu         = $('#slash-menu');
const slashItems        = () => Array.from(slashMenu.querySelectorAll('.slash-item'));

const toast             = $('#toast');

const publishBackdrop   = $('#publish-backdrop');
const publishModal      = $('#publish-modal');
const publishConfirmBtn = $('#publish-confirm');

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let currentUser = null;
let currentRole = null;
let currentAuthorName = '';
let editingStoryId = null;
let existingCoverUrl = null;
let coverFile = null;
let tags = [];
let autosaveTimer = null;

// ---------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        location.href = 'writer-login.html';
        return;
    }
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
            await signOut(auth);
            location.href = 'writer-login.html';
            return;
        }
        const data = userDoc.data();
        const allowed = ['writer', 'editor', 'admin'];
        if (!allowed.includes(data.role) || data.status === 'pending' || data.status === 'disabled') {
            await signOut(auth);
            location.href = 'writer-login.html';
            return;
        }

        currentUser = user;
        currentRole = data.role;
        currentAuthorName = data.name || user.displayName || user.email;

        if (bylineName) bylineName.value = currentAuthorName;
        if (bylineRole) bylineRole.value = data.role.toUpperCase();

        // If editing an existing story, load it.
        const urlParams = new URLSearchParams(location.search);
        editingStoryId = urlParams.get('edit');
        if (editingStoryId) {
            await loadStoryForEditing(editingStoryId);
        }
    } catch (err) {
        console.error('[studio] auth check failed', err);
        showToast('Could not verify your account.', 'error');
    }
});

// ---------------------------------------------------------------------
// Cover image (click, drag-drop, remove)
// ---------------------------------------------------------------------
function paintCover(url) {
    coverUploader.classList.add('has-image');
    coverUploader.style.backgroundImage = `url('${url}')`;
}
function clearCover() {
    coverUploader.classList.remove('has-image');
    coverUploader.style.backgroundImage = '';
    coverInput.value = '';
    coverFile = null;
    existingCoverUrl = null;
}

coverPlaceholder.addEventListener('click', () => coverInput.click());
coverChangeBtn.addEventListener('click', (e) => { e.stopPropagation(); coverInput.click(); });
coverRemoveBtn.addEventListener('click', (e) => { e.stopPropagation(); clearCover(); });

coverInput.addEventListener('change', (e) => handleCoverFile(e.target.files[0]));

['dragenter', 'dragover'].forEach(evt =>
    coverUploader.addEventListener(evt, (e) => { e.preventDefault(); coverUploader.classList.add('is-drag'); })
);
['dragleave', 'drop'].forEach(evt =>
    coverUploader.addEventListener(evt, (e) => { e.preventDefault(); coverUploader.classList.remove('is-drag'); })
);
coverUploader.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleCoverFile(file);
});

function handleCoverFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file.', 'error');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image must be under 5MB.', 'error');
        return;
    }
    coverFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => paintCover(ev.target.result);
    reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------
// Tag chip input
// ---------------------------------------------------------------------
function renderTags() {
    // Remove existing chips, keep the input
    tagWrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tags.forEach((t, idx) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `<span></span><button type="button" aria-label="Remove tag">×</button>`;
        chip.querySelector('span').textContent = t;
        chip.querySelector('button').addEventListener('click', () => {
            tags.splice(idx, 1);
            renderTags();
        });
        tagWrap.insertBefore(chip, tagEntry);
    });
}

function commitTagFromInput() {
    const val = tagEntry.value.trim().replace(/^#/, '');
    if (!val) return;
    if (!tags.includes(val)) {
        tags.push(val);
        renderTags();
    }
    tagEntry.value = '';
}

tagEntry.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitTagFromInput();
    } else if (e.key === 'Backspace' && !tagEntry.value && tags.length) {
        tags.pop();
        renderTags();
    }
});
tagEntry.addEventListener('blur', commitTagFromInput);

// ---------------------------------------------------------------------
// Word count + read time
// ---------------------------------------------------------------------
function updateStats() {
    const text = quill.getText().trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    wordCountEl.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
    readTimeEl.textContent = `${Math.max(1, Math.round(words / 200))} min read`;
}
quill.on('text-change', () => {
    updateStats();
    scheduleLocalAutosave();
});
updateStats();

// ---------------------------------------------------------------------
// Slash menu — opens on typing "/" at start of a blank line.
// ---------------------------------------------------------------------
let slashState = {
    open: false,
    from: -1,      // index in document where "/" was typed
    activeIdx: 0
};

function closeSlashMenu() {
    slashState.open = false;
    slashMenu.classList.remove('is-open');
}

function openSlashMenu(range) {
    slashState.open = true;
    slashState.from = range.index;
    slashState.activeIdx = 0;

    // Position the menu right under the caret.
    const bounds = quill.getBounds(range.index, 0);
    const surface = $('.editor-surface');
    const surfaceRect = surface.getBoundingClientRect();
    const editorRect = quill.root.getBoundingClientRect();
    const top = (editorRect.top - surfaceRect.top) + bounds.bottom + 8;
    const left = (editorRect.left - surfaceRect.left) + bounds.left;

    slashMenu.style.top  = `${top}px`;
    slashMenu.style.left = `${left}px`;
    slashMenu.classList.add('is-open');
    highlightSlash(0);
}

function highlightSlash(idx) {
    const items = slashItems();
    if (!items.length) return;
    items.forEach(i => i.classList.remove('is-active'));
    slashState.activeIdx = ((idx % items.length) + items.length) % items.length;
    items[slashState.activeIdx].classList.add('is-active');
    items[slashState.activeIdx].scrollIntoView({ block: 'nearest' });
}

quill.on('text-change', (delta, oldDelta, source) => {
    if (source !== 'user') return;
    const range = quill.getSelection();
    if (!range) return;

    // Detect a leading "/" at start of a line
    if (!slashState.open) {
        const [line] = quill.getLine(range.index);
        const lineText = line ? line.domNode.textContent : '';
        if (lineText === '/') {
            openSlashMenu(range);
        }
    } else {
        // Close if user deletes the slash
        const textNow = quill.getText(slashState.from - 1, 1);
        if (textNow !== '/') closeSlashMenu();
    }
});

// Keyboard navigation
quill.root.addEventListener('keydown', (e) => {
    if (!slashState.open) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightSlash(slashState.activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightSlash(slashState.activeIdx - 1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const items = slashItems();
        items[slashState.activeIdx].click();
    } else if (e.key === 'Escape') {
        closeSlashMenu();
    }
});

// Handle slash-item clicks
slashItems().forEach((item, idx) => {
    item.addEventListener('mouseenter', () => highlightSlash(idx));
    item.addEventListener('click', () => applySlashBlock(item.dataset.block));
});

function applySlashBlock(block) {
    // Remove the "/" we typed
    const selection = quill.getSelection() || { index: slashState.from + 1, length: 0 };
    const slashIdx = slashState.from;
    quill.deleteText(slashIdx, Math.max(1, selection.index - slashIdx));
    closeSlashMenu();

    const insertAt = slashIdx;

    switch (block) {
        case 'h1':
            quill.formatLine(insertAt, 1, 'header', 1);
            break;
        case 'h2':
            quill.formatLine(insertAt, 1, 'header', 2);
            break;
        case 'h3':
            quill.formatLine(insertAt, 1, 'header', 3);
            break;
        case 'quote':
            quill.formatLine(insertAt, 1, 'blockquote', true);
            break;
        case 'bullet':
            quill.formatLine(insertAt, 1, 'list', 'bullet');
            break;
        case 'ordered':
            quill.formatLine(insertAt, 1, 'list', 'ordered');
            break;
        case 'divider':
            quill.insertEmbed(insertAt, 'divider', true, 'user');
            quill.insertText(insertAt + 1, '\n', 'user');
            quill.setSelection(insertAt + 2, 'silent');
            break;
        case 'image':
            openInlineImagePicker(insertAt);
            break;
    }

    quill.focus();
}

// Click outside to close
document.addEventListener('mousedown', (e) => {
    if (!slashMenu.contains(e.target)) closeSlashMenu();
});

// ---------------------------------------------------------------------
// Inline image insertion (via slash menu)
// ---------------------------------------------------------------------
let inlineImageInput = null;
function openInlineImagePicker(insertAt) {
    if (!inlineImageInput) {
        inlineImageInput = document.createElement('input');
        inlineImageInput.type = 'file';
        inlineImageInput.accept = 'image/*';
        inlineImageInput.style.display = 'none';
        document.body.appendChild(inlineImageInput);
    }
    inlineImageInput.value = '';
    inlineImageInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image must be under 5MB.', 'error');
            return;
        }
        try {
            showToast('Uploading image…');
            const imageRef = ref(storage, 'covers/inline-' + Date.now() + '-' + file.name);
            const snap = await uploadBytes(imageRef, file);
            const url = await getDownloadURL(snap.ref);
            quill.insertEmbed(insertAt, 'image', url, 'user');
            quill.insertText(insertAt + 1, '\n', 'user');
            quill.setSelection(insertAt + 2, 'silent');
            showToast('Image inserted.', 'success');
        } catch (err) {
            console.error('[studio] inline image upload failed', err);
            showToast('Image upload failed.', 'error');
        }
    };
    inlineImageInput.click();
}

// ---------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------
function setAutosaveStatus(state, text) {
    autosaveEl.classList.remove('is-saving', 'is-saved', 'is-error');
    if (state) autosaveEl.classList.add('is-' + state);
    const t = autosaveEl.querySelector('.studio-status__text') || autosaveEl;
    t.textContent = text;
}

function validateStory() {
    const title = titleInput.value.trim();
    const content = quill.root.innerHTML.trim();
    if (!title) { showToast('Add a title first.', 'error'); titleInput.focus(); return null; }
    if (!categorySelect.value) { showToast('Pick a category.', 'error'); categorySelect.focus(); return null; }
    if (!content || content === '<p><br></p>') { showToast('Write your story before saving.', 'error'); return null; }
    if (!coverFile && !existingCoverUrl) { showToast('Upload a cover image.', 'error'); return null; }

    return {
        title,
        deck: deckInput.value.trim() || '',
        category: categorySelect.value,
        tags: [...tags],
        content
    };
}

async function uploadCoverImage() {
    const imageRef = ref(storage, 'covers/cover-' + Date.now() + '-' + coverFile.name);
    const snap = await uploadBytes(imageRef, coverFile);
    return await getDownloadURL(snap.ref);
}

async function saveStory(status) {
    if (!currentUser) { showToast('Still signing you in. Please wait.', 'error'); return; }
    const payload = validateStory();
    if (!payload) return;

    setWorking(true);
    setAutosaveStatus('saving', status === 'draft' ? 'Saving draft…' : 'Submitting…');

    try {
        const coverUrl = coverFile ? await uploadCoverImage() : existingCoverUrl;
        const now = new Date().toISOString();

        const storyData = {
            title: payload.title,
            deck: payload.deck,
            category: payload.category,
            tags: payload.tags,
            content: payload.content,
            coverImage: coverUrl,
            updatedAt: now
        };

        if (editingStoryId) {
            storyData.status = status;
            await updateDoc(doc(db, 'stories', editingStoryId), storyData);
        } else {
            storyData.authorId = currentUser.uid;
            storyData.authorName = currentAuthorName;
            storyData.status = status;
            storyData.createdAt = now;
            const newDocRef = await addDoc(collection(db, 'stories'), storyData);
            editingStoryId = newDocRef.id;
            // Update the URL so reloads continue editing this doc
            const nextUrl = new URL(location.href);
            nextUrl.searchParams.set('edit', editingStoryId);
            history.replaceState({}, '', nextUrl);
        }

        setAutosaveStatus('saved', status === 'draft' ? 'Draft saved' : 'Submitted · awaiting review');
        showToast(status === 'draft' ? 'Draft saved.' : 'Sent for review.', 'success');
    } catch (err) {
        console.error('[studio] save failed', err);
        setAutosaveStatus('error', 'Save failed');
        showToast('Could not save your story. Please try again.', 'error');
    } finally {
        setWorking(false);
    }
}

function setWorking(isWorking) {
    submitBtn.disabled = isWorking;
    saveDraftBtn.disabled = isWorking;
}

saveDraftBtn.addEventListener('click', (e) => { e.preventDefault(); saveStory('draft'); });
submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const payload = validateStory();
    if (!payload) return;
    openModal();
});

publishConfirmBtn.addEventListener('click', async () => {
    closeModal();
    await saveStory('pending');
});

document.querySelectorAll('[data-close-modal]').forEach(btn =>
    btn.addEventListener('click', closeModal)
);
publishBackdrop.addEventListener('click', closeModal);

function openModal() {
    publishBackdrop.classList.add('is-open');
    publishModal.classList.add('is-open');
}
function closeModal() {
    publishBackdrop.classList.remove('is-open');
    publishModal.classList.remove('is-open');
}

// ---------------------------------------------------------------------
// Load story for editing
// ---------------------------------------------------------------------
async function loadStoryForEditing(storyId) {
    try {
        setAutosaveStatus('saving', 'Loading…');
        const snap = await getDoc(doc(db, 'stories', storyId));
        if (!snap.exists()) {
            showToast('Story not found.', 'error');
            return;
        }
        const story = snap.data();
        titleInput.value     = story.title || '';
        deckInput.value      = story.deck || '';
        categorySelect.value = story.category || '';
        tags = Array.isArray(story.tags) ? [...story.tags] : [];
        renderTags();

        quill.root.innerHTML = story.content || '';

        if (story.coverImage) {
            existingCoverUrl = story.coverImage;
            paintCover(story.coverImage);
        }

        breadcrumbLabel.textContent = `Editing · ${story.title}`;
        setAutosaveStatus('saved', 'Loaded');
        updateStats();
    } catch (err) {
        console.error('[studio] load failed', err);
        showToast('Could not load story.', 'error');
    }
}

// ---------------------------------------------------------------------
// Local autosave (browser-only backup, 3s debounce, max 1 MB)
// ---------------------------------------------------------------------
function scheduleLocalAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        try {
            const backup = {
                title: titleInput.value,
                deck: deckInput.value,
                category: categorySelect.value,
                tags,
                content: quill.root.innerHTML,
                at: Date.now()
            };
            const json = JSON.stringify(backup);
            if (json.length < 1_000_000) {
                const key = editingStoryId
                    ? `studio:backup:${editingStoryId}`
                    : 'studio:backup:draft';
                localStorage.setItem(key, json);
                setAutosaveStatus('saved', 'Backed up locally');
            }
        } catch (e) {
            // Ignore quota / disabled storage; server save is the source of truth.
        }
    }, 3000);
}

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------
let toastTimer;
function showToast(message, type) {
    clearTimeout(toastTimer);
    toast.className = 'toast is-open' + (type ? ` toast--${type}` : '');
    toast.textContent = message;
    toastTimer = setTimeout(() => {
        toast.classList.remove('is-open');
    }, type === 'error' ? 4000 : 2400);
}

// Keep title & deck inputs auto-growing
[titleInput, deckInput].forEach(el => {
    el.addEventListener('input', () => {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
        scheduleLocalAutosave();
    });
});
