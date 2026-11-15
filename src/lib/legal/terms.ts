import { LEGAL } from './company';
import type { LegalDoc } from './types';

/**
 * Terms of Service for ConverMesh WhatsApp CRM. A general-purpose draft that
 * fits what the product does. Review it with a lawyer, in particular the
 * liability cap, the governing law and the commercial terms, before relying
 * on it.
 */
export const TERMS_OF_SERVICE: LegalDoc = {
  title: 'Terms and Conditions',
  description: `The terms for using ${LEGAL.productFull}.`,
  intro: `These Terms and Conditions ("Terms") are an agreement between you and ${LEGAL.operator} ("we", "us") for your use of ${LEGAL.productFull} (the "Service") at ${LEGAL.siteUrl}. By creating an account or using the Service you accept these Terms. If you use the Service for a business, you confirm that you can bind that business to them.`,
  sections: [
    {
      id: 'service',
      title: 'The Service',
      blocks: [
        {
          p: 'The Service lets businesses connect WhatsApp Business numbers and manage conversations with their customers: a shared inbox, contacts, pipelines, message templates, broadcasts, flows and automations. Features may change, and some are labelled beta and may be incomplete.',
        },
      ],
    },
    {
      id: 'accounts',
      title: 'Accounts and workspaces',
      blocks: [
        {
          ul: [
            'You must give accurate information and keep your sign-in details secure. You are responsible for what happens under your account.',
            'You must be at least 18 and able to enter a binding contract.',
            'A workspace owner controls who joins the workspace and what they can do, and is responsible for its members.',
            'Tell us promptly if you think your account has been used without permission.',
          ],
        },
      ],
    },
    {
      id: 'whatsapp',
      title: 'WhatsApp and Meta rules',
      blocks: [
        {
          p: 'The Service works through Meta’s WhatsApp Business Platform. To use it you must also follow Meta’s terms and policies, as they change, including the following. We are not affiliated with or endorsed by Meta or WhatsApp.',
        },
        {
          links: [
            {
              label: 'WhatsApp Business Terms of Service',
              href: 'https://www.whatsapp.com/legal/business-terms',
            },
            {
              label: 'WhatsApp Business Policy',
              href: 'https://www.whatsapp.com/legal/business-policy',
            },
          ],
        },
        {
          ul: [
            'You may message people only where you have their permission (opt-in) as WhatsApp and the law require, and you must honour opt-outs.',
            'Message templates must be approved by Meta, and marketing messages must follow Meta’s content rules.',
            'Meta may limit, suspend or block a number or account. We are not responsible for Meta’s decisions, outages, limits or charges.',
            'Meta may bill conversation or message fees directly to your WhatsApp Business Account. Those are separate from anything you pay us.',
          ],
        },
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      blocks: [
        { p: 'You must not use the Service to:' },
        {
          ul: [
            'send spam, unsolicited or deceptive messages, or messages to people who have opted out;',
            'send anything unlawful, harassing, hateful, fraudulent, sexually explicit involving minors, or that infringes others’ rights;',
            'collect or message people in breach of privacy, marketing or telecom laws that apply to you or them;',
            'attempt to access other workspaces’ data, probe or disrupt the Service, bypass limits or security, or reverse engineer it;',
            'resell or provide the Service to others without our written agreement.',
          ],
        },
      ],
    },
    {
      id: 'your-data',
      title: 'Your data and your customers’ data',
      blocks: [
        {
          p: 'You keep ownership of the content and contact data you put into the Service. You give us the right to host, process and transmit it only to provide the Service to you, under our Privacy Policy.',
        },
        {
          p: 'You are responsible for having a lawful basis and the required consent to process your customers’ data and to contact them, and for answering their requests. We process that data on your instructions as described in the Privacy Policy.',
        },
        {
          links: [{ label: 'Privacy Policy', href: '/privacy' }],
        },
      ],
    },
    {
      id: 'fees',
      title: 'Plans and fees',
      blocks: [
        {
          p: 'Some features or usage levels may be paid. Fees, billing periods and taxes are those shown to you when you choose a plan or in your order, and are payable in advance unless stated otherwise. Fees already paid are not refundable except where the law requires or we say so in writing. We will tell you before we change fees for a plan you are on.',
        },
      ],
    },
    {
      id: 'ip',
      title: 'Our intellectual property',
      blocks: [
        {
          p: `The Service, including its software, design and the ${LEGAL.product} name and logo, belongs to us or our licensors. We give you a limited, non-exclusive, non-transferable right to use the Service under these Terms. Feedback you give us can be used by us without obligation to you.`,
        },
      ],
    },
    {
      id: 'third-parties',
      title: 'Third-party services',
      blocks: [
        {
          p: 'The Service relies on and may link to third-party services, such as Meta, hosting and email providers. We do not control them and are not responsible for their availability or conduct. Your use of them may be subject to their own terms.',
        },
      ],
    },
    {
      id: 'suspension',
      title: 'Suspension and termination',
      blocks: [
        {
          p: 'You can stop using the Service at any time, and a workspace owner can ask us to delete the workspace. We may suspend or end your access if you break these Terms or the law, if your use puts the Service, other users or our relationship with Meta at risk, or if payment is overdue. Where reasonable we will tell you first. Sections that by nature should continue after termination (including data, liability and governing law) do so.',
        },
      ],
    },
    {
      id: 'disclaimer',
      title: 'Disclaimers',
      blocks: [
        {
          p: 'The Service is provided "as is" and "as available". To the extent the law allows, we do not promise that it will be uninterrupted, error-free or that messages will always be delivered, since delivery depends on WhatsApp, Meta and mobile networks. Nothing in these Terms is legal, tax or compliance advice.',
        },
      ],
    },
    {
      id: 'liability',
      title: 'Limitation of liability',
      blocks: [
        {
          p: 'To the extent the law allows, we are not liable for indirect, incidental, special or consequential losses, or for loss of profits, revenue, goodwill or data, arising from your use of the Service. Our total liability for any claim relating to the Service is limited to the fees you paid us for the Service in the 12 months before the claim arose, or, if you paid nothing, to INR 10,000. Nothing here limits liability that cannot be limited by law.',
        },
      ],
    },
    {
      id: 'indemnity',
      title: 'Indemnity',
      blocks: [
        {
          p: 'You will defend and compensate us against claims, losses and costs arising from your content, your messages to your customers, your breach of these Terms or Meta’s policies, or your breach of law.',
        },
      ],
    },
    {
      id: 'law',
      title: 'Governing law',
      blocks: [
        {
          p: `These Terms are governed by the laws of ${LEGAL.governingLaw}. We will first try to resolve any dispute in good faith. If that fails, the competent courts in ${LEGAL.governingLaw} have jurisdiction, unless the law gives you the right to bring a claim elsewhere.`,
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to these Terms',
      blocks: [
        {
          p: `We may update these Terms. The date at the top (${LEGAL.lastUpdated}) shows the latest version. If a change is significant we will tell account holders, and continuing to use the Service after the change means you accept it.`,
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact us',
      blocks: [{ p: 'Questions about these Terms:' }, { contact: true }],
    },
  ],
};
