import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { StoreDeps } from './handle-webhook';
import { createSupabaseStoreRepo } from './repo';

export function createStoreDeps(): StoreDeps {
  return {
    repo: createSupabaseStoreRepo(supabaseAdmin()),
    decrypt,
    runAutomations: runAutomationsForTrigger,
    now: () => new Date(),
  };
}
