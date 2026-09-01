import { describe, expect, it } from "vitest";

import { HashingEmbedder, cosine } from "../src/knowledge/embeddings.js";
import { buildKnowledgeBase } from "../src/knowledge/index.js";
import { VectorStore } from "../src/knowledge/vectorStore.js";

describe("HashingEmbedder", () => {
  it("is deterministic and L2-normalized", () => {
    const embedder = new HashingEmbedder(256);
    const a = embedder.embed("international roaming");
    const b = embedder.embed("international roaming");
    expect(cosine(a, b)).toBeCloseTo(1, 5);
  });

  it("scores related text higher than unrelated text", () => {
    const embedder = new HashingEmbedder();
    const query = embedder.embed("how do I pay my bill");
    const related = embedder.embed("pay an invoice by Pix or credit card");
    const unrelated = embedder.embed("international roaming daily pass");
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});

describe("VectorStore retrieval", () => {
  const store = buildKnowledgeBase();

  it("retrieves the payment article for a billing question", () => {
    const [top] = store.search("how can I pay my invoice", 3);
    expect(top?.id).toBe("kb-pay-invoice");
  });

  it("retrieves the roaming article for a travel question", () => {
    const [top] = store.search("using my phone abroad while traveling", 3);
    expect(top?.id).toBe("kb-roaming");
  });

  it("retrieves the plan-change article", () => {
    const [top] = store.search("can I upgrade my plan", 3);
    expect(top?.id).toBe("kb-plan-change");
  });

  it("returns nothing for a query with no shared vocabulary", () => {
    const empty = new VectorStore(new HashingEmbedder());
    expect(empty.search("anything", 3)).toEqual([]);
  });

  it("MMR does not return duplicate top passages", () => {
    const results = store.search("plan data allowance rollover", 3, { mmr: true });
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
