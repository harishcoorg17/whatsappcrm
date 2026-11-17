'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Plug, ShoppingBag, Store, Trash2 } from 'lucide-react';
import { useTenant } from '@/hooks/use-tenant';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Platform = 'shopify' | 'woocommerce';

interface StoreRow {
  id: string;
  platform: Platform;
  shop_domain: string;
  webhook_url: string;
  default_country_code: string;
  abandoned_after_minutes: number;
  enabled: boolean;
  last_event_at: string | null;
}

interface Revealed {
  storeId: string;
  secret: string | null;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
};

const SETUP_STEPS: Record<Platform, string[]> = {
  shopify: [
    'In Shopify admin open Settings → Notifications → Webhooks.',
    'Create a webhook for each event: Order creation, Order fulfillment, Checkout creation. Format JSON.',
    'Paste the webhook URL above as the URL for all three.',
    'The signing key you entered when connecting is shown at the bottom of that page.',
  ],
  woocommerce: [
    'In WordPress open WooCommerce → Settings → Advanced → Webhooks → Add webhook.',
    'Create two webhooks: topic "Order created" and topic "Order updated". Status: Active.',
    'Paste the delivery URL and the secret above into both.',
    'Order updated fires the "Order fulfilled" trigger once an order is marked Completed.',
  ],
};

async function api<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? 'Request failed' };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

function CopyField({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  };
  return (
    <div className="space-y-1">
      <Label className="text-slate-300 text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="bg-slate-800 border-slate-700 text-white font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="border-slate-700 text-slate-300 shrink-0"
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Connect a Shopify or WooCommerce store so order events message customers. */
export function StoreIntegrations() {
  const { selectedTenant, loading: tenantLoading } = useTenant();
  const slug = selectedTenant?.slug ?? null;

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platform, setPlatform] = useState<Platform>('shopify');
  const [domain, setDomain] = useState('');
  const [secret, setSecret] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const res = await api<{ stores: StoreRow[] }>(`/api/tenants/${slug}/stores`);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setStores(res.data.stores);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setSaving(true);
    const res = await api<{ store: StoreRow; secret: string | null }>(
      `/api/tenants/${slug}/stores`,
      {
        method: 'POST',
        body: JSON.stringify({
          platform,
          shopDomain: domain,
          secret: platform === 'shopify' ? secret : undefined,
          abandonedAfterMinutes: Number(minutes),
        }),
      }
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${PLATFORM_LABEL[platform]} store connected`);
    setRevealed({ storeId: res.data.store.id, secret: res.data.secret });
    setDomain('');
    setSecret('');
    await load();
  };

  const toggle = async (store: StoreRow, enabled: boolean) => {
    if (!slug) return;
    const res = await api(`/api/tenants/${slug}/stores/${store.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return void toast.error(res.error);
    setStores((prev) => prev.map((s) => (s.id === store.id ? { ...s, enabled } : s)));
  };

  const disconnect = async (store: StoreRow) => {
    if (!slug) return;
    if (!window.confirm(`Disconnect ${store.shop_domain}? Its webhooks will stop working.`)) return;
    const res = await api(`/api/tenants/${slug}/stores/${store.id}`, { method: 'DELETE' });
    if (!res.ok) return void toast.error(res.error);
    setStores((prev) => prev.filter((s) => s.id !== store.id));
    setRevealed((r) => (r?.storeId === store.id ? null : r));
  };

  if (tenantLoading || (loading && slug)) {
    return (
      <div className="flex items-center gap-2 py-10 text-slate-400 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!slug) {
    return (
      <p className="py-10 text-sm text-slate-400">
        Set up your workspace first to connect a store.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Store integrations</h2>
        <p className="text-sm text-slate-400">
          Send WhatsApp messages when a Shopify or WooCommerce store gets an order, ships
          one, or a checkout is abandoned. Then build the message in Automations using the
          Order placed / Order fulfilled / Cart abandoned triggers.
        </p>
      </div>

      {stores.map((store) => {
        const isRevealed = revealed?.storeId === store.id;
        return (
          <Card key={store.id} className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {store.platform === 'shopify' ? <ShoppingBag className="size-4" /> : <Store className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{store.shop_domain}</p>
                  <p className="text-xs text-slate-400">
                    {PLATFORM_LABEL[store.platform]} ·{' '}
                    {store.last_event_at
                      ? `last event ${new Date(store.last_event_at).toLocaleString()}`
                      : 'no events received yet'}
                  </p>
                </div>
                <Switch
                  checked={store.enabled}
                  onCheckedChange={(v) => toggle(store, v)}
                  aria-label={`${store.enabled ? 'Pause' : 'Enable'} ${store.shop_domain}`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => disconnect(store)}
                  aria-label={`Disconnect ${store.shop_domain}`}
                  className="text-slate-400 hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <CopyField
                label={store.platform === 'shopify' ? 'Webhook URL' : 'Delivery URL'}
                value={store.webhook_url}
              />
              {isRevealed && revealed?.secret && (
                <div className="space-y-1">
                  <CopyField label="Webhook secret" value={revealed.secret} />
                  <p className="text-xs text-amber-500">
                    Copy this secret now. It is shown only once.
                  </p>
                </div>
              )}

              <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-400">
                {SETUP_STEPS[store.platform].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {store.platform === 'shopify' && (
                <p className="text-xs text-slate-500">
                  Abandoned carts are sent {store.abandoned_after_minutes} minutes after checkout
                  starts, if the order is not completed. Requires the stores cron (see docs).
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardContent className="pt-4">
          <form onSubmit={connect} className="space-y-4">
            <div className="flex items-center gap-2 text-white">
              <Plug className="size-4 text-primary" />
              <span className="text-sm font-medium">Connect a store</span>
            </div>

            <div className="flex gap-2" role="radiogroup" aria-label="Platform">
              {(['shopify', 'woocommerce'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={platform === p}
                  onClick={() => setPlatform(p)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    platform === p
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor="store-domain" className="text-slate-300 text-xs">
                Store domain
              </Label>
              <Input
                id="store-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={platform === 'shopify' ? 'mystore.myshopify.com' : 'shop.example.com'}
                className="bg-slate-800 border-slate-700 text-white"
                required
              />
            </div>

            {platform === 'shopify' && (
              <div className="space-y-1">
                <Label htmlFor="store-secret" className="text-slate-300 text-xs">
                  Webhook signing key
                </Label>
                <Input
                  id="store-secret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="From Shopify → Settings → Notifications → Webhooks"
                  className="bg-slate-800 border-slate-700 text-white"
                  required
                />
              </div>
            )}

            {platform === 'shopify' && (
              <div className="space-y-1">
                <Label htmlFor="store-minutes" className="text-slate-300 text-xs">
                  Abandoned cart after (minutes)
                </Label>
                <Input
                  id="store-minutes"
                  type="number"
                  min={5}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-32 bg-slate-800 border-slate-700 text-white"
                />
              </div>
            )}

            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Connect store
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
