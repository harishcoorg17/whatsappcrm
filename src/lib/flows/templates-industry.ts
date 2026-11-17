/**
 * Industry starter templates.
 *
 * Each template gives a new tenant a working bot on day one: a greeting,
 * a menu, a few canned answers, lead / booking capture via collect_input
 * and a handoff to a human (with a "Talk to a person" option on the
 * menu). Only engine-supported node types are used; the template test
 * (`templates.test.ts`) runs every one through the activation validator.
 *
 * Copy is deliberately generic with obvious placeholders (hours, prices)
 * that the tenant edits in the builder after cloning.
 */

import type { FlowTemplate, FlowTemplateNode } from './templates';

/** Indian business hours, IST = UTC+5:30. */
const IST_OFFSET_MINUTES = 330;

const IST_OFFICE_HOURS = {
  start: '09:30',
  end: '19:00',
  utc_offset_minutes: IST_OFFSET_MINUTES,
};

const startNode = (next: string): FlowTemplateNode => ({
  node_key: 'start',
  node_type: 'start',
  config: { next_node_key: next },
});

const endNode = (): FlowTemplateNode => ({
  node_key: 'end',
  node_type: 'end',
  config: {},
});

const message = (
  node_key: string,
  text: string,
  next_node_key: string
): FlowTemplateNode => ({
  node_key,
  node_type: 'send_message',
  config: { text, next_node_key },
});

const ask = (
  node_key: string,
  var_key: string,
  prompt_text: string,
  next_node_key: string,
  validation?: 'email' | 'phone'
): FlowTemplateNode => ({
  node_key,
  node_type: 'collect_input',
  config: {
    prompt_text,
    var_key,
    next_node_key,
    ...(validation ? { validation } : {}),
  },
});

const handoff = (
  node_key: string,
  note: string,
  text: string
): FlowTemplateNode => ({
  node_key,
  node_type: 'handoff',
  config: {
    note,
    message: text,
    out_of_hours_message:
      "Thanks for reaching out! Our team is offline right now. We have noted your details and will reply first thing when we're back (9:30 am – 7 pm, Mon–Sat).",
    business_hours: IST_OFFICE_HOURS,
  },
});

interface Row {
  reply_id: string;
  title: string;
  description?: string;
  next_node_key: string;
}

const menu = (
  node_key: string,
  text: string,
  rows: Row[]
): FlowTemplateNode => ({
  node_key,
  node_type: 'send_list',
  config: {
    text,
    button_label: 'View options',
    sections: [{ title: 'Choose one', rows }],
  },
});

const TALK_ROW = (next_node_key: string): Row => ({
  reply_id: 'talk_to_agent',
  title: 'Talk to a person',
  description: 'Chat with our team',
  next_node_key,
});

// ============================================================
// Travel
// ============================================================
const TRAVEL: FlowTemplate = {
  slug: 'travel_enquiry',
  name: 'Travel enquiry & packages',
  description:
    'Show a package menu, capture destination, dates and group size, then hand the lead to your sales team.',
  industry: 'travel',
  icon: 'Plane',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    startNode('greet'),
    message(
      'greet',
      "Namaste! ✈️ Welcome to our travel desk. Let's plan your next trip.",
      'menu'
    ),
    menu('menu', 'What would you like to do?', [
      {
        reply_id: 'domestic',
        title: 'Domestic packages',
        description: 'Goa, Kerala, Himachal & more',
        next_node_key: 'domestic_info',
      },
      {
        reply_id: 'international',
        title: 'International packages',
        description: 'Dubai, Thailand, Bali & more',
        next_node_key: 'intl_info',
      },
      {
        reply_id: 'custom_trip',
        title: 'Plan a custom trip',
        description: 'Tell us your dates and budget',
        next_node_key: 'ask_destination',
      },
      {
        reply_id: 'booking_help',
        title: 'Existing booking help',
        next_node_key: 'booking_help',
      },
      TALK_ROW('agent_handoff'),
    ]),
    message(
      'domestic_info',
      "Our popular domestic trips: Goa (3N/4D), Kerala (5N/6D), Himachal (6N/7D) and Rajasthan (6N/7D). Prices start from ₹12,999 per person. Let's find the best fit for you.",
      'ask_destination'
    ),
    message(
      'intl_info',
      "Our popular international trips: Dubai (4N/5D), Thailand (5N/6D), Bali (5N/6D) and Singapore (4N/5D). Prices start from ₹39,999 per person incl. flights. Let's find the best fit for you.",
      'ask_destination'
    ),
    ask(
      'ask_destination',
      'destination',
      'Where would you like to go?',
      'ask_dates'
    ),
    ask(
      'ask_dates',
      'travel_dates',
      'Great choice! What are your approximate travel dates?',
      'ask_group'
    ),
    ask(
      'ask_group',
      'group_size',
      'How many travellers (adults and children)?',
      'ask_phone'
    ),
    ask(
      'ask_phone',
      'phone',
      "Lastly, what's the best phone number to call you on?",
      'lead_handoff',
      'phone'
    ),
    handoff(
      'lead_handoff',
      'Travel lead — destination={{vars.destination}}, dates={{vars.travel_dates}}, travellers={{vars.group_size}}, phone={{vars.phone}}.',
      'Thank you! 🎉 A travel expert will message you shortly with a tailored quote.'
    ),
    message(
      'booking_help',
      "Please share your booking ID and we'll connect you with the right person.",
      'booking_id'
    ),
    ask('booking_id', 'booking_id', 'Your booking ID?', 'booking_handoff'),
    handoff(
      'booking_handoff',
      'Existing booking query — booking ID={{vars.booking_id}}.',
      "Thanks! We're pulling up your booking and a team member will reply shortly."
    ),
    handoff(
      'agent_handoff',
      'Customer asked to talk to a person from the travel menu.',
      'Sure! Connecting you to a travel expert now. 🙌'
    ),
  ],
};

