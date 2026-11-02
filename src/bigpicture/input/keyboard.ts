// Stremio Big Picture: an on-screen keyboard for text fields, for remotes and gamepads.
// Enter (or A) on a text field opens it, unless that field was typed into with a real
// keyboard since it was focused, in which case Enter keeps its usual meaning. The keys are
// plain buttons in a layer, so the focus engine's arrows and Back work on it unchanged.
// SPDX-License-Identifier: GPL-2.0-only

const ID = 'bigpicture-keyboard';
const ROWS = [
    '1234567890'.split(''),
    'qwertyuiop'.split(''),
    'asdfghjkl@'.split(''),
    'zxcvbnm.-_'.split(''),
];
const ACTIONS = [
    { action: 'shift', label: '⇧ Shift' },
    { action: 'space', label: 'Space' },
    { action: 'backspace', label: '⌫ Delete' },
    { action: 'clear', label: 'Clear' },
    { action: 'done', label: 'Done' },
];

type Field = HTMLInputElement | HTMLTextAreaElement;

// Fields typed into with a real keyboard since they were focused.
const typedInto = new WeakSet<Field>();
let open: { field: Field, element: HTMLElement, watcher: number } | null = null;

// React-controlled fields only accept a value set through the native setter, followed by
// an input event, as if the person had typed it.
const setValue = (field: Field, value: string) => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const close = (submit: boolean) => {
    if (!open) return;
    const { field, element, watcher } = open;
    open = null;
    window.clearInterval(watcher);
    element.remove();
    if (!field.isConnected) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange?.(field.value.length, field.value.length);
    if (submit) {
        // Counts as typed, so this Enter submits instead of reopening the keyboard.
        typedInto.add(field);
        const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        field.dispatchEvent(new KeyboardEvent('keydown', init));
        field.dispatchEvent(new KeyboardEvent('keyup', init));
    }
};

const render = (element: HTMLElement, field: Field, upper: boolean) => {
    const preview = field.type === 'password' ? '•'.repeat(field.value.length) : field.value;
    element.querySelector('[data-preview]')!.textContent = preview || field.placeholder || ' ';
    element.querySelectorAll<HTMLButtonElement>('[data-char]').forEach((key) => {
        key.textContent = upper ? key.dataset.char!.toUpperCase() : key.dataset.char!;
    });
};

const openKeyboard = (field: Field) => {
    close(false);
    let upper = false;
    const element = document.createElement('div');
    element.id = ID;
    // Marks it as a layer for the focus engine: arrows stay inside, Back closes it.
    element.setAttribute('data-bigpicture-layer', '');
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', 'On-screen keyboard');
    element.innerHTML = '<div class="bigpicture-keyboard-preview" data-preview></div>';
    ROWS.forEach((row) => {
        const line = document.createElement('div');
        line.className = 'bigpicture-keyboard-row';
        row.forEach((char) => {
            const key = document.createElement('button');
            key.type = 'button';
            key.dataset.char = char;
            line.appendChild(key);
        });
        element.appendChild(line);
    });
    const actions = document.createElement('div');
    actions.className = 'bigpicture-keyboard-row';
    ACTIONS.forEach(({ action, label }) => {
        const key = document.createElement('button');
        key.type = 'button';
        key.dataset.action = action;
        key.textContent = label;
        actions.appendChild(key);
    });
    element.appendChild(actions);

    element.addEventListener('click', (event) => {
        const key = (event.target as HTMLElement).closest('button');
        if (!key || !open) return;
        const { char, action } = key.dataset;
        if (char) setValue(field, field.value + (upper ? char.toUpperCase() : char));
        if (action === 'space') setValue(field, `${field.value} `);
        if (action === 'backspace') setValue(field, field.value.slice(0, -1));
        if (action === 'clear') setValue(field, '');
        if (action === 'shift') upper = !upper;
        if (action === 'done') {
            // In the top bar's search field, Done also searches.
            close(field.closest('nav') !== null || field.type === 'search');
            return;
        }
        render(element, field, upper);
    });
    // The focus engine closes layers by sending them Escape.
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close(false);
        }
    });

    document.body.appendChild(element);
    render(element, field, upper);
    // Close with the field: navigating away removes it.
    const watcher = window.setInterval(() => {
        if (!field.isConnected || field.getClientRects().length === 0) close(false);
    }, 500);
    open = { field, element, watcher };
    element.querySelector<HTMLButtonElement>('[data-char="q"]')?.focus();
};

// Whether Enter on this field should open the keyboard.
const wantsKeyboard = (field: Field) => !typedInto.has(field) && !field.readOnly && !field.disabled;

const startKeyboardTracking = () => {
    const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target;
        // A real printable key typed into a field: Enter there keeps its usual meaning.
        if (event.isTrusted && event.key.length === 1 && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
            typedInto.add(target);
        }
    };
    const onFocusIn = (event: FocusEvent) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) typedInto.delete(target);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('focusin', onFocusIn, true);
        close(false);
    };
};

export { openKeyboard, startKeyboardTracking, wantsKeyboard };
