// Stremio Big Picture: make controls that upstream keeps out of keyboard reach
// (tabIndex={-1}: the nav rail, Settings switches, addon buttons...) focusable, and
// only while Big Picture is on. Editing each call site would make rebases painful.
// SPDX-License-Identifier: GPL-2.0-only

const MARK = 'data-bigpicture-promoted';
// Upstream's Button always carries a hashed "button-container" class.
const CONTROL = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="menuitem"]', '[role="switch"]', '[role="option"]', '[role="tab"]',
    '[class*="button-container-"]',
].map((selector) => `${selector}[tabindex="-1"]:not([data-focus-guard])`).join(', ');

const promote = (element: Element) => {
    element.setAttribute('tabindex', '0');
    element.setAttribute(MARK, '');
};

const promoteTree = (root: Element | Document) => {
    if (root instanceof Element && root.matches(CONTROL)) promote(root);
    root.querySelectorAll(CONTROL).forEach(promote);
};

const startPromoting = () => {
    promoteTree(document);
    // React may set tabindex back to -1 when it re-renders a control.
    const observer = new MutationObserver((records) => records.forEach((record) => {
        if (record.type === 'attributes') {
            promoteTree(record.target as Element);
        } else {
            record.addedNodes.forEach((node) => node instanceof Element && promoteTree(node));
        }
    }));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex'] });

    return () => {
        observer.disconnect();
        document.querySelectorAll(`[${MARK}]`).forEach((element) => {
            element.setAttribute('tabindex', '-1');
            element.removeAttribute(MARK);
        });
    };
};

export default startPromoting;
