import { defineConfig } from 'vitepress';

// `base` assumes this site is served from the root of its own domain, which is
// the arrangement the two sites were split for. If libsysmon and etop ever share
// a host, only the second one needs a prefix - and every asset and link in it
// resolves against that prefix, so it is not a one-line change.
export default defineConfig({
    title: 'libsysmon',
    description: 'System monitor library and cpumon CLI for Node.js',
    base: '/',
    lang: 'en-US',
    cleanUrls: true,

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/guide/getting-started' },
            { text: 'CLI', link: '/guide/cli' },
            { text: 'API', link: '/api/' },
            { text: 'Changelog', link: '/changelog' },
            // TODO: swap for the etop site's own domain once it has one
            { text: 'etop ↗', link: 'https://github.com/ngmaibulat/cpumon/tree/main/packages/etop' },
        ],

        sidebar: [
            {
                text: 'Guide',
                items: [
                    { text: 'Getting started', link: '/guide/getting-started' },
                    { text: 'CLI reference', link: '/guide/cli' },
                    { text: 'Library guide', link: '/guide/library' },
                ],
            },
            {
                text: 'Reference',
                items: [
                    { text: 'API', link: '/api/' },
                    { text: 'Changelog', link: '/changelog' },
                ],
            },
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/ngmaibulat/cpumon' },
        ],

        search: {
            provider: 'local',
        },

        editLink: {
            pattern: 'https://github.com/ngmaibulat/cpumon/edit/main/apps/libsysmon-docs/:path',
            text: 'Edit this page on GitHub',
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © Aibulat',
        },
    },
});
