import type { MetadataRoute } from 'next';

/**
 * Makes ConverMesh installable ("Add to Home Screen" on phones, "Install" in
 * desktop Chrome and Edge) so agents can keep the inbox one tap away.
 * It does not add offline mode: the inbox needs a live connection to WhatsApp.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ConverMesh WhatsApp CRM',
    short_name: 'ConverMesh',
    description: 'Shared WhatsApp inbox, pipelines and automations for your team.',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#091c2c',
    theme_color: '#0e314f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Inbox', url: '/inbox' },
      { name: 'Analytics', url: '/analytics' },
    ],
  };
}
