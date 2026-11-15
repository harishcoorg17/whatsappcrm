/** One piece of a legal section, rendered in order by LegalDocument. */
export type LegalBlock =
  | { p: string }
  | { ul: readonly string[] }
  | { links: ReadonlyArray<{ label: string; href: string }> }
  /** The operator's name, address and contact email from LEGAL. */
  | { contact: true };

export interface LegalSection {
  /** Anchor id, e.g. "data-deletion" for /privacy#data-deletion. */
  id: string;
  title: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDoc {
  title: string;
  description: string;
  intro: string;
  sections: readonly LegalSection[];
}
