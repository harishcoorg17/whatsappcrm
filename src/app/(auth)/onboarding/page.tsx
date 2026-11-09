'use client';

import { Suspense } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast, Toaster } from 'sonner';
import { GRAPH_VERSION } from '@/lib/whatsapp/meta-config';
import {
  buildLoginExtras,
  parseEmbeddedSignupMessage,
} from '@/lib/whatsapp/embedded-signup';

declare global {
  interface Window {
    FB: {
      init: (opts: object) => void;
      login: (
        cb: (resp: { authResponse?: { code: string } }) => void,
        opts: object
      ) => void;
    };
    fbAsyncInit: () => void;
  }
}

type Step =
  | 'idle'
  | 'facebook'
  | 'saving'
  | 'done'
  | 'error'
  | 'manual'
  | 'saving_manual';

interface SignupResult {
  wabaId: string;
  phoneNumberId: string;
}

// Coexistence (connect an existing WhatsApp Business app number) is on unless
// explicitly disabled, matching the Embedded Signup configuration in Meta.
const COEXISTENCE_ENABLED =
  process.env.NEXT_PUBLIC_META_COEXISTENCE !== 'false';

// ES v4 posts the signup assets to the window; the FB.login callback carries the code.
interface EsAssets {
  wabaId?: string;
  phoneNumberId?: string;
  coexistence?: boolean;
}

