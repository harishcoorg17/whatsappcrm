import Link from 'next/link';
import { LEGAL } from '@/lib/legal/company';
import type { LegalBlock, LegalDoc } from '@/lib/legal/types';

const isInternal = (href: string) => href.startsWith('/');

function LegalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const className =
    'text-primary underline underline-offset-2 hover:opacity-80';
  return isInternal(href) ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

function ContactDetails() {
  return (
    <address className="text-muted-foreground space-y-1 text-sm not-italic">
      <p className="text-foreground font-medium">{LEGAL.operator}</p>
      {LEGAL.address && <p>{LEGAL.address}</p>}
      {LEGAL.email ? (
        <p>
          Email:{' '}
          <a
            href={`mailto:${LEGAL.email}`}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {LEGAL.email}
          </a>
        </p>
      ) : (
        <p>
          You can also reach us through the support option in your{' '}
          {LEGAL.product} account.
        </p>
      )}
    </address>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if ('p' in block) {
    return <p className="text-muted-foreground leading-7">{block.p}</p>;
  }
  if ('ul' in block) {
    return (
      <ul className="text-muted-foreground list-disc space-y-2 pl-5 leading-7 marker:text-slate-500">
        {block.ul.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if ('links' in block) {
    return (
      <ul className="space-y-1 text-sm">
        {block.links.map((link) => (
          <li key={link.href}>
            <LegalLink href={link.href}>{link.label}</LegalLink>
          </li>
        ))}
      </ul>
    );
  }
  return <ContactDetails />;
}

/** A legal page: title, last-updated date, contents list and anchored sections. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="border-border border-b pb-8">
        <h1 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
          {doc.title}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Last updated {LEGAL.lastUpdated}
        </p>
        <p className="text-muted-foreground mt-6 leading-7">{doc.intro}</p>
      </header>

      <nav
        aria-label="Contents"
        className="border-border bg-card my-8 rounded-xl border p-5"
      >
        <p className="text-foreground mb-3 text-sm font-semibold">Contents</p>
        <ol className="text-muted-foreground grid list-decimal gap-x-8 gap-y-1.5 pl-5 text-sm sm:grid-cols-2">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="hover:text-foreground hover:underline"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-10">
        {doc.sections.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            className="scroll-mt-24 space-y-3"
          >
            <h2 className="text-foreground text-xl font-semibold">
              {index + 1}. {section.title}
            </h2>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