// ============================================================
// Clinic
// ============================================================
const CLINIC: FlowTemplate = {
  slug: 'clinic_appointments',
  name: 'Clinic appointment booking',
  description:
    'Collect patient name, reason and slot, answer timing and location questions, and hand off to the front desk.',
  industry: 'healthcare',
  icon: 'Stethoscope',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    startNode('greet'),
    message(
      'greet',
      'Hello! 🩺 Welcome to our clinic. How can we help you today?',
      'menu'
    ),
    menu('menu', 'Please choose an option:', [
      {
        reply_id: 'book',
        title: 'Book appointment',
        next_node_key: 'ask_name',
      },
      {
        reply_id: 'timings',
        title: 'Clinic timings',
        next_node_key: 'timings',
      },
      {
        reply_id: 'location',
        title: 'Address & directions',
        next_node_key: 'location',
      },
      {
        reply_id: 'reports',
        title: 'Reports & prescriptions',
        next_node_key: 'reports',
      },
      TALK_ROW('agent_handoff'),
    ]),
    ask(
      'ask_name',
      'patient_name',
      "Sure! What's the patient's full name?",
      'ask_reason'
    ),
    ask(
      'ask_reason',
      'reason',
      'Thanks {{vars.patient_name}}. What is the visit for? (e.g. fever, check-up, dental)',
      'ask_slot'
    ),
    ask(
      'ask_slot',
      'preferred_slot',
      'Which day and time suits you best?',
      'book_handoff'
    ),
    handoff(
      'book_handoff',
      'Appointment request — patient={{vars.patient_name}}, reason={{vars.reason}}, slot={{vars.preferred_slot}}. Confirm availability with the patient.',
      'Thank you! Our front desk will confirm your appointment slot shortly. 🙏'
    ),
    message(
      'timings',
      "We're open Mon–Sat, 9:30 am – 1 pm and 5 pm – 8 pm. Closed on Sundays except for emergencies.",
      'end'
    ),
    message(
      'location',
      "We're at 12, Main Road (opposite City Mall). Free parking is available. Reply anytime if you need help finding us!",
      'end'
    ),
    message(
      'reports',
      'Please share the patient name and visit date and our team will send your reports and prescriptions.',
      'reports_name'
    ),
    ask(
      'reports_name',
      'patient_name',
      'Patient name and approximate visit date?',
      'reports_handoff'
    ),
    handoff(
      'reports_handoff',
      'Report / prescription request — {{vars.patient_name}}.',
      'Got it! Our team will send these across shortly.'
    ),
    handoff(
      'agent_handoff',
      'Patient asked to talk to a person.',
      'Connecting you to our front desk now. For emergencies please call the clinic directly.'
    ),
    endNode(),
  ],
};

