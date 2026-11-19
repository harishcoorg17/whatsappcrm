# ConverMesh

A WhatsApp CRM: shared inbox, contacts, sales pipelines, broadcasts and
no-code automations, built on Next.js and Supabase.

> ConverMesh is built on [wacrm](https://github.com/ArnasDon/wacrm) by Arnas
> Donauskas, used under the MIT License. See [`NOTICE.md`](./NOTICE.md) and
> [`LICENSE`](./LICENSE). "WhatsApp" and "Meta" are trademarks of Meta
> Platforms, Inc.; this project is not affiliated with or endorsed by Meta.

## What it does

- **Shared inbox** on the official WhatsApp Business API, with
  per-conversation assignment, status and notes.
- **Contacts** with tags, custom fields, CSV import and deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with Meta-approved templates and delivery tracking.
- **Automations (flows)**: triggers on messages, new contacts, keywords or a
  schedule, with conditions, waits and webhooks.
- **Integration API** for server-to-server use (send a template, add a quote
  enquiry to a pipeline). See [`docs/integration-api.md`](./docs/integration-api.md).

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase and Meta credentials
npm run dev
```

Open <http://localhost:3000>. Apply the SQL files in `supabase/migrations/`
to your Supabase project first. More detail is in [`docs/`](./docs).

## Stack

- **App:** Next.js (App Router), React, TypeScript, Tailwind.
- **Data:** Supabase (Postgres, Auth, Storage, row-level security).
- **WhatsApp:** Meta Cloud API.

## License

[MIT](./LICENSE). Original copyright Arnas Donauskas; see
[`NOTICE.md`](./NOTICE.md).
