// Stremio Big Picture: webpack's asset/resource rule turns a font import into its URL.
// SPDX-License-Identifier: GPL-2.0-only

declare module '*.woff2' {
    const url: string;
    export default url;
}
