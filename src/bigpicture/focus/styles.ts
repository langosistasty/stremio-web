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

/* Room around a control scrolled into view, so its ring and a row's heading stay visible. */
html[data-bigpicture] :is(a[href], button, input, select, textarea, [tabindex]) {
    scroll-margin: 4rem 3rem;
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
