'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

const TENANTS_PATH = '/tenants';

interface PhoneInfo {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

interface ConnectionState {
  connected: boolean;
  source: 'tenant' | 'legacy' | null;
  phoneInfo: PhoneInfo | null;
  message: string;
}

const INITIAL_STATE: ConnectionState = {
  connected: false,
  source: null,
  phoneInfo: null,
  message: '',
};

/**
 * Read-only WhatsApp status. Numbers are connected and managed on the
 * Tenants page; this card only reports what the app will actually send with.
 */
export function WhatsAppConfig() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ConnectionState>(INITIAL_STATE);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch('/api/whatsapp/config', { method: 'GET' });
        const payload = await res.json();
        if (cancelled) return;
        setState({
          connected: Boolean(payload.connected),
          source: payload.source ?? (payload.connected ? 'legacy' : null),
          phoneInfo: payload.phone_info ?? null,
          message:
            payload.reason === 'no_config' ? '' : (payload.message ?? ''),
        });
      } catch (err) {
        console.error('WhatsApp status check failed:', err);
        if (!cancelled) {
          setState({
            ...INITIAL_STATE,
            message: 'Could not check the WhatsApp connection.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  const { connected, source, phoneInfo, message } = state;

  return (
    <div className="mt-4 max-w-2xl space-y-6">
      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <div className="flex items-center gap-2">
            {connected ? (
              <CheckCircle2 className="text-primary size-5" />
            ) : (
              <XCircle className="size-5 text-red-500" />
            )}
            <CardTitle className="text-white">
              {connected ? 'WhatsApp connected' : 'WhatsApp not connected'}
            </CardTitle>
          </div>
          <CardDescription className="text-slate-400">
            {connected
              ? source === 'tenant'
                ? 'Connected through Tenants.'
                : 'Connected with a legacy per-user configuration. Reconnect it from the Tenants page to manage it there.'
              : message ||
                'Connect your WhatsApp Business number from the Tenants page.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected && phoneInfo && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {phoneInfo.display_phone_number && (
                <>
                  <dt className="text-slate-400">Number</dt>
                  <dd className="text-white">
                    {phoneInfo.display_phone_number}
                  </dd>
                </>
              )}
              {phoneInfo.verified_name && (
                <>
                  <dt className="text-slate-400">Business name</dt>
                  <dd className="text-white">{phoneInfo.verified_name}</dd>
                </>
              )}
              {phoneInfo.quality_rating && (
                <>
                  <dt className="text-slate-400">Quality rating</dt>
                  <dd className="text-white">{phoneInfo.quality_rating}</dd>
                </>
              )}
            </dl>
          )}

          <Link href={TENANTS_PATH} className={buttonVariants()}>
            <ExternalLink className="size-4" />
            {connected ? 'Manage on Tenants' : 'Connect on Tenants'}
          </Link>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base text-white">Webhook URL</CardTitle>
          <CardDescription className="text-slate-400">
            Use this callback URL in your Meta app&apos;s WhatsApp webhook
            settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="webhook-url" className="sr-only">
            Webhook URL
          </Label>
          <div className="flex gap-2">
            <Input
              id="webhook-url"
              readOnly
              value={webhookUrl}
              className="border-slate-700 bg-slate-800 text-slate-200"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyWebhookUrl}
              className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800"
            >
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
