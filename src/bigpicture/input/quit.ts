// Stremio Big Picture: quit from the couch. Back on Board, where it has nowhere left to
// go, asks "Quit Stremio?" as TV apps do. Quit (A / Enter) closes the app through the
// shell; Cancel or Back again keeps it open, so pressing Back twice never quits by
// accident. Like the on-screen keyboard, it's a plain layer outside React, so the
// focus engine's arrows and Back work on it unchanged.
// SPDX-License-Identifier: GPL-2.0-only

const ID = 'bigpicture-quit';

const closeQuitDialog = () => {
    const element = document.getElementById(ID);
    if (!element) return;
    const returnTo = (element as HTMLElement & { returnTo?: Element | null }).returnTo;
    element.remove();
    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
};

const openQuitDialog = (quit: () => void) => {
    if (document.getElementById(ID)) return;
    const element = document.createElement('div') as HTMLDivElement & { returnTo?: Element | null };
    element.id = ID;
    element.returnTo = document.activeElement;
    // Marks it as a layer for the focus engine: arrows stay inside, Back closes it.
    element.setAttribute('data-bigpicture-layer', '');
    element.setAttribute('role', 'alertdialog');
    element.setAttribute('aria-labelledby', `${ID}-title`);
    element.innerHTML = `
        <div class="bigpicture-quit-panel">
            <div class="bigpicture-quit-title" id="${ID}-title">Quit Stremio?</div>
            <div class="bigpicture-quit-actions">
                <button type="button" data-action="quit">Quit</button>
                <button type="button" data-action="cancel">Cancel</button>
            </div>
        </div>`;
    element.addEventListener('click', (event) => {
        const action = (event.target as HTMLElement).closest('button')?.dataset.action;
        if (action === 'cancel') closeQuitDialog();
        if (action === 'quit') {
            closeQuitDialog();
            quit();
        }
    });
    // The focus engine closes layers by sending them Escape.
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeQuitDialog();
        }
    });
    document.body.appendChild(element);
    element.querySelector<HTMLButtonElement>('[data-action="quit"]')?.focus();
};

export { closeQuitDialog, openQuitDialog };