// ============================================================
// Retail / order status
// ============================================================
const RETAIL: FlowTemplate = {
  slug: 'retail_order_status',
  name: 'Retail order status & support',
  description:
    'Let shoppers check an order, request a return or exchange, or browse offers, with a person one tap away.',
  industry: 'retail',
  icon: 'ShoppingBag',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    startNode('greet'),
    message(
      'greet',
      'Hi! 🛍️ Thanks for shopping with us. How can we help?',
      'menu'
    ),
    menu('menu', 'Pick an option:', [
      {
        reply_id: 'order_status',
        title: 'Track my order',
        next_node_key: 'ask_order',
      },
      {
        reply_id: 'returns',
        title: 'Return or exchange',
        next_node_key: 'returns_info',
      },
      { reply_id: 'offers', title: 'Latest offers', next_node_key: 'offers' },
      {
        reply_id: 'delivery',
        title: 'Delivery & shipping',
        next_node_key: 'delivery',
      },
      TALK_ROW('agent_handoff'),
    ]),
    ask(
      'ask_order',
      'order_id',
      "Please share your order number (it's in your order confirmation).",
      'order_handoff'
    ),
    handoff(
      'order_handoff',
      'Order status check — order={{vars.order_id}}.',
      "Thanks! We're checking order {{vars.order_id}} and will update you here shortly."
    ),
    message(
      'returns_info',
      'Returns and exchanges are accepted within 7 days of delivery for unused items with tags intact.',
      'ask_return_order'
    ),
    ask(
      'ask_return_order',
      'order_id',
      "Share your order number and the item you'd like to return or exchange.",
      'return_handoff'
    ),
    handoff(
      'return_handoff',
      'Return / exchange request — {{vars.order_id}}.',
      'Thanks! Our support team will arrange the pickup and keep you posted.'
    ),
    message(
      'offers',
      '🔥 This week: flat 20% off on new arrivals and free delivery above ₹999. Browse the catalogue on our website or ask us for recommendations.',
      'end'
    ),
    message(
      'delivery',
      'We deliver across India in 3–7 working days. Metro cities usually receive orders in 2–4 days. Free shipping above ₹999.',
      'end'
    ),
    handoff(
      'agent_handoff',
      'Shopper asked to talk to a person.',
      'Sure! A team member will join this chat shortly.'
    ),
    endNode(),
  ],
};

// ============================================================
// Real estate
// ============================================================
const REAL_ESTATE: FlowTemplate = {
  slug: 'real_estate_leads',
  name: 'Real estate lead capture',
  description:
    'Qualify property buyers by budget, BHK and location, offer site visits, and pass warm leads to your sales team.',
  industry: 'real_estate',
  icon: 'Home',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    startNode('greet'),
    message(
      'greet',
      'Hello! 🏡 Thanks for your interest in our properties.',
      'menu'
    ),
    menu('menu', 'What are you looking for?', [
      { reply_id: 'buy', title: 'Buy a home', next_node_key: 'ask_bhk' },
      { reply_id: 'rent', title: 'Rent a home', next_node_key: 'ask_bhk' },
      {
        reply_id: 'site_visit',
        title: 'Book a site visit',
        next_node_key: 'ask_name_visit',
      },
      {
        reply_id: 'brochure',
        title: 'Pricing & brochure',
        next_node_key: 'brochure_info',
      },
      TALK_ROW('agent_handoff'),
    ]),
    ask(
      'ask_bhk',
      'bhk',
      'How many bedrooms do you need? (e.g. 2 BHK, 3 BHK)',
      'ask_location'
    ),
    ask(
      'ask_location',
      'preferred_location',
      'Which area or locality do you prefer?',
      'ask_budget'
    ),
    ask(
      'ask_budget',
      'budget',
      "What's your approximate budget?",
      'ask_name_lead'
    ),
    ask(
      'ask_name_lead',
      'name',
      'Great! May I have your name?',
      'lead_handoff'
    ),
    handoff(
      'lead_handoff',
      'Property lead — name={{vars.name}}, config={{vars.bhk}}, area={{vars.preferred_location}}, budget={{vars.budget}}.',
      'Thanks {{vars.name}}! Our property advisor will share matching options and call you shortly. 📞'
    ),
    ask(
      'ask_name_visit',
      'name',
      'Happy to arrange it! Your name please?',
      'ask_visit_slot'
    ),
    ask(
      'ask_visit_slot',
      'visit_slot',
      'Which day and time would you like to visit?',
      'visit_handoff'
    ),
    handoff(
      'visit_handoff',
      'Site visit request — name={{vars.name}}, slot={{vars.visit_slot}}.',
      "Thanks {{vars.name}}! We'll confirm your site visit slot shortly."
    ),
    message(
      'brochure_info',
      "Pricing varies by project and floor. Tell us what you're looking for and our advisor will share the right brochure and price sheet.",
      'ask_bhk'
    ),
    handoff(
      'agent_handoff',
      'Prospect asked to talk to a person.',
      'Sure! A property advisor will join this chat shortly.'
    ),
  ],
};

