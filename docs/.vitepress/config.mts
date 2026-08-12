import { defineConfig } from 'vitepress';

// `base` assumes the site is served from the root of its own domain. If you
// later publish to GitHub Pages at ngmaibulat.github.io/cpumon, change it to
// '/cpumon/' - every asset and link is resolved against it.
export default defineConfig({
    title: 'cpumon',
    description: 'CPU monitor library and CLI tool for Node.js',
    base: '/',
    lang: 'en-US',
    cleanUrls: true,

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/guide/getting-started' },
            { text: 'CLI', link: '/guide/cli' },
            { text: 'API', link: '/api/' },
            { text: 'Changelog', link: '/changelog' },
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
            pattern: 'https://github.com/ngmaibulat/cpumon/edit/main/docs/:path',
            text: 'Edit this page on GitHub',
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © Aibulat',
        },
    },
});
