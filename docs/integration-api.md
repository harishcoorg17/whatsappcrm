# Integration API: send WhatsApp templates from another system

The Amstago backend (or any server) asks the CRM to send an **approved**
WhatsApp template. The CRM sends from the tenant's own WhatsApp number, saves
the message in the inbox, and records delivery status through its webhook, so
one number, one token and one inbox cover everything.

## Setup (once per tenant)

1. Apply `supabase/migrations/026_integration_api.sql` to the CRM database.
2. Create a key (as the tenant owner or a platform admin, signed in to the CRM):

   ```js
   // Browser console on the CRM, while signed in
   fetch('/api/tenants/<tenant-slug>/api-keys', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ label: 'Amstago backend' }),
   }).then((r) => r.json()).then(console.log);
   ```

   The response contains `key` (`amst_live_…`). **It is shown once.** Only a
   hash is stored. Put it in the backend's secret store, never in source.

   - `GET /api/tenants/<slug>/api-keys` lists keys (prefix, last used, revoked).
   - `DELETE /api/tenants/<slug>/api-keys?id=<id>` revokes one.

## Send a template

`POST https://whatsapp.amstago.com/api/integrations/send-template`

```
Authorization: Bearer amst_live_…
Content-Type: application/json
```

```json
{
  "to": "+919876543210",
  "template_name": "tour_purchase_confirmation",
  "language": "en_US",
  "reference": "booking-123:confirmation",
  "params": ["Asha", "Kerala Hills & Backwaters", "14–18 Dec 2026", "2 adults", "AMS-10482", "₹29,404"],
  "contact_name": "Asha Rao"
}
```

| Field | Required | Notes |
|---|---|---|
| `to` | yes | Phone number; formatting is cleaned up. |
| `template_name` | yes | Exactly as on Meta (lowercase, digits, underscores). |
| `language` | no | Default `en_US`. `en` and `en_US` are different templates on Meta. |
| `reference` | yes | **Your** unique id for this message, up to 128 chars. |
| `params` | if the template has variables | One string per body `{{n}}`, in order. The count must match. |
| `header_text` | no | Only for a template whose header has a variable. |
| `button_params` | no | `{ "1": "value" }` for a URL button with a `{{1}}` suffix. |
| `contact_name` | no | Used when the customer is new to the CRM. |

### `reference` makes retries safe

Use one reference per message, for example `booking-123:confirmation` and
`booking-123:group-notice`. Sending the same reference again does **not**
message the customer again; the response is `status: "duplicate"` with the
original ids. A reference whose earlier attempt **failed** is retried.

### Responses

Success (HTTP 200):

```json
{ "ok": true, "status": "sent", "message_id": "wamid…", "conversation_id": "…" }
```

`status` is `sent` or `duplicate`.

Errors: `{ "ok": false, "error": { "code": "…", "message": "…" } }`

| HTTP | `code` | Meaning |
|---|---|---|
| 401 | `unauthorized` | Missing, wrong or revoked key, or tenant suspended. |
| 400 | `invalid_json`, `invalid_request` | Malformed body; the message names the field. |
| 404 | `template_not_found` | No such template and language for this tenant. |
| 409 | `template_not_approved` | Template is DRAFT, PENDING, REJECTED, PAUSED or DISABLED. |
| 409 | `whatsapp_not_connected` | The tenant has no connected number. |
| 422 | `invalid_params` | Wrong number of `params` for the template body. |
| 422 | `invalid_phone` | Not a valid phone number. |
| 429 | | Over 120 requests a minute for this key. Honour `Retry-After`. |
| 502 | `send_failed` | Meta rejected the send (for example an unapproved or paused template). |

Treat 5xx and 429 as retryable with the **same** `reference`. Treat other 4xx as
a bug in the request.

## Suggested event map (backend side)

| Backend event | Template | `reference` |
|---|---|---|
| Booking paid | `tour_purchase_confirmation` | `booking-<id>:confirmation` |
| Group created for the booking | `tour_group_invite_notice` | `booking-<id>:group-notice` |
| Balance due | `payment_pending_reminder` | `booking-<id>:balance-<date>` |
| Payment failed | `payment_failed` | `payment-<id>:failed` |

## Notes

- The tenant, number and templates come from the key, never from the request.
- Only `APPROVED` templates are sent. A template that Meta later pauses or
  rejects is refused with `template_not_approved` instead of failing at Meta.
- Marketing templates should only go to customers who opted in; that choice is
  the caller's to make.
