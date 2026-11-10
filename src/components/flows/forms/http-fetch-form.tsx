'use client';

/**
 * Config form for the `http_fetch` node: call a read-only JSON API and
 * store a rendered summary in a variable for later messages.
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { BuilderNode } from '../shared';
import { NextNodeRow, TextRow } from './fields';

export interface HttpFetchCfg {
  url?: string;
  items_path?: string;
  item_template?: string;
  max_items?: number;
  save_as?: string;
  empty_text?: string;
  success_next?: string;
  failure_next?: string;
  capture?: Record<string, string>;
}

const MIN_ITEMS = 1;
const MAX_ITEMS = 10;
const DEFAULT_ITEMS = 5;

function captureToText(capture: Record<string, string> | undefined): string {
  return Object.entries(capture ?? {})
    .map(([key, path]) => `${key}=${path}`)
    .join('\n');
}

/** One `variable=field` pair per line; lines without a name and field are skipped. */
function parseCaptureText(text: string): Record<string, string> {
  const capture: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const path = line.slice(separator + 1).trim();
    if (key && path) capture[key] = path;
  }
  return capture;
}

export function HttpFetchForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: HttpFetchCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const saveAs = cfg.save_as || 'results';
  // Held as text while typing so half-written lines are not lost; the parsed
  // pairs are what gets saved. The caller keys this form by node.
  const [captureText, setCaptureText] = useState(captureToText(cfg.capture));

  return (
    <>
      <div>
        <label className="mb-1 block text-xs text-slate-400">
          URL to call (GET, https only)
        </label>
        <Input
          value={cfg.url ?? ''}
          onChange={(e) => onUpdateConfig({ url: e.target.value })}
          placeholder="{{api}}/tours?search={{vars.destination}}"
          className="bg-slate-800 font-mono text-xs"
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Start with{' '}
          <code className="rounded bg-slate-800 px-1">{'{{api}}/'}</code> to
          call each business&apos;s own backend (set per business under Tenants
          → Backend API). Other https hosts must be on the server&apos;s
          allow-list. Customer answers can be used after the host as{' '}
          <code className="rounded bg-slate-800 px-1">{'{{vars.name}}'}</code>{' '}
          and are URL-encoded automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Where the list is in the response
          </label>
          <Input
            value={cfg.items_path ?? ''}
            onChange={(e) =>
              onUpdateConfig({
                items_path: e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''),
              })
            }
            placeholder="data"
            className="bg-slate-800 font-mono text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Max items to show ({MIN_ITEMS}–{MAX_ITEMS})
          </label>
          <Input
            type="number"
            min={MIN_ITEMS}
            max={MAX_ITEMS}
            value={cfg.max_items ?? DEFAULT_ITEMS}
            onChange={(e) =>
              onUpdateConfig({
                max_items: Math.min(
                  Math.max(Number(e.target.value) || DEFAULT_ITEMS, MIN_ITEMS),
                  MAX_ITEMS
                ),
              })
            }
            className="bg-slate-800 text-xs"
          />
        </div>
      </div>

      <TextRow
        label="How each item is written (use {{item.field}})"
        value={cfg.item_template ?? ''}
        onChange={(v) => onUpdateConfig({ item_template: v })}
        rows={2}
      />

      <div>
        <label className="mb-1 block text-xs text-slate-400">
          Variable key for the result (alphanumeric + underscore)
        </label>
        <Input
          value={cfg.save_as ?? ''}
          onChange={(e) =>
            onUpdateConfig({
              save_as: e.target.value.replace(/[^a-zA-Z0-9_]/g, ''),
            })
          }
          placeholder="e.g. tours"
          className="bg-slate-800 font-mono text-xs"
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Show it in a later message with{' '}
          <code className="rounded bg-slate-800 px-1">
            {`{{vars.${saveAs}}}`}
          </code>
          ; the number of items is in{' '}
          <code className="rounded bg-slate-800 px-1">
            {`{{vars.${saveAs}_count}}`}
          </code>
          .
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">
          Also remember from the first result (optional, one per line)
        </label>
        <Textarea
          value={captureText}
          onChange={(e) => {
            setCaptureText(e.target.value);
            onUpdateConfig({ capture: parseCaptureText(e.target.value) });
          }}
          rows={2}
          placeholder={'destination_id=id\nslug=slug'}
          className="bg-slate-800 font-mono text-xs"
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Format{' '}
          <code className="rounded bg-slate-800 px-1">variable=field</code>. Use
          it to pass an id to the next lookup, for example{' '}
          <code className="rounded bg-slate-800 px-1">
            {'{{api}}/…/{{vars.destination_id}}/spots'}
          </code>
          . Cleared when nothing is found.
        </p>
      </div>

      <TextRow
        label="Text to use when nothing is found"
        value={cfg.empty_text ?? ''}
        onChange={(v) => onUpdateConfig({ empty_text: v })}
        rows={2}
      />

      <NextNodeRow
        value={cfg.success_next ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ success_next: v })}
        label="On success (including “nothing found”), go to"
      />
      <NextNodeRow
        value={cfg.failure_next ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ failure_next: v })}
        label="If the call fails or times out, go to"
      />
    </>
  );
}
