import { describe, expect, it } from 'vitest';
import { reachableFromEntry, validateFlowForActivation } from './validate';
import {
  applyEdgeConnection,
  deriveCanvasEdges,
  outgoingSlots,
  unlinkNodeReferences,
} from './edges';
import type { BuilderNode } from '@/components/flows/shared';

const FLOW = {
  name: 'Tour lookup',
  trigger_type: 'keyword' as const,
  trigger_config: { keywords: ['tours'] },
  entry_node_id: 'start',
};

function fetchConfig(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://api.example.com/api/tours?search={{vars.dest}}&limit=5',
    items_path: 'data',
    item_template: '• {{item.title}}',
    max_items: 5,
    save_as: 'tours',
    empty_text: 'Nothing found.',
    success_next: 'show',
    failure_next: 'sorry',
    ...overrides,
  };
}

function graph(configOverrides: Record<string, unknown> = {}) {
  return [
    { node_key: 'start', node_type: 'start', config: { next_node_key: 'ask' } },
    {
      node_key: 'ask',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Where to?',
        var_key: 'dest',
        next_node_key: 'lookup',
      },
    },
    {
      node_key: 'lookup',
      node_type: 'http_fetch',
      config: fetchConfig(configOverrides),
    },
    {
      node_key: 'show',
      node_type: 'send_message',
      config: { text: '{{vars.tours}}', next_node_key: 'done' },
    },
    {
      node_key: 'sorry',
      node_type: 'send_message',
      config: { text: 'Please try later.', next_node_key: 'done' },
    },
    { node_key: 'done', node_type: 'end', config: {} },
  ];
}

function issuesFor(configOverrides: Record<string, unknown>) {
  return validateFlowForActivation(FLOW, graph(configOverrides)).filter(
    (i) => i.node_key === 'lookup'
  );
}

describe('validate — http_fetch', () => {
  it('accepts a well-formed http_fetch node', () => {
    expect(validateFlowForActivation(FLOW, graph())).toEqual([]);
  });

  it('requires a url', () => {
    expect(issuesFor({ url: '' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'url' })])
    );
  });

  it('accepts a {{api}}/… URL that resolves to the tenant API at run time', () => {
    expect(
      validateFlowForActivation(
        FLOW,
        graph({ url: '{{api}}/tours?search={{vars.dest}}' })
      )
    ).toEqual([]);
  });

  it('rejects {{api}} that is not followed by a path', () => {
    expect(issuesFor({ url: '{{api}}tours' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'url' })])
    );
  });

  it('requires https', () => {
    expect(issuesFor({ url: 'http://api.example.com/x' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'url', severity: 'error' }),
      ])
    );
  });

  it('rejects a placeholder in the host', () => {
    expect(issuesFor({ url: 'https://{{vars.dest}}.example.com/x' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'url' })])
    );
  });

  it('requires a valid save_as variable name', () => {
    expect(issuesFor({ save_as: '' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'save_as' })])
    );
    expect(issuesFor({ save_as: '9bad key' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'save_as' })])
    );
  });

  it('requires an item template', () => {
    expect(issuesFor({ item_template: '  ' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'item_template' }),
      ])
    );
  });

  it('requires both exits and that they exist', () => {
    expect(issuesFor({ success_next: '' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'success_next' }),
      ])
    );
    expect(issuesFor({ failure_next: 'ghost' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'failure_next' }),
      ])
    );
  });

  it('follows both exits when checking reachability', () => {
    const reached = reachableFromEntry('start', graph());
    expect(reached.has('show')).toBe(true);
    expect(reached.has('sorry')).toBe(true);
  });
});

const NODE: BuilderNode = {
  node_key: 'lookup',
  node_type: 'http_fetch',
  config: fetchConfig(),
} as BuilderNode;

describe('edges — http_fetch', () => {
  it('derives labelled success and failure edges', () => {
    const edges = deriveCanvasEdges([
      NODE,
      { node_key: 'show', node_type: 'end', config: {} } as BuilderNode,
      { node_key: 'sorry', node_type: 'end', config: {} } as BuilderNode,
    ]);
    expect(edges).toEqual([
      expect.objectContaining({
        source: 'lookup',
        target: 'show',
        sourceHandle: 'success',
        label: 'success',
      }),
      expect.objectContaining({
        source: 'lookup',
        target: 'sorry',
        sourceHandle: 'failure',
        label: 'failure',
      }),
    ]);
  });

  it('exposes success and failure slots', () => {
    expect(outgoingSlots(NODE).map((s) => s.id)).toEqual([
      'success',
      'failure',
    ]);
  });

  it('patches the matching exit when connecting', () => {
    expect(applyEdgeConnection(NODE, 'success', 'x')).toEqual({
      success_next: 'x',
    });
    expect(applyEdgeConnection(NODE, 'failure', 'y')).toEqual({
      failure_next: 'y',
    });
    expect(applyEdgeConnection(NODE, 'next', 'z')).toBeNull();
  });

  it('clears references to a deleted node', () => {
    const [patched] = unlinkNodeReferences([NODE], 'show');
    expect((patched.config as { success_next: string }).success_next).toBe('');
    expect((patched.config as { failure_next: string }).failure_next).toBe(
      'sorry'
    );
  });
});
