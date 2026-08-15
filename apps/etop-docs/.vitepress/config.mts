import { defineConfig } from 'vitepress';

// See the note in apps/libsysmon-docs: `base` assumes this site owns its domain.
export default defineConfig({
    title: 'etop',
    description: 'A full-screen terminal dashboard for CPU, memory, disk, network, processes and containers',
    base: '/',
    lang: 'en-US',
    cleanUrls: true,

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/guide/getting-started' },
            { text: 'Keys', link: '/guide/keys' },
            { text: 'Options', link: '/guide/options' },
            { text: 'Changelog', link: '/changelog' },
            // TODO: swap for the libsysmon site's own domain once it has one
            { text: 'libsysmon ↗', link: 'https://github.com/ngmaibulat/cpumon/tree/main/packages/libsysmon' },
        ],

        sidebar: [
            {
                text: 'Guide',
                items: [
                    { text: 'Getting started', link: '/guide/getting-started' },
                    { text: 'Options', link: '/guide/options' },
                    { text: 'Keys', link: '/guide/keys' },
                    { text: 'Screens', link: '/guide/screens' },
                    { text: 'Using the dashboard', link: '/guide/panels' },
                    { text: 'Terminals and platforms', link: '/guide/terminals' },
                ],
            },
            {
                text: 'Reference',
                items: [
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
            pattern: 'https://github.com/ngmaibulat/cpumon/edit/main/apps/etop-docs/:path',
            text: 'Edit this page on GitHub',
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © Aibulat',
        },
    },
});
