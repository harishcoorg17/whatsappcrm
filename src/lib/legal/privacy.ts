import { LEGAL } from './company';
import type { LegalDoc } from './types';

/**
 * Privacy policy for ConverMesh CRM. Written from what the product
 * actually does (accounts and workspaces in Supabase, messages through Meta's
 * WhatsApp Business Platform, encrypted WhatsApp credentials). Review it with a
 * lawyer and keep it in step with the product before relying on it.
 */
export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  description: `How ${LEGAL.productFull} collects, uses and protects personal data.`,
  intro: `This Privacy Policy explains how ${LEGAL.operator} ("we", "us") handles personal data in ${LEGAL.productFull} (the "Service") at ${LEGAL.siteUrl}. The Service is a shared inbox, contact manager, pipeline, broadcast and automation tool that businesses use with the WhatsApp Business Platform.`,
  sections: [
    {
      id: 'roles',
      title: 'Who is responsible for what',
      blocks: [
        {
          p: `For the account details of people who sign in to the Service, we decide why and how the data is used, so we act as the controller (in Indian law, the data fiduciary).`,
        },
        {
          p: `For the contacts and WhatsApp conversations a business manages in the Service, the business that owns the workspace decides what is collected and why. We process that data on the business's behalf and on its instructions, as a processor. If you are a customer of a business and want to see, correct or delete your messages, please contact that business first.`,
        },
      ],
    },
    {
      id: 'data-we-collect',
      title: 'Data we collect',
      blocks: [
        { p: 'Depending on how you use the Service, we process:' },
        {
          ul: [
            'Account data: your name, email address, profile picture and sign-in credentials. Passwords are handled by our authentication provider and are not readable by us.',
            'Workspace data: the workspace (tenant) name and plan, team members and roles, tags, notes, pipelines and deals, message templates, broadcasts, flows and automation rules that you create.',
            'WhatsApp connection data: your WhatsApp Business Account ID, phone number IDs, display names and the access tokens needed to send messages for you. Access tokens are encrypted before storage.',
            'Conversation data that a business processes through the Service: your customers’ names, phone numbers, WhatsApp profile names, the messages sent and received (text, images, documents, audio, video, locations, reactions, button and list replies), delivery and read status, and the time of each message.',
            'Integration data: if a workspace connects its own backend, the address of that backend and any customer details it returns, and the API keys issued to it. API keys are stored only as one-way hashes.',
            'Technical data: IP address, browser and device type, and logs of requests and errors, used to keep the Service secure and working.',
          ],
        },
      ],
    },
    {
      id: 'how-we-use',
      title: 'How we use data',
      blocks: [
        {
          ul: [
            'To provide the Service: authenticate users, connect WhatsApp numbers, receive and send messages, run flows, automations and broadcasts, and show analytics to the workspace.',
            'To keep the Service secure: prevent abuse and spam, separate each workspace’s data from the others, investigate incidents and enforce our Terms.',
            'To support you and to communicate about the Service, for example about sign-in, billing or changes.',
            'To meet legal obligations.',
          ],
        },
        {
          p: 'We do not sell personal data, and we do not use conversation content for advertising.',
        },
      ],
    },
    {
      id: 'whatsapp-meta',
      title: 'WhatsApp and Meta',
      blocks: [
        {
          p: 'The Service sends and receives messages through Meta’s official WhatsApp Business Platform. When a workspace connects a number, Meta shares account identifiers, our app receives webhooks for incoming messages and message status, and messages are delivered through Meta’s servers. Meta processes that data under its own terms and privacy policies, which apply in addition to this policy.',
        },
        {
          links: [
            {
              label: 'WhatsApp Privacy Policy',
              href: 'https://www.whatsapp.com/legal/privacy-policy',
            },
            {
              label: 'WhatsApp Business Policy',
              href: 'https://www.whatsapp.com/legal/business-policy',
            },
            {
              label: 'Meta Privacy Policy',
              href: 'https://www.facebook.com/privacy/policy',
            },
          ],
        },
        {
          p: 'When a number is connected using WhatsApp Business app coexistence, messages sent from the phone’s WhatsApp Business app can also appear in the Service, and the other way round.',
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Who we share data with',
      blocks: [
        { p: 'We share data only as needed to run the Service:' },
        {
          ul: [
            'Meta Platforms, to send and receive WhatsApp messages and to connect numbers.',
            'Our infrastructure providers, which host the database, authentication, file storage and the application. Their staff can access data only to provide those services.',
            'Email delivery: if a workspace configures its own email (SMTP) settings, notification emails are sent through that provider.',
            'Authorities or advisers, when the law requires it or to protect rights, safety and the security of the Service.',
            'A successor, if the business is sold or reorganised, who must continue to protect the data as described here.',
          ],
        },
        {
          p: 'Members of the same workspace can see that workspace’s conversations according to their role. We do not show one workspace’s data to another.',
        },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [
        {
          ul: [
            'Data is sent over encrypted connections (HTTPS).',
            'WhatsApp access tokens are encrypted at rest with AES-256-GCM. API keys are stored as hashes and cannot be read back.',
            'Database access rules separate workspaces from each other, and administration functions are limited to authorised staff.',
          ],
        },
        {
          p: 'No system is completely secure. If you believe your account or data has been affected, contact us straight away.',
        },
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep data',
      blocks: [
        {
          p: 'We keep workspace and conversation data while the workspace is active, so the business can keep its history. When a workspace is deleted, its contacts, conversations, messages and related records are deleted with it. Copies in backups and logs are removed on their normal cycle. We may keep limited records longer where the law requires it or to resolve disputes.',
        },
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      blocks: [
        {
          p: 'You can ask to access, correct, export or delete your personal data, to withdraw consent where we rely on it, and to complain about how it is handled. Where the law gives you more rights, such as under India’s Digital Personal Data Protection Act, 2023 or similar laws elsewhere, we will honour them.',
        },
        {
          p: 'If your data sits in a business’s workspace (for example your WhatsApp messages with that business), the business is responsible for the request and we will help it respond. You can also contact us using the details below.',
        },
      ],
    },
    {
      id: 'data-deletion',
      title: 'How to delete your data',
      blocks: [
        {
          p: 'To have your account or personal data deleted, send us a request from the email address on the account (or from the business that holds the data) using the contact details below, with the subject "Data deletion request". Tell us which workspace and, for WhatsApp data, which phone number is involved so we can find it.',
        },
        {
          ul: [
            'We confirm the request comes from you or from someone allowed to make it.',
            'We delete or anonymise the data, and tell the business that owns the workspace where a processor request is involved.',
            'We aim to complete deletion within 30 days. Backups are cleared on their normal cycle.',
          ],
        },
        {
          p: 'A workspace owner can also ask us to delete the whole workspace, which removes all of its contacts, conversations and messages. If you connected the Service through Facebook or Meta, you can also remove the app from your Meta account settings.',
        },
      ],
    },
    {
      id: 'transfers',
      title: 'Where data is processed',
      blocks: [
        {
          p: 'Our providers and Meta may process data in countries other than your own. Where that happens we rely on contractual and technical safeguards that the law accepts.',
        },
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        {
          p: 'The Service is for businesses and is not intended for anyone under 18. We do not knowingly collect data from children. If you think a child’s data has been given to us, contact us and we will delete it.',
        },
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies and similar technologies',
      blocks: [
        {
          p: 'We use cookies and local storage that are needed to keep you signed in and to remember settings such as light or dark mode. We do not use advertising cookies. On the WhatsApp connection step, Meta’s login software may set its own cookies, which Meta controls.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        {
          p: `We may update this policy as the Service changes. The date at the top shows when it last changed (${LEGAL.lastUpdated}). If a change is significant we will tell account holders, for example by email or in the Service.`,
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact us',
      blocks: [
        { p: 'For privacy questions, requests and complaints:' },
        { contact: true },
      ],
    },
  ],
};
