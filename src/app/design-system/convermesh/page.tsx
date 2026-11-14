'use client';

import { useState } from 'react';
import '@/design-system/convermesh/tokens.css';
import '@/design-system/convermesh/components.css';

type Theme = 'light' | 'dark';

const CONVERSATIONS = [
  {
    initial: 'A',
    name: 'Ananya Sharma',
    preview: 'Interested in your package',
    badge: 'New',
    coral: false,
  },
  {
    initial: 'R',
    name: 'Rahul Menon',
    preview: 'Please share the quotation',
    time: '10:42 AM',
    coral: true,
  },
];

const SWATCHES = [
  { label: 'Teal', token: '--cm-teal', value: '#079C91' },
  { label: 'Navy', token: '--cm-navy', value: '#0E314F' },
  { label: 'Coral', token: '--cm-coral', value: '#FF765E' },
  { label: 'White', token: '--cm-white', value: '#F5F9F8' },
  { label: 'Slate', token: '--cm-slate', value: '#64748B' },
  { label: 'Action', token: '--cm-action', value: '#067F77' },
];

export default function ConverMeshDesignSystemPage() {
  const [theme, setTheme] = useState<Theme>('light');
  const next: Theme = theme === 'light' ? 'dark' : 'light';

  return (
    <div className="cm-ds min-h-screen p-6" data-theme={theme}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card space-y-6 p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">ConverMesh</h1>
            <button
              type="button"
              className="badge"
              onClick={() => setTheme(next)}
              aria-label={`Switch to ${next} mode`}
            >
              {theme === 'light' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card p-5">
              <p className="eyebrow">Total contacts</p>
              <p className="mt-3 text-4xl font-bold">12,840</p>
              <p className="text-positive mt-5">+12.5% this month</p>
            </div>
            <div className="card p-5">
              <p className="eyebrow">Active chats</p>
              <p className="mt-3 text-4xl font-bold">248</p>
              <p className="text-positive mt-5">36 awaiting response</p>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-semibold">Recent conversations</h2>
            <ul className="mt-4">
              {CONVERSATIONS.map((c, i) => (
                <li key={c.name}>
                  {i > 0 && <hr className="divider my-4" />}
                  <div className="flex items-center gap-3">
                    <span className={`avatar ${c.coral ? 'avatar-coral' : ''}`}>
                      {c.initial}
                    </span>
                    <div className="flex-1">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-secondary text-sm">{c.preview}</p>
                    </div>
                    {c.badge ? (
                      <span className="badge">{c.badge}</span>
                    ) : (
                      <span className="text-muted text-sm">{c.time}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className="btn-primary">
              New Campaign
            </button>
            <button type="button" className="btn-outline">
              View Reports
            </button>
          </div>
        </div>

        <div className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Brand colors</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SWATCHES.map((s) => (
              <div key={s.token} className="card-muted p-3">
                <div
                  className="h-12 rounded-lg border"
                  style={{
                    background: `var(${s.token})`,
                    borderColor: 'var(--border-color)',
                  }}
                />
                <p className="mt-2 font-medium">{s.label}</p>
                <p className="text-muted text-xs">
                  {s.token} · {s.value}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary">
              Primary
            </button>
            <button type="button" className="btn-accent">
              Accent
            </button>
            <button type="button" className="btn-outline">
              Outline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
