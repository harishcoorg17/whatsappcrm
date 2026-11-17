import type { SupabaseClient } from '@supabase/supabase-js';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import type {
  DueStoreEvent,
  NewStoreEvent,
  StoreConnection,
  StoreRepo,
  StoredEventPayload,
} from './handle-webhook';
import type { StorePlatform, StoreTrigger } from './events';

const UNIQUE_VIOLATION = '23505';
const PHONE_TAIL_LENGTH = 5;

interface ConnectionRow {
  id: string;
  tenant_id: string;
  platform: StorePlatform;
  shop_domain: string;
  secret_enc: string;
  default_country_code: string;
  abandoned_after_minutes: number;
  enabled: boolean;
  crm_tenants: { owner_user_id: string | null; status: string } | null;
}

const CONNECTION_SELECT =
  'id, tenant_id, platform, shop_domain, secret_enc, default_country_code, abandoned_after_minutes, enabled, crm_tenants(owner_user_id, status)';

function toConnection(row: ConnectionRow): StoreConnection | null {
  const owner = row.crm_tenants?.owner_user_id;
  if (!row.enabled || !owner) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerUserId: owner,
    platform: row.platform,
    shopDomain: row.shop_domain,
    secretEnc: row.secret_enc,
    defaultCountryCode: row.default_country_code,
    abandonedAfterMinutes: row.abandoned_after_minutes,
  };
}

export function createSupabaseStoreRepo(db: SupabaseClient): StoreRepo {
  return {
    async loadConnection(platform, publicId) {
      const { data } = await db
        .from('crm_store_connections')
        .select(CONNECTION_SELECT)
        .eq('platform', platform)
        .eq('public_id', publicId)
        .maybeSingle();
      return data ? toConnection(data as unknown as ConnectionRow) : null;
    },

    async claimEvent(event: NewStoreEvent) {
      const { error } = await db.from('crm_store_events').insert({
        connection_id: event.connectionId,
        tenant_id: event.tenantId,
        dedupe_key: event.dedupeKey,
        topic: event.topic,
        trigger_type: event.trigger,
        checkout_token: event.checkoutToken,
        status: event.status,
        fire_at: event.fireAt,
        payload: event.payload,
        error: event.error ?? null,
      });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`could not record store event: ${error.message}`);
    },

    async cancelPendingCarts(connectionId, checkoutToken) {
      await db
        .from('crm_store_events')
        .update({ status: 'cancelled' })
        .eq('connection_id', connectionId)
        .eq('checkout_token', checkoutToken)
        .eq('trigger_type', 'cart_abandoned')
        .eq('status', 'pending');
    },

    async setEventStatus(connectionId, dedupeKey, status, error) {
      await db
        .from('crm_store_events')
        .update({ status, error: error ?? null })
        .eq('connection_id', connectionId)
        .eq('dedupe_key', dedupeKey);
    },

    async touchConnection(connectionId) {
      await db
        .from('crm_store_connections')
        .update({ last_event_at: new Date().toISOString() })
        .eq('id', connectionId);
    },

    async findOrCreateContact(connection, phone, name) {
      const { data: exact } = await db
        .from('contacts')
        .select('id, phone')
        .eq('user_id', connection.ownerUserId)
        .eq('tenant_id', connection.tenantId)
        .in('phone', [phone, `+${phone}`]);
      const hit = (exact as Array<{ id: string }> | null)?.[0];
      if (hit) return hit.id;

      const { data: similar } = await db
        .from('contacts')
        .select('id, phone')
        .eq('user_id', connection.ownerUserId)
        .eq('tenant_id', connection.tenantId)
        .like('phone', `%${phone.slice(-PHONE_TAIL_LENGTH)}`);
      const match = (similar as Array<{ id: string; phone: string }> | null)?.find(
        (c) => phonesMatch(c.phone, phone)
      );
      if (match) return match.id;

      const { data: created, error } = await db
        .from('contacts')
        .insert({
          user_id: connection.ownerUserId,
          tenant_id: connection.tenantId,
          phone: `+${phone}`,
          name: name?.trim() || `+${phone}`,
        })
        .select('id')
        .single();
      if (error || !created) {
        throw new Error(`could not create contact: ${error?.message ?? 'no row'}`);
      }
      return (created as { id: string }).id;
    },

    async claimDueCarts(nowIso, limit) {
      const { data: due } = await db
        .from('crm_store_events')
        .select('id, dedupe_key, trigger_type, payload, connection_id')
        .eq('status', 'pending')
        .lte('fire_at', nowIso)
        .order('fire_at', { ascending: true })
        .limit(limit);
      const rows =
        (due as Array<{
          id: string;
          dedupe_key: string;
          trigger_type: StoreTrigger;
          payload: StoredEventPayload;
          connection_id: string;
        }> | null) ?? [];

      const claimed: DueStoreEvent[] = [];
      for (const row of rows) {
        // Compare-and-set so two overlapping cron runs never send twice.
        const { data: won } = await db
          .from('crm_store_events')
          .update({ status: 'processing' })
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('id');
        if (!won || won.length === 0) continue;

        const { data: conn } = await db
          .from('crm_store_connections')
          .select(CONNECTION_SELECT)
          .eq('id', row.connection_id)
          .maybeSingle();
        const connection = conn ? toConnection(conn as unknown as ConnectionRow) : null;
        if (!connection) {
          await db
            .from('crm_store_events')
            .update({ status: 'cancelled', error: 'store disconnected' })
            .eq('id', row.id);
          continue;
        }
        claimed.push({
          connection,
          dedupeKey: row.dedupe_key,
          trigger: row.trigger_type,
          payload: row.payload,
        });
      }
      return claimed;
    },
  };
}
