import { cosine, type Embedder } from "./embeddings.js";

export interface Document {
  id: string;
  title: string;
  text: string;
}

export interface RetrievedPassage {
  id: string;
  title: string;
  text: string;
  score: number;
}

interface IndexedDocument extends Document {
  vector: Float32Array;
}

/**
 * In-memory vector store with cosine retrieval and optional MMR re-ranking.
 *
 * MMR (maximal marginal relevance) trades a little relevance for diversity so the top
 * passages are not near-duplicates of each other — useful when several documents cover
 * the same topic. On AWS this store is a managed vector database (OpenSearch / pgvector
 * on RDS); the retrieval contract is the same.
 */
export class VectorStore {
  private readonly documents: IndexedDocument[] = [];

  constructor(private readonly embedder: Embedder) {}

  add(documents: Document[]): void {
    for (const document of documents) {
      this.documents.push({ ...document, vector: this.embedder.embed(document.text) });
    }
  }

  get size(): number {
    return this.documents.length;
  }

  search(query: string, k = 3, options: { mmr?: boolean; lambda?: number } = {}): RetrievedPassage[] {
    if (this.documents.length === 0) return [];
    const queryVector = this.embedder.embed(query);

    const scored = this.documents
      .map((document) => ({ document, score: cosine(queryVector, document.vector) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return [];
    if (!options.mmr) {
      return scored.slice(0, k).map(toPassage);
    }

    const lambda = options.lambda ?? 0.7;
    const selected: typeof scored = [];
    const candidates = [...scored];
    while (selected.length < k && candidates.length > 0) {
      let bestIndex = 0;
      let bestValue = -Infinity;
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i]!;
        const diversity = selected.length
          ? Math.max(...selected.map((s) => cosine(candidate.document.vector, s.document.vector)))
          : 0;
        const value = lambda * candidate.score - (1 - lambda) * diversity;
        if (value > bestValue) {
          bestValue = value;
          bestIndex = i;
        }
      }
      selected.push(candidates.splice(bestIndex, 1)[0]!);
    }
    return selected.map(toPassage);
  }
}

function toPassage(entry: { document: IndexedDocument; score: number }): RetrievedPassage {
  return {
    id: entry.document.id,
    title: entry.document.title,
    text: entry.document.text,
    score: Number(entry.score.toFixed(4)),
  };
}