// ============================================================
// Education
// ============================================================
const EDUCATION: FlowTemplate = {
  slug: 'education_course_enquiry',
  name: 'Course enquiry',
  description:
    'Help prospective students browse courses, share fees and batches, capture their details and book a counsellor call.',
  industry: 'education',
  icon: 'GraduationCap',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    startNode('greet'),
    message(
      'greet',
      "Hi! 🎓 Thanks for contacting us. We'll help you find the right course.",
      'menu'
    ),
    menu('menu', 'What would you like to know?', [
      {
        reply_id: 'courses',
        title: 'Courses offered',
        next_node_key: 'courses_info',
      },
      {
        reply_id: 'fees',
        title: 'Fees & scholarships',
        next_node_key: 'fees_info',
      },
      {
        reply_id: 'batches',
        title: 'Batch timings',
        next_node_key: 'batches_info',
      },
      {
        reply_id: 'counsellor',
        title: 'Counsellor call',
        next_node_key: 'ask_name',
      },
      TALK_ROW('agent_handoff'),
    ]),
    message(
      'courses_info',
      "We offer Data Analytics, Digital Marketing, Spoken English and Exam Prep (CAT, UPSC, JEE foundation). Tell us your interest and we'll share the syllabus.",
      'ask_name'
    ),
    message(
      'fees_info',
      'Course fees start from ₹9,999 with EMI options. Meritorious students can get up to 25% scholarship. A counsellor can share exact fees for your course.',
      'ask_name'
    ),
    message(
      'batches_info',
      'Weekday batches run 7–9 am and 6–8 pm. Weekend batches run 10 am – 1 pm. New batches start on the 1st of every month.',
      'ask_name'
    ),
    ask('ask_name', 'name', 'May I have your name?', 'ask_course'),
    ask(
      'ask_course',
      'course',
      'Thanks {{vars.name}}! Which course are you interested in?',
      'ask_phone'
    ),
    ask(
      'ask_phone',
      'phone',
      'Best phone number for the counsellor to call you on?',
      'lead_handoff',
      'phone'
    ),
    handoff(
      'lead_handoff',
      'Course enquiry — name={{vars.name}}, course={{vars.course}}, phone={{vars.phone}}.',
      'Thank you {{vars.name}}! Our counsellor will call you shortly to guide you. 📚'
    ),
    handoff(
      'agent_handoff',
      'Student asked to talk to a person.',
      'Sure! A counsellor will join this chat shortly.'
    ),
  ],
};

// ============================================================
// Restaurant
// ============================================================
const RESTAURANT: FlowTemplate = {
  slug: 'restaurant_booking',
  name: 'Restaurant table booking',
  description:
    'Take table reservations (date, time, guests), share the menu and opening hours, and hand off for confirmation.',
  industry: 'restaurant',
  icon: 'Utensils',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    startNode('greet'),
    message('greet', 'Welcome! 🍽️ Thanks for messaging us.', 'menu'),
    menu('menu', 'How can we help?', [
      {
        reply_id: 'book_table',
        title: 'Book a table',
        next_node_key: 'ask_name',
      },
      {
        reply_id: 'menu_info',
        title: 'Menu & specials',
        next_node_key: 'menu_text',
      },
      {
        reply_id: 'hours',
        title: 'Timings & address',
        next_node_key: 'hours_text',
      },
      {
        reply_id: 'party',
        title: 'Party / bulk orders',
        next_node_key: 'ask_party',
      },
      TALK_ROW('agent_handoff'),
    ]),
    ask(
      'ask_name',
      'name',
      'Lovely! Under what name should we book?',
      'ask_date'
    ),
    ask('ask_date', 'date', 'Which date would you like to visit?', 'ask_time'),
    ask(
      'ask_time',
      'time',
      'What time? (lunch 12–3 pm, dinner 7–11 pm)',
      'ask_guests'
    ),
    ask('ask_guests', 'guests', 'How many guests?', 'book_handoff'),
    handoff(
      'book_handoff',
      'Table booking request — name={{vars.name}}, date={{vars.date}}, time={{vars.time}}, guests={{vars.guests}}.',
      "Thanks {{vars.name}}! We'll confirm your table here shortly. 🙌"
    ),
    message(
      'menu_text',
      "Today's specials: Butter Chicken, Paneer Tikka, Veg Biryani and Gulab Jamun. Ask us for the full menu or to recommend something for your group.",
      'end'
    ),
    message(
      'hours_text',
      "We're open daily 12 pm – 11 pm at 45, Market Road, near the city square. Parking available.",
      'end'
    ),
    ask(
      'ask_party',
      'party_details',
      'Tell us the date, number of guests and any food preferences.',
      'party_handoff'
    ),
    handoff(
      'party_handoff',
      'Party / bulk order — {{vars.party_details}}.',
      'Thanks! Our events team will share a custom quote shortly.'
    ),
    handoff(
      'agent_handoff',
      'Guest asked to talk to a person.',
      'Sure! A team member will join this chat shortly.'
    ),
    endNode(),
  ],
};

export const INDUSTRY_TEMPLATES: FlowTemplate[] = [
  TRAVEL,
  CLINIC,
  RETAIL,
  REAL_ESTATE,
  EDUCATION,
  RESTAURANT,
];
