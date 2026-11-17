import { describe, expect, it } from 'vitest';
import { listFlowTemplates, getFlowTemplate } from './templates';
import { reachableFromEntry, validateFlowForActivation } from './validate';

const TERMINAL = new Set(['end', 'handoff']);

function edgesOf(node: {
  node_type: string;
  config: Record<string, unknown>;
}): string[] {
  const c = node.config as Record<string, unknown>;
  const out: string[] = [];
  for (const k of [
    'next_node_key',
    'true_next',
    'false_next',
    'success_next',
    'failure_next',
  ]) {
    if (typeof c[k] === 'string') out.push(c[k] as string);
  }
  for (const b of (c.buttons as Array<{ next_node_key: string }>) ?? [])
    out.push(b.next_node_key);
  for (const s of (c.sections as Array<{
    rows: Array<{ next_node_key: string }>;
  }>) ?? [])
    for (const r of s.rows) out.push(r.next_node_key);
  return out;
}

const ALLOWED_TYPES = new Set([
  'start',
  'send_message',
  'send_buttons',
  'send_list',
  'send_media',
  'collect_input',
  'condition',
  'http_fetch',
  'set_tag',
  'handoff',
  'end',
]);

const templates = listFlowTemplates();

describe('flow template library', () => {
  it('ships at least 6 industry templates beyond the general ones', () => {
    expect(
      templates.filter((t) => t.industry !== 'general').length
    ).toBeGreaterThanOrEqual(6);
  });

  it('has unique slugs and resolves each via getFlowTemplate', () => {
    const slugs = templates.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of templates) expect(getFlowTemplate(t.slug)).toBe(t);
  });

  describe.each(templates.map((t) => [t.slug, t] as const))(
    '%s',
    (_slug, t) => {
      const nodes = t.nodes as Array<{
        node_key: string;
        node_type: string;
        config: Record<string, unknown>;
      }>;
      const byKey = new Map(nodes.map((n) => [n.node_key, n]));

      it('passes the activation validator with no errors', () => {
        const issues = validateFlowForActivation(
          {
            name: t.name,
            trigger_type: t.trigger_type,
            trigger_config: t.trigger_config as Record<string, unknown>,
            entry_node_id: t.entry_node_id,
          },
          nodes
        );
        expect(issues).toEqual([]);
      });

      it('uses only supported node types, has an entry node, no dangling edges', () => {
        expect(byKey.has(t.entry_node_id)).toBe(true);
        for (const n of nodes) {
          expect(ALLOWED_TYPES.has(n.node_type)).toBe(true);
          for (const next of edgesOf(n))
            expect(byKey.has(next), `${n.node_key} -> ${next}`).toBe(true);
        }
      });

      it('reaches every node and every path terminates', () => {
        expect(reachableFromEntry(t.entry_node_id, nodes).size).toBe(
          nodes.length
        );
        // Cycle check: DFS must never revisit a node on the current path.
        const visiting = new Set<string>();
        const done = new Set<string>();
        const dfs = (key: string) => {
          if (done.has(key)) return;
          expect(visiting.has(key), `cycle at ${key}`).toBe(false);
          visiting.add(key);
          const n = byKey.get(key)!;
          const next = edgesOf(n);
          if (next.length === 0)
            expect(TERMINAL.has(n.node_type), `${key} dead-ends`).toBe(true);
          next.forEach(dfs);
          visiting.delete(key);
          done.add(key);
        };
        dfs(t.entry_node_id);
      });

      if (t.industry !== 'general') {
        it('offers "Talk to a person" wired to a handoff with a message', () => {
          const menuRows = nodes
            .filter(
              (n) =>
                n.node_type === 'send_list' || n.node_type === 'send_buttons'
            )
            .flatMap((n) => [
              ...((n.config.buttons as Array<{
                reply_id: string;
                next_node_key: string;
              }>) ?? []),
              ...(
                (n.config.sections as Array<{
                  rows: Array<{ reply_id: string; next_node_key: string }>;
                }>) ?? []
              ).flatMap((s) => s.rows),
            ]);
          const talk = menuRows.find(
            (r) => r.reply_id === 'talk_to_agent' || r.reply_id === 'human'
          );
          expect(talk).toBeDefined();
          const target = byKey.get(talk!.next_node_key)!;
          expect(target.node_type).toBe('handoff');
          expect((target.config.message as string)?.trim()).toBeTruthy();
        });
      }
    }
  );
});
