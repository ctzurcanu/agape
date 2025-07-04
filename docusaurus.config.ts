import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'The Agape Project',
  tagline: 'Poetry and music for the soul.',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://ctzurcanu.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/agape/',
  trailingSlash: true,

  // GitHub pages deployment config.
  organizationName: 'ctzurcanu',
  projectName: 'agape',
  
  

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          path: 'docs',
          routeBasePath: '/',
        },
        blog: { // Re-adding blog configuration
          showReadingTime: true,
          authorsMapPath: 'authors.yml',
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl:
            'https://github.com/ctzurcanu/agape/tree/main/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'ignore',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  

  themeConfig: {
    // Replace with your project's social card
    image: 'img/agape_card.png',
    navbar: {
      title: 'The Agape Project',
      logo: {
        alt: 'The Agape Project Logo',
        src: 'img/agape.svg',
      },
      items: [
        {
          to: '/agape/',
          position: 'left',
          label: 'Content',
        },
        {to: '/agape/blog', label: 'Blog', position: 'left'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Content',
          items: [
            {
              label: 'YouTube Content',
              to: '/agape/',
            },
            
            {
              label: 'Blog',
              to: '/agape/blog',
            },
          ],
        },
        
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/ctzurcanu/agape',
            },
          ],
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
