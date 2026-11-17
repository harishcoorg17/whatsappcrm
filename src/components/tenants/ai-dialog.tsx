'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  MAX_INSTRUCTIONS_CHARS,
  MAX_KNOWLEDGE_CHARS,
} from '@/lib/ai/agent-core';
import {
  AI_PROVIDERS,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  type AiProvider,
} from '@/lib/ai/providers';

interface AiDialogProps {
  tenant: { slug: string; name: string } | null;
  onClose: () => void;
}

interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  instructions: string;
  knowledge: string;
  hasKey: boolean;
  leadCapture: boolean;
}

const DEFAULT_PROVIDER: AiProvider = 'anthropic';

const DEFAULT_SETTINGS: AiSettings = {
  enabled: false,
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODELS[DEFAULT_PROVIDER],
  instructions: '',
  knowledge: '',
  hasKey: false,
  leadCapture: false,
};

const KEY_HELP: Record<AiProvider, string> = {
  anthropic: 'Create a key at console.anthropic.com.',
  openai: 'Create a key at platform.openai.com.',
  openrouter: 'Create a key at openrouter.ai/keys.',
  gemini: 'Create a key at aistudio.google.com.',
};

const FIELD_CLASS =
  'focus:border-primary/50 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none';

/**
 * The AI agent for one tenant: which provider and model answer customers,
 * the tenant's own API key, and what the AI may talk about. Nothing changes
 * for customers until "Turn the AI on" is saved with a key.
 */
export function AiDialog({ tenant, onClose }: AiDialogProps) {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const slug = tenant?.slug ?? null;
  const url = slug ? `/api/tenants/${encodeURIComponent(slug)}/ai` : null;

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch(url);
      const body = (await res.json().catch(() => ({}))) as Partial<
        Omit<AiSettings, 'provider'> & { provider: AiProvider | null }
      > & { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not load AI settings');
        return;
      }
      const provider = body.provider ?? DEFAULT_PROVIDER;
      setSettings({
        enabled: body.enabled === true,
        provider,
        model: body.model || DEFAULT_MODELS[provider],
        instructions: body.instructions ?? '',
        knowledge: body.knowledge ?? '',
        hasKey: body.hasKey === true,
        leadCapture: body.leadCapture === true,
      });
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!slug) return;
    setSettings(DEFAULT_SETTINGS);
    setApiKey('');
    setClearKey(false);
    void load();
  }, [slug, load]);

  const changeProvider = (provider: AiProvider) => {
    setTestResult(null);
    setSettings((s) => ({
      ...s,
      provider,
      model: DEFAULT_MODELS[provider],
    }));
  };

  const keyReady = apiKey.trim() !== '' || (settings.hasKey && !clearKey);

  const testKey = async () => {
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${url}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        warning?: string;
      };
      if (!res.ok) {
        setTestResult({ ok: false, message: body.error ?? 'Could not test' });
      } else if (body.ok) {
        setTestResult({
          ok: !body.warning,
          message: body.warning ?? 'Key works. The AI can answer customers.',
        });
      } else {
        setTestResult({ ok: false, message: body.error ?? 'Test failed' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Network error' });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!url) return;
    setSaving(true);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.enabled,
          provider: settings.provider,
          model: settings.model,
          instructions: settings.instructions,
          knowledge: settings.knowledge,
          leadCapture: settings.leadCapture,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(clearKey && !apiKey.trim() ? { clearKey: true } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not save');
        return;
      }
      toast.success(
        settings.enabled ? 'AI agent is on' : 'AI settings saved (AI is off)'
      );
      onClose();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle>AI agent — {tenant?.name}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, enabled: e.target.checked }))
                  }
                  className="accent-primary h-4 w-4"
                />
                Turn the AI on
              </label>
              <p className="text-xs text-slate-400">
                When no bot flow takes a customer&apos;s message, the AI answers
                from the information below. If it is unsure, or the customer
                asks for a person, it hands the chat to your team. It stays
                quiet while one of your agents is replying.
              </p>
            </section>

            <section className="space-y-2 border-t border-slate-800 pt-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.leadCapture}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      leadCapture: e.target.checked,
                    }))
                  }
                  className="accent-primary h-4 w-4"
                />
                Capture trip details from chats
              </label>
              <p className="text-xs text-slate-400">
                For travel businesses. The AI saves the destination, travel
                dates, group size and budget a customer mentions onto their
                contact, and tags them &quot;ai-lead&quot; once it knows the
                destination plus one more detail. Needs migration 048.
              </p>
            </section>

            <section className="space-y-3 border-t border-slate-800 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Provider</Label>
                  <select
                    value={settings.provider}
                    onChange={(e) =>
                      changeProvider(e.target.value as AiProvider)
                    }
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200"
                  >
                    {AI_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <input
                    value={settings.model}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, model: e.target.value }))
                    }
                    maxLength={120}
                    placeholder={DEFAULT_MODELS[settings.provider]}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>API key</Label>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (e.target.value) setClearKey(false);
                  }}
                  placeholder={
                    settings.hasKey && !clearKey
                      ? 'Saved — leave blank to keep it'
                      : 'Paste your key'
                  }
                  className={FIELD_CLASS}
                />
                <p className="text-xs text-slate-400">
                  {KEY_HELP[settings.provider]} It is stored encrypted and never
                  shown again. Usage is billed to your own provider account.
                  Changing the provider needs that provider&apos;s key.
                </p>
                {settings.hasKey && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearKey((c) => !c);
                      setApiKey('');
                    }}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    {clearKey ? 'Keep the saved key' : 'Remove the saved key'}
                  </button>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={testKey}
                    disabled={testing || saving || !keyReady}
                  >
                    {testing ? 'Testing…' : 'Test key'}
                  </Button>
                  {testResult && (
                    <p
                      role="status"
                      className={
                        testResult.ok
                          ? 'text-xs text-emerald-400'
                          : 'text-xs text-amber-400'
                      }
                    >
                      {testResult.message}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-800 pt-4">
              <div className="space-y-1.5">
                <Label>Business information</Label>
                <textarea
                  value={settings.knowledge}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, knowledge: e.target.value }))
                  }
                  rows={8}
                  maxLength={MAX_KNOWLEDGE_CHARS}
                  placeholder={
                    'What the AI may answer from: tours and prices, policies, timings, FAQs, contact details.\nIt will not answer anything that is not written here.'
                  }
                  className={`${FIELD_CLASS} resize-y`}
                />
                <p className="text-right text-xs text-slate-500">
                  {settings.knowledge.length} / {MAX_KNOWLEDGE_CHARS}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Instructions (optional)</Label>
                <textarea
                  value={settings.instructions}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      instructions: e.target.value,
                    }))
                  }
                  rows={3}
                  maxLength={MAX_INSTRUCTIONS_CHARS}
                  placeholder="Tone and style, e.g. friendly and brief, address customers as sir or madam, always end by offering to connect them to the team."
                  className={`${FIELD_CLASS} resize-y`}
                />
              </div>
            </section>

            {settings.enabled && !keyReady && (
              <p className="text-xs text-amber-400">
                Add an API key to turn the AI on.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={saving || (settings.enabled && !keyReady)}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