function OnboardingContent() {
  const params = useSearchParams();
  const tenantSlug = params.get('tenant') ?? '';
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<SignupResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fbLoaded = useRef(false);
  // Captures WABA/phone IDs from the ES v4 postMessage event.
  const esData = useRef<EsAssets>({});
  // Manual credentials form state (fallback when META_CONFIG_ID is absent)
  const [manualFields, setManualFields] = useState({
    wabaId: '',
    phoneNumberId: '',
    accessToken: '',
  });

  const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID ?? '';
  const metaConfigId = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? '';

  useEffect(() => {
    if (fbLoaded.current || !metaAppId) return;
    fbLoaded.current = true;
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: metaAppId,
        cookie: true,
        xfbml: true,
        version: GRAPH_VERSION,
      });
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    document.body.appendChild(s);
  }, [metaAppId]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Accepts only https origins ending in facebook.com, as Meta documents.
      const msg = parseEmbeddedSignupMessage(event.origin, event.data);
      if (!msg) return;

      if (msg.kind === 'finish') {
        esData.current = {
          wabaId: msg.wabaId,
          phoneNumberId: msg.phoneNumberId,
          coexistence: msg.coexistence,
        };
        return;
      }
      if (msg.kind === 'cancel') {
        setStep('idle');
        toast.error('Signup cancelled');
        return;
      }
      setErrorMsg(msg.message ?? 'WhatsApp signup failed');
      setStep('error');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const saveManual = async () => {
    const { wabaId, phoneNumberId, accessToken } = manualFields;
    if (!wabaId.trim() || !phoneNumberId.trim() || !accessToken.trim()) {
      toast.error('All three fields are required');
      return;
    }
    setStep('saving_manual');
    try {
      const res = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug,
          wabaId: wabaId.trim(),
          phoneNumberId: phoneNumberId.trim(),
          accessToken: accessToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setResult({ wabaId: wabaId.trim(), phoneNumberId: phoneNumberId.trim() });
      setStep('done');
      toast.success('WhatsApp Business connected!');
    } catch (e: unknown) {
      setErrorMsg(
        e instanceof Error ? e.message : 'Failed to save credentials'
      );
      setStep('error');
    }
  };

  const launchSignup = () => {
    if (!window.FB) {
      toast.error('Facebook SDK not ready — please wait a moment');
      return;
    }
    if (!metaConfigId) {
      toast.error('META_CONFIG_ID not set — contact your admin');
      return;
    }
    setStep('facebook');
    esData.current = {};

    window.FB.login(
      (response) => {
        void (async () => {
          if (!response.authResponse?.code) {
            setStep('idle');
            toast.error('Signup cancelled');
            return;
          }
          setStep('saving');

          // ES v4: WABA/phone IDs come from the postMessage event. They are
          // only a claim: the server verifies them against what Meta granted
          // to the token, and discovers them itself if the event was missed.
          const { wabaId, phoneNumberId, coexistence } = esData.current;

          try {
            const res = await fetch('/api/whatsapp/embedded-signup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: response.authResponse.code,
                tenantSlug,
                wabaId,
                phoneNumberId,
                coexistence: coexistence ?? false,
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? 'Unknown error');
            setResult({
              wabaId: data.wabaId,
              phoneNumberId: data.phoneNumberId,
            });
            setStep('done');
            toast.success('WhatsApp Business connected!');
          } catch (e: unknown) {
            setErrorMsg(
              e instanceof Error ? e.message : 'Failed to save credentials'
            );
            setStep('error');
          }
        })();
      },
      {
        config_id: metaConfigId,
        response_type: 'code',
        override_default_response_type: true,
        extras: buildLoginExtras(COEXISTENCE_ENABLED),
      }
    );
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
      {step === 'done' && result ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Connected!</h2>
          <p className="text-sm text-slate-400">
            WhatsApp Business linked to{' '}
            <span className="font-mono text-white">/{tenantSlug}</span>
          </p>
          <div className="space-y-2 rounded-xl bg-slate-800/60 p-4 text-left text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">WABA ID</span>
              <span className="font-mono text-xs text-white">
                {result.wabaId}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Phone Number ID</span>
              <span className="font-mono text-xs text-white">
                {result.phoneNumberId}
              </span>
            </div>
          </div>
          <a
            href="/tenants"
            className="bg-primary hover:bg-primary/90 block w-full rounded-lg px-4 py-2 text-center text-sm font-medium text-white transition-colors"
          >
            Back to Tenants
          </a>
        </div>
      ) : step === 'error' ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/15">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Something went wrong</h2>
          <p className="text-sm text-slate-400">{errorMsg}</p>
          <Button
            variant="outline"
            onClick={() => setStep('idle')}
            className="w-full"
          >
            Try Again
          </Button>
        </div>
      ) : !metaConfigId || step === 'manual' ? (
        /* ── Manual credentials form (no META_CONFIG_ID or explicit fallback) ── */
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-white">Connect WhatsApp</h2>
            {tenantSlug && (
              <p className="mt-1 text-sm text-slate-400">
                Tenant:{' '}
                <span className="font-mono text-white">/{tenantSlug}</span>
              </p>
            )}
          </div>
          <p className="text-sm text-slate-400">
            Paste your credentials from{' '}
            <span className="text-white">
              Meta Business Manager → WhatsApp → API Setup
            </span>
            .
          </p>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-slate-300">
                WABA ID <span className="text-red-400">*</span>
              </label>
              <input
                value={manualFields.wabaId}
                onChange={(e) =>
                  setManualFields((f) => ({ ...f, wabaId: e.target.value }))
                }
                placeholder="e.g. 123456789012345"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-slate-300">
                Phone Number ID <span className="text-red-400">*</span>
              </label>
              <input
                value={manualFields.phoneNumberId}
                onChange={(e) =>
                  setManualFields((f) => ({
                    ...f,
                    phoneNumberId: e.target.value,
                  }))
                }
                placeholder="e.g. 987654321098765"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-slate-300">
                System User Access Token <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={manualFields.accessToken}
                onChange={(e) =>
                  setManualFields((f) => ({
                    ...f,
                    accessToken: e.target.value,
                  }))
                }
                placeholder="EAAxxxxxxxx…"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-slate-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500">
                Meta Business Manager → Settings → System Users → Generate Token
              </p>
            </div>
          </div>
          <Button
            onClick={saveManual}
            disabled={step === 'saving_manual'}
            className="w-full gap-2"
            size="lg"
          >
            {step === 'saving_manual' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {step === 'saving_manual' ? 'Saving…' : 'Save Credentials'}
          </Button>
          {metaAppId && metaConfigId === '' && (
            <p className="text-center text-xs text-slate-500">
              Want the guided Meta wizard?{' '}
              <button
                onClick={() => setStep('idle')}
                className="text-slate-400 underline hover:text-white"
              >
                Use Embedded Signup instead
              </button>
            </p>
          )}
        </div>
      ) : (
        /* ── ES wizard (META_CONFIG_ID is set) ── */
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-white">Connect WhatsApp</h2>
            {tenantSlug && (
              <p className="mt-1 text-sm text-slate-400">
                Tenant:{' '}
                <span className="font-mono text-white">/{tenantSlug}</span>
              </p>
            )}
          </div>
          <div className="space-y-3 text-sm text-slate-400">
            <p>
              Connect your WhatsApp Business Account via Meta&apos;s official
              Embedded Signup flow.
            </p>
            <ul className="list-disc space-y-1.5 pl-4 marker:text-slate-600">
              <li>Log in with your Facebook Business account</li>
              <li>Select or create your WhatsApp Business Account</li>
              <li>Verify your business phone number</li>
              <li>Credentials are AES-256-GCM encrypted at rest</li>
            </ul>
          </div>
          <Button
            onClick={launchSignup}
            disabled={step === 'facebook' || step === 'saving' || !metaAppId}
            className="w-full gap-2 bg-[#1877F2] text-white hover:bg-[#166FE5]"
            size="lg"
          >
            {(step === 'facebook' || step === 'saving') && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {step === 'saving'
              ? 'Saving credentials…'
              : step === 'facebook'
                ? 'Waiting for Meta…'
                : 'Continue with Facebook'}
          </Button>
          <p className="text-center text-xs text-slate-500">
            Don&apos;t have Meta Tech Provider access?{' '}
            <button
              onClick={() => setStep('manual')}
              className="text-slate-400 underline hover:text-white"
            >
              Enter credentials manually
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Toaster richColors />
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="from-primary shadow-primary/30 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br via-indigo-600 to-cyan-500 shadow-lg">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="text-lg leading-none font-bold text-white">
              Novacompass
            </p>
            <p className="text-xs text-slate-400">
              WhatsApp CRM · Tenant Onboarding
            </p>
          </div>
        </div>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            </div>
          }
        >
          <OnboardingContent />
        </Suspense>
      </div>
    </div>
  );
}
