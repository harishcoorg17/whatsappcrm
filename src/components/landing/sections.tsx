import Link from 'next/link';
import { Check, MessageCircle } from 'lucide-react';
import { BENEFITS, COMPARISON, EASE_POINTS, HOW_IT_WORKS } from './content';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[var(--primary-hover)]';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent';

function SectionHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-primary text-sm font-semibold tracking-wider uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {lead ? (
        <p className="text-muted-foreground mt-4 text-base">{lead}</p>
      ) : null}
    </div>
  );
}

export function LandingHeader() {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <MessageCircle className="text-primary size-5" aria-hidden />
          Novacompass WhatsApp CRM
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/login" className={SECONDARY_BUTTON}>
            Sign in
          </Link>
          <Link href="/signup" className={PRIMARY_BUTTON}>
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28">
      <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
        Run your customer chats on{' '}
        <span className="text-primary">WhatsApp</span>, as a team
      </h1>
      <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg">
        A shared inbox, lead pipelines, broadcasts and automations for your
        business number. Connect it yourself in a few minutes, with no code and
        no developer.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/signup" className={PRIMARY_BUTTON}>
          Connect your number
        </Link>
        <a href="#how-it-works" className={SECONDARY_BUTTON}>
          See how it works
        </a>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <SectionHeading
        eyebrow="How it works"
        title="From sign-up to first reply in four steps"
      />
      <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS.map((step, index) => (
          <li
            key={step.title}
            className="border-border bg-card rounded-xl border p-6"
          >
            <span className="text-primary flex size-9 items-center justify-center rounded-full bg-[var(--primary-soft-2)] text-sm font-bold">
              {index + 1}
            </span>
            <h3 className="mt-4 font-semibold">{step.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Benefits() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <SectionHeading
        eyebrow="Benefits"
        title="Everything a team needs to handle WhatsApp well"
      />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="border-border bg-card rounded-xl border p-6"
          >
            <Icon className="text-primary size-6" aria-hidden />
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="text-muted-foreground mt-2 text-sm">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Comparison() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <SectionHeading
        eyebrow="How we’re different"
        title="Official, safe and made for many businesses"
        lead="Many WhatsApp tools take shortcuts to get you connected. We use the official route and keep every business separate."
      />
      <div className="border-border mt-12 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">
            Typical WhatsApp tools compared with Novacompass WhatsApp CRM
          </caption>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Topic</span>
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Typical tools
              </th>
              <th scope="col" className="text-primary px-4 py-3 font-medium">
                Novacompass
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.topic} className="border-border border-t">
                <th scope="row" className="px-4 py-4 font-medium">
                  {row.topic}
                </th>
                <td className="text-muted-foreground px-4 py-4">
                  {row.typical}
                </td>
                <td className="px-4 py-4">{row.ours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Ease() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <div className="border-border bg-card rounded-2xl border p-8 sm:p-12">
        <SectionHeading
          eyebrow="Easy for clients"
          title="If you can sign in to Facebook, you can connect"
          lead="Onboarding takes a few minutes and you stay in control throughout."
        />
        <ul className="mx-auto mt-8 grid max-w-xl gap-3">
          {EASE_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-3">
              <Check
                className="text-primary mt-0.5 size-5 shrink-0"
                aria-hidden
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-8 text-center text-sm">
          You’ll need a Facebook account that can manage your Meta Business
          portfolio, and a phone number to connect.
        </p>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Ready to bring your WhatsApp into one place?
      </h2>
      <div className="mt-8 flex justify-center">
        <Link href="/signup" className={PRIMARY_BUTTON}>
          Create your account
        </Link>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-border text-muted-foreground border-t py-8 text-center text-sm">
      © {new Date().getFullYear()} Novacompass WhatsApp CRM
    </footer>
  );
}
