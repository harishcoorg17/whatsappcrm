/**
 * Pricing plans. Prices are INR per month, exclusive of 18% GST.
 * Meta's WhatsApp message fees are billed separately at cost.
 */
export interface PricingPlan {
  id: 'starter' | 'growth' | 'scale';
  name: string;
  blurb: string;
  /** Monthly price in INR; null means "talk to us". */
  monthly: number | null;
  agents: string;
  numbers: string;
  highlighted: boolean;
  features: string[];
}

/** Annual billing gives two months free. */
export const ANNUAL_MONTHS_CHARGED = 10;

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    blurb: 'For small teams getting started on WhatsApp.',
    monthly: 1999,
    agents: '3 agents',
    numbers: '1 WhatsApp number',
    highlighted: false,
    features: [
      'Shared team inbox',
      'Contacts and tags',
      'Broadcasts with approved templates',
      'Basic automations and auto-replies',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    blurb: 'For teams that automate and still want a human in the loop.',
    monthly: 4999,
    agents: '5 agents',
    numbers: '2 WhatsApp numbers',
    highlighted: true,
    features: [
      'Everything in Starter',
      'Chatbot flows with buttons and lists',
      'Hand off to a human agent',
      'Lead pipelines and deals',
      'Out-of-hours messages',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    blurb: 'For agencies and multi-brand businesses.',
    monthly: null,
    agents: 'Custom agents',
    numbers: 'Many WhatsApp numbers',
    highlighted: false,
    features: [
      'Everything in Growth',
      'Separate workspace per brand',
      'Integration API',
      'Priority support',
    ],
  },
];

export const EXTRA_AGENT_PRICE = 400;

export const PRICING_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'What are WhatsApp message fees?',
    a: 'Meta charges for template messages sent outside the 24-hour customer window. We pass these through at Meta’s published rate and add no markup. Replies within 24 hours of a customer message are free.',
  },
  {
    q: 'Is GST included?',
    a: 'Prices exclude 18% GST, which is added at checkout.',
  },
  {
    q: 'Can I add more agents?',
    a: `Yes. Extra agents on Starter and Growth are ₹${EXTRA_AGENT_PRICE} per agent per month.`,
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes, every new account gets a 14-day trial of Growth. No card is needed to start.',
  },
  {
    q: 'Can the bot pass a chat to a person?',
    a: 'Yes. On Growth and Scale, a flow or automation can hand a chat to a human agent. The bot stays silent until the agent returns the chat to it.',
  },
];
