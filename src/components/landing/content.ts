import {
  Inbox,
  Megaphone,
  Workflow,
  Kanban,
  Users,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export interface Step {
  readonly title: string;
  readonly body: string;
}

export interface Benefit {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}

export interface ComparisonRow {
  readonly topic: string;
  readonly typical: string;
  readonly ours: string;
}

export const HOW_IT_WORKS: readonly Step[] = [
  {
    title: 'Create your account',
    body: 'Sign up with your email. No installs, no developer tools, and no Meta developer account of your own.',
  },
  {
    title: 'Connect your WhatsApp number',
    body: 'Click connect and Meta’s own signup window opens. Choose your WhatsApp Business account, add or verify your number, and approve access.',
  },
  {
    title: 'Messages start flowing in',
    body: 'Your number is linked and subscribed automatically. Customer messages land in a shared team inbox in real time.',
  },
  {
    title: 'Reply, organise and automate',
    body: 'Answer from the inbox, track leads in pipelines, send broadcasts with approved templates, and let flows handle the repetitive parts.',
  },
] as const;

export const BENEFITS: readonly Benefit[] = [
  {
    icon: Inbox,
    title: 'One shared inbox',
    body: 'Every conversation in one place, so nothing sits unanswered in someone’s personal phone.',
  },
  {
    icon: Kanban,
    title: 'Pipelines for every lead',
    body: 'Move enquiries from first message to booked, and see at a glance what needs a follow-up.',
  },
  {
    icon: Megaphone,
    title: 'Broadcasts that follow the rules',
    body: 'Send approved templates to a contact list and see sent, delivered, read and replied counts.',
  },
  {
    icon: Workflow,
    title: 'Automations and flows',
    body: 'Auto-reply, route keywords and run guided menus. A human reply pauses the bot automatically.',
  },
  {
    icon: Users,
    title: 'Built for teams and many clients',
    body: 'Each business is its own workspace with its own contacts, conversations and number.',
  },
  {
    icon: ShieldCheck,
    title: 'Your connection stays yours',
    body: 'Access tokens are stored encrypted, and one workspace can never see another’s conversations.',
  },
] as const;

export const COMPARISON: readonly ComparisonRow[] = [
  {
    topic: 'How the number connects',
    typical: 'Scan a QR code or hand over API keys',
    ours: 'Official Meta signup window, approved by you in minutes',
  },
  {
    topic: 'Your existing WhatsApp Business app',
    typical: 'Number must move off the app',
    ours: 'Coexistence lets you keep using the app on the same number',
  },
  {
    topic: 'Account safety',
    typical: 'Unofficial connections can get numbers banned',
    ours: 'Built on the official WhatsApp Business Platform',
  },
  {
    topic: 'Multiple businesses',
    typical: 'One login shared across clients',
    ours: 'Separate workspace per business, isolated by design',
  },
  {
    topic: 'Setup effort',
    typical: 'Developer time and technical support',
    ours: 'Self-serve, no code',
  },
] as const;

export const EASE_POINTS: readonly string[] = [
  'No code and no developer needed',
  'You approve every permission in Meta’s own window',
  'Keep your number and your history',
  'Disconnect any time from your Meta settings',
] as const;
