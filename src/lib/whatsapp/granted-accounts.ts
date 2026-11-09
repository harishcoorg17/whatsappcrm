/**
 * Reads which WhatsApp accounts a Meta access token can reach.
 *
 * `debug_token` lists the accounts a token was granted under
 * `granular_scopes`. A number can be linked to several account records, so
 * subscribing the app on every reachable account is how the CRM makes sure the
 * number's events are routed to it.
 */

export interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
}

const ACCOUNT_SCOPES = new Set([
  'whatsapp_business_management',
  'whatsapp_business_messaging',
]);

/**
 * The account ids granted to a token issued to `appId`, de-duplicated.
 * Returns null when the token is invalid or was issued to a different app, so
 * the caller never subscribes the wrong app on the strength of a foreign token.
 */
export function accountIdsFromDebugToken(
  response: DebugTokenResponse,
  appId: string
): string[] | null {
  const data = response.data;
  if (!data?.is_valid || data.app_id !== appId) return null;

  const ids = (data.granular_scopes ?? [])
    .filter((scope) => ACCOUNT_SCOPES.has(scope.scope))
    .flatMap((scope) => scope.target_ids ?? []);

  return Array.from(new Set(ids));
}
