// Stremio Big Picture: global styles for the TV layout. Injected as a stylesheet scoped to
// html[data-bigpicture], because upstream's .less files are CSS modules with hashed names.
// SPDX-License-Identifier: GPL-2.0-only

const ID = 'bigpicture-styles';

const CSS = `
/* Focus ring, drawn outside the element: an inset ring is painted over by poster images.
   A white line with a violet glow stays visible at 3 m on light and dark artwork. */
html[data-bigpicture] :focus {
    outline: 0.3rem solid #ffffff !important;
    outline-offset: 0.2rem !important;
    box-shadow: 0 0 1.5rem 0.6rem rgba(123, 91, 245, 0.8) !important;
}

/* Text fields sit in tight form layouts that clip an outer ring: draw theirs inside. */
html[data-bigpicture] :is(input, textarea):focus {
    outline-offset: -0.3rem !important;
}

/* Room around a control scrolled into view, so its ring and a row's heading stay visible. */
html[data-bigpicture] :is(a[href], button, input, select, textarea, [tabindex]) {
    scroll-margin: 4rem 3rem;
}

/* Quit dialog: a centred panel over a dimmed screen. */
#bigpicture-quit {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
}
#bigpicture-quit .bigpicture-quit-panel {
    padding: 2.5rem 3rem;
    border-radius: 1.5rem;
    background: var(--modal-background-color, #0f0d20);
    box-shadow: 0 0 3rem rgba(0, 0, 0, 0.8);
    text-align: center;
    overflow: visible;
}
#bigpicture-quit .bigpicture-quit-title {
    margin-bottom: 2rem;
    font-size: 2rem;
    color: var(--primary-foreground-color, #fff);
}
#bigpicture-quit .bigpicture-quit-actions {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    overflow: visible;
}
#bigpicture-quit button {
    min-width: 10rem;
    height: 3.5rem;
    padding: 0 2rem;
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.12);
    font-size: 1.4rem;
    color: var(--primary-foreground-color, #fff);
}

/* On-screen keyboard: a panel along the bottom, above everything. */
#bigpicture-keyboard {
    position: fixed;
    left: 50%;
    bottom: 2rem;
    z-index: 1000;
    transform: translateX(-50%);
    padding: 1.5rem;
    border-radius: 1.5rem;
    background: var(--modal-background-color, #0f0d20);
    box-shadow: 0 0 3rem rgba(0, 0, 0, 0.8);
    overflow: visible;
}
#bigpicture-keyboard .bigpicture-keyboard-preview {
    min-height: 3rem;
    margin-bottom: 1rem;
    padding: 0.5rem 1rem;
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.08);
    font-size: 1.6rem;
    white-space: pre;
}
#bigpicture-keyboard .bigpicture-keyboard-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    overflow: visible;
}
#bigpicture-keyboard button {
    flex: 1 0 3.5rem;
    height: 3.5rem;
    padding: 0 1rem;
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.12);
    font-size: 1.4rem;
    color: inherit;
    white-space: nowrap;
}

/* TV safe margin (overscan), as a share of the screen, set by BigPicture.tsx.
   The viewport variables are upstream's, already divided by the interface scale. */
html[data-bigpicture] body {
    padding:
        calc(var(--dynamic-viewport-height) * var(--bigpicture-overscan, 0) / 100)
        calc(var(--dynamic-viewport-width) * var(--bigpicture-overscan, 0) / 100);
}
`;

const installStyles = () => {
    if (document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.id = ID;
    style.textContent = CSS;
    document.head.appendChild(style);
};

export default installStyles;
