// Stremio Big Picture: the TV look, "house lights down". The screen behaves like a
// cinema: artwork is the light source, the interface is the dimmed room around it, and
// one warm accent (projector light) marks where you are. Scoped to html[data-bigpicture],
// so Stremio outside Big Picture keeps its own look. Upstream draws its colours from CSS
// variables, so most of the theme is those variables, set to the tokens below.
// Fonts are bundled (SIL Open Font License, see fonts/), so a TV needs no network for them.
// SPDX-License-Identifier: GPL-2.0-only

import displayLatin from './fonts/big-shoulders-display-latin-wght-normal.woff2';
import displayLatinExt from './fonts/big-shoulders-display-latin-ext-wght-normal.woff2';
import textLatin from './fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2';
import textLatinExt from './fonts/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2';

const ID = 'bigpicture-theme';

// Fontsource's subsets, so a title with ő or ű loads the extended file only when needed.
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const face = (family: string, url: string, range: string) => `
@font-face {
    font-family: '${family}';
    src: url('${url}') format('woff2');
    font-weight: 100 900;
    font-display: swap;
    unicode-range: ${range};
}`;

const CSS = `
${face('BP Display', displayLatin, LATIN)}
${face('BP Display', displayLatinExt, LATIN_EXT)}
${face('BP Text', textLatin, LATIN)}
${face('BP Text', textLatinExt, LATIN_EXT)}

html[data-bigpicture] {
    /* Tokens */
    --bp-auditorium: #0D1220;   /* background: deep blue ink, which blends into film backdrops */
    --bp-balcony: #161D30;      /* raised surfaces: the rail, dialogs, the keyboard */
    --bp-aisle: #2A3350;        /* inactive controls, placeholders, quiet outlines */
    --bp-screen: #F1EEE6;       /* main text: a slightly warm white, like projected light */
    --bp-usher: #A3ABC2;        /* secondary text */
    --bp-projector: #FFB547;    /* the one accent: focus, the current tab, progress */
    --bp-projector-glow: rgba(255, 181, 71, 0.45);
    --bp-font-display: 'BP Display', 'PlusJakartaSans', sans-serif;
    --bp-font-text: 'BP Text', 'PlusJakartaSans', 'Arial', 'TwemojiFlags', sans-serif;
    --bp-ease: cubic-bezier(0.2, 0.8, 0.2, 1);

    /* Upstream's variables, mapped onto the tokens */
    --primary-background-color: var(--bp-auditorium);
    --secondary-background-color: var(--bp-balcony);
    --modal-background-color: var(--bp-balcony);
    --primary-foreground-color: var(--bp-screen);
    --primary-accent-color: var(--bp-projector);
    --overlay-color: rgba(163, 171, 194, 0.08);
    --outer-glow: 0 0 1.5rem var(--bp-projector-glow);
    --color-placeholder-background: var(--bp-aisle);
    /* Upstream's blue marks selected chips (Library's sort order); in the TV look the
       selection is quiet and only focus gets the accent. */
    --quaternary-accent-color: var(--bp-aisle);

    font-family: var(--bp-font-text);
}

/* Upstream sets font-family: inherit on controls, so the text face reaches them already;
   headings of rows and screens take the display face. */
html[data-bigpicture] :is([class*="meta-row-container-"] [class*="title-container-"], [class*="section-title-"], [class*="menu-title-"]) {
    font-family: var(--bp-font-display);
    font-weight: 700;
    font-size: 2.2rem;
    letter-spacing: 0.01em;
}

/* Focus: amber projector light, an outer ring with a soft glow. */
html[data-bigpicture] :focus {
    outline: 0.3rem solid var(--bp-projector) !important;
    outline-offset: 0.2rem !important;
    box-shadow: 0 0 1.75rem 0.25rem var(--bp-projector-glow) !important;
}

/* Posters: the ring goes on the artwork, not around artwork and title; the focused one
   grows a little, and only it shows its name. */
html[data-bigpicture] [class*="meta-item-link-"]:focus {
    outline: none !important;
    box-shadow: none !important;
}
html[data-bigpicture] [class*="meta-item-container-"] [class*="poster-container-"] {
    transition: transform 160ms var(--bp-ease), box-shadow 160ms var(--bp-ease);
}
html[data-bigpicture] [class*="meta-item-container-"]:focus-within [class*="poster-container-"] {
    transform: scale(1.06);
    box-shadow: 0 0 0 0.3rem var(--bp-projector), 0 0 2rem 0.4rem var(--bp-projector-glow) !important;
}
html[data-bigpicture] [class*="meta-item-container-"]:focus-within [class*="poster-image-layer-"] {
    transform: none;
}
html[data-bigpicture] [class*="meta-item-container-"] [class*="title-label-"] {
    color: var(--bp-screen);
    font-size: 1.25rem;
    opacity: 0;
    transition: opacity 160ms var(--bp-ease);
}
html[data-bigpicture] [class*="meta-item-container-"]:focus-within [class*="title-label-"] {
    opacity: 1;
}
html[data-bigpicture] [class*="progress-bar-"]:not([class*="progress-bar-background-"]):not([class*="progress-bar-layer-"]) {
    background-color: var(--bp-projector);
}

/* Secondary text in the usher grey. */
html[data-bigpicture] :is([class*="see-all-container-"], [class*="description-"], [class*="label-container-"] [class*="label-"]) {
    color: var(--bp-usher);
}

/* The rail: a quiet column of icons on the balcony; the current screen gets an amber
   bar; when focus enters it, the labels show. */
html[data-bigpicture] [class*="vertical-nav-bar-container-"] {
    background-color: transparent;
    gap: 1.25rem;
}
html[data-bigpicture] [class*="nav-tab-button-container-"] {
    position: relative;
    border-radius: 0.9rem;
}
html[data-bigpicture] [class*="nav-tab-button-container-"] [class*="icon-"] {
    color: var(--bp-usher);
    opacity: 0.7;
}
html[data-bigpicture] [class*="nav-tab-button-container-"].selected [class*="icon-"] {
    color: var(--bp-projector);
    opacity: 1;
}
html[data-bigpicture] [class*="nav-tab-button-container-"].selected::before {
    content: '';
    position: absolute;
    left: -0.6rem;
    top: 25%;
    bottom: 25%;
    width: 0.3rem;
    border-radius: 0.3rem;
    background-color: var(--bp-projector);
}
html[data-bigpicture] [class*="vertical-nav-bar-container-"]:focus-within [class*="nav-tab-button-container-"] [class*="label-"] {
    opacity: 1;
    color: var(--bp-screen);
    font-size: 0.85rem;
}

/* Details: the stream's play button and "Install addons" take the accent, with dark
   icons and text on it (white on amber can't be read from a couch). Elsewhere upstream's
   green stays: it carries white text in many places. */
html[data-bigpicture] [class*="stream-container-"] [class*="icon-"] {
    background-color: var(--bp-projector);
    color: var(--bp-auditorium);
}
html[data-bigpicture] [class*="streams-list-container-"] [class*="install-button-container-"] {
    background-color: var(--bp-projector);
}
html[data-bigpicture] [class*="streams-list-container-"] [class*="install-button-container-"] :is([class*="icon-"], [class*="label-"]) {
    color: var(--bp-auditorium);
}

/* Details: section labels (Genres, Cast...) in sentence case and the usher grey, not
   faded all-caps. */
html[data-bigpicture] :is([class*="meta-links-container-"], [class*="description-container-"]) > [class*="label-container-"] {
    text-transform: none;
    opacity: 1;
    color: var(--bp-usher);
    font-size: 1.1rem;
    font-weight: 600;
}

/* Calendar: today's number sits on the accent, so it's set in the background colour. */
html[data-bigpicture] [class*="today-"] [class*="day-"] {
    color: var(--bp-auditorium);
    font-weight: 700;
}

/* The on-screen keyboard and the quit question, in the theme's surfaces. */
html[data-bigpicture] :is(#bigpicture-keyboard, #bigpicture-quit) button {
    background-color: var(--bp-aisle);
    color: var(--bp-screen);
}
/* Action keys keep the letter keys' grid (Up from Shift lands on z); less padding fits
   their labels. */
html[data-bigpicture] #bigpicture-keyboard [data-action] {
    padding: 0 0.4rem;
    white-space: nowrap;
}
html[data-bigpicture] #bigpicture-quit .bigpicture-quit-title {
    font-family: var(--bp-font-display);
    font-weight: 700;
    font-size: 3rem;
}

/* Search in the rail, second after Board (screens/RailSearch.tsx). */
html[data-bigpicture] [class*="vertical-nav-bar-container-"] > * { order: 2; }
html[data-bigpicture] [class*="vertical-nav-bar-container-"] > :first-child { order: 0; }
html[data-bigpicture] [data-bigpicture-rail-search] { display: contents; }
html[data-bigpicture] [data-bigpicture-rail-search] > * { order: 1; }

/* Board's hero (screens/BoardHero.tsx): the focused title's backdrop over the top of the
   screen, fading into the room on the left and below, with its text on the dark side.
   The top bar gives way to it; the rows scroll in the space under it. */
html[data-bigpicture] {
    --bp-hero-height: 52%;
}
html[data-bigpicture][data-bigpicture-hero] [class*="board-content-container-"] > [class*="horizontal-nav-bar-"] {
    display: none;
}
html[data-bigpicture][data-bigpicture-hero] [class*="board-content-container-"] > [class*="vertical-nav-bar-"] {
    top: 0;
    z-index: 2;
}
html[data-bigpicture][data-bigpicture-hero] [class*="board-content-container-"] > [class*="nav-content-container-"] {
    top: var(--bp-hero-height);
}
/* Under the hero, which names the focused title, the rows show posters only, so a whole
   row fits in the space below it. */
html[data-bigpicture][data-bigpicture-hero] [class*="board-content-container-"] [class*="title-bar-container-"] {
    display: none;
}
html[data-bigpicture] .bigpicture-hero {
    pointer-events: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--bp-hero-height);
    z-index: 1;
    overflow: hidden;
    background-color: var(--bp-auditorium);
}
html[data-bigpicture] .bigpicture-hero-art {
    position: absolute;
    top: 0;
    right: 0;
    width: 72%;
    height: 100%;
    background-size: cover;
    background-position: center 25%;
    -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 45%), linear-gradient(to top, transparent 0%, #000 35%);
    -webkit-mask-composite: source-in;
    mask-image: linear-gradient(to right, transparent 0%, #000 45%), linear-gradient(to top, transparent 0%, #000 35%);
    mask-composite: intersect;
    animation: bp-fade 300ms var(--bp-ease);
}
html[data-bigpicture] .bigpicture-hero-text {
    position: absolute;
    left: calc(var(--vertical-nav-bar-size) + 2rem);
    bottom: 1.5rem;
    width: 46%;
    animation: bp-fade 300ms var(--bp-ease);
}
html[data-bigpicture] .bigpicture-hero-title {
    font-family: var(--bp-font-display);
    font-weight: 800;
    font-size: 5.5rem;
    line-height: 0.95;
    letter-spacing: 0.005em;
    color: var(--bp-screen);
    text-wrap: balance;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
html[data-bigpicture] .bigpicture-hero-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.5rem;
    margin-top: 1rem;
    font-size: 1.3rem;
    color: var(--bp-usher);
}
html[data-bigpicture] .bigpicture-hero-description {
    margin-top: 0.75rem;
    max-width: 38rem;
    font-size: 1.3rem;
    line-height: 1.45;
    color: var(--bp-screen);
    opacity: 0.85;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
@keyframes bp-fade {
    from { opacity: 0; }
    to { opacity: 1; }
}

/* The top bar's search field, quieter. */
html[data-bigpicture] [class*="search-bar-container-"] {
    background-color: var(--bp-balcony);
}

@media (prefers-reduced-motion: reduce) {
    html[data-bigpicture] [class*="meta-item-container-"] [class*="poster-container-"],
    html[data-bigpicture] [class*="meta-item-container-"] [class*="title-label-"] {
        transition: none;
    }
    html[data-bigpicture] :is(.bigpicture-hero-art, .bigpicture-hero-text) {
        animation: none;
    }
}
`;

const installTheme = () => {
    if (document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.id = ID;
    style.textContent = CSS;
    document.head.appendChild(style);
};

export default installTheme;
