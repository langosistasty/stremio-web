// Stremio Big Picture: the focus ring. Injected as a global stylesheet, scoped to
// html[data-bigpicture], because upstream's .less files are CSS modules with hashed names.
// SPDX-License-Identifier: GPL-2.0-only

const ID = 'bigpicture-focus-styles';

// Drawn outside the element: an inset ring is painted over by poster images. A white
// line with a violet glow stays visible at 3 m on light and dark artwork.
const CSS = `
html[data-bigpicture] :focus {
    outline: 0.3rem solid #ffffff !important;
    outline-offset: 0.2rem !important;
    box-shadow: 0 0 1.5rem 0.6rem rgba(123, 91, 245, 0.8) !important;
}
html[data-bigpicture] :is(a[href], button, input, select, textarea, [tabindex]) {
    scroll-margin: 3rem;
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
