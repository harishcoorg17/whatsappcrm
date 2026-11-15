import { describe, expect, it } from 'vitest';
import { LEGAL, LEGAL_PATHS } from './company';
import { PRIVACY_POLICY } from './privacy';
import { TERMS_OF_SERVICE } from './terms';
import type { LegalDoc } from './types';

const DOCS: Array<[string, LegalDoc]> = [
  ['privacy policy', PRIVACY_POLICY],
  ['terms', TERMS_OF_SERVICE],
];

describe.each(DOCS)('%s', (_name, doc) => {
  it('has a title, description and intro', () => {
    expect(doc.title.length).toBeGreaterThan(0);
    expect(doc.description.length).toBeGreaterThan(0);
    expect(doc.intro).toContain(LEGAL.operator);
  });

  it('has unique, URL-safe anchor ids', () => {
    const ids = doc.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('has no empty sections', () => {
    for (const section of doc.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });

  it('ends with contact details', () => {
    const last = doc.sections[doc.sections.length - 1];
    expect(last.id).toBe('contact');
    expect(last.blocks.some((b) => 'contact' in b)).toBe(true);
  });

  it('only links to https pages or internal paths', () => {
    for (const section of doc.sections) {
      for (const block of section.blocks) {
        if (!('links' in block)) continue;
        for (const link of block.links) {
          expect(link.href).toMatch(/^(https:\/\/|\/)/);
        }
      }
    }
  });
});

describe('privacy policy requirements', () => {
  it('has a data deletion section at the anchor the app links to', () => {
    const anchor = LEGAL_PATHS.dataDeletion.split('#')[1];
    expect(PRIVACY_POLICY.sections.some((s) => s.id === anchor)).toBe(true);
  });

  it('covers WhatsApp/Meta, security, retention and rights', () => {
    const ids = PRIVACY_POLICY.sections.map((s) => s.id);
    for (const required of [
      'whatsapp-meta',
      'security',
      'retention',
      'your-rights',
    ]) {
      expect(ids).toContain(required);
    }
  });
});

describe('terms requirements', () => {
  it('covers WhatsApp rules, acceptable use, liability and governing law', () => {
    const ids = TERMS_OF_SERVICE.sections.map((s) => s.id);
    for (const required of ['whatsapp', 'acceptable-use', 'liability', 'law']) {
      expect(ids).toContain(required);
    }
  });

  it('points to the privacy policy', () => {
    const linksPrivacy = TERMS_OF_SERVICE.sections.some((s) =>
      s.blocks.some(
        (b) =>
          'links' in b && b.links.some((l) => l.href === LEGAL_PATHS.privacy)
      )
    );
    expect(linksPrivacy).toBe(true);
  });
});
