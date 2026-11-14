import { describe, it, expect, vi } from "vitest";

const calls: string[] = [];
const convStatus = { value: "pending" as string };

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
  engineSendMedia: vi.fn(),
}));
vi.mock("./admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      calls.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({
        data: table === "conversations" ? { status: convStatus.value } : null,
      });
      return chain;
    },
  }),
}));

import { dispatchInboundToFlows } from "./engine";

describe("dispatchInboundToFlows while handed off", () => {
  it("consumes the message and touches no flow tables", async () => {
    calls.length = 0;
    const res = await dispatchInboundToFlows({
      userId: "u",
      contactId: "k",
      conversationId: "c",
      isFirstInboundMessage: false,
      message: { kind: "text", text: "hi", meta_message_id: "m1" },
    });
    expect(res).toEqual({ consumed: true, outcome: "human_handling" });
    expect(calls).toEqual(["conversations"]);
  });
});
