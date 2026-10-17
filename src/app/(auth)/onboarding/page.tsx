'use client';

import { Suspense } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast, Toaster } from 'sonner';

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

type Step = 'idle' | 'facebook' | 'saving' | 'done' | 'error';

interface SignupResult {
  wabaId: string;
  phoneNumberId: string;
}

// ES v4 sends WABA/phone IDs via postMessage before the FB.login callback fires.
interface EsMessageData {
  type: string;
  event: string;
  data?: { waba_id?: string; phone_number_id?: string };
}

function OnboardingContent() {
  const params = useSearchParams();
  const tenantSlug = params.get('tenant') ?? '';
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<SignupResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fbLoaded = useRef(false);
  // Captures WABA/phone IDs from the ES v4 postMessage event.
  const esData = useRef<{ waba_id?: string; phone_number_id?: string }>({});

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
        version: 'v21.0',
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
      if (event.origin !== 'https://www.facebook.com') return;
      try {
        const msg = (
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        ) as EsMessageData;
        if (
          msg.type === 'WA_EMBEDDED_SIGNUP' &&
          msg.event === 'FINISH' &&
          msg.data
        ) {
          esData.current = {
            waba_id: msg.data.waba_id,
            phone_number_id: msg.data.phone_number_id,
          };
        }
      } catch {
        // ignore non-JSON messages
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

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

          // ES v4: WABA/phone IDs come from the postMessage event (esData.current).
          // ES v3 fallback: they come from session_info in the authResponse.
          const sessionInfo = (response.authResponse as Record<string, unknown>)
            .session_info as
            | { waba_id?: string; phone_number_id?: string }
            | undefined;

          const wabaId = esData.current.waba_id ?? sessionInfo?.waba_id;
          const phoneNumberId =
            esData.current.phone_number_id ?? sessionInfo?.phone_number_id;

          try {
            const res = await fetch('/api/whatsapp/embedded-signup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: response.authResponse.code,
                tenantSlug,
                wabaId,
                phoneNumberId,
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
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
          version: 'v4',
        },
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
      ) : (
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
            disabled={
              step === 'facebook' ||
              step === 'saving' ||
              !metaAppId ||
              !metaConfigId
            }
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
          {!metaConfigId && (
            <p className="text-center text-xs text-amber-500">
              NEXT_PUBLIC_META_CONFIG_ID not set — requires Meta Tech Provider
              approval.
            </p>
          )}
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
