/**
 * Text embedding for retrieval.
 *
 * The `Embedder` interface is the seam: in production it is backed by a real model
 * (Amazon Bedrock Titan Embeddings, or any provider), reached through an IAM role the
 * same way the agent reaches Bedrock. The default here is a deterministic, dependency-
 * free local embedder so retrieval is reproducible in tests and costs nothing in the
 * demo — the vector-store and retrieval code above it is identical either way.
 *
 * The local embedder hashes character trigrams into a fixed-dimension vector weighted
 * by term frequency and L2-normalized, so cosine similarity reflects shared subword
 * structure rather than exact substring matches.
 */

export interface Embedder {
  readonly dimension: number;
  embed(text: string): Float32Array;
}

const DEFAULT_DIMENSION = 512;

export class HashingEmbedder implements Embedder {
  constructor(readonly dimension: number = DEFAULT_DIMENSION) {}

  embed(text: string): Float32Array {
    const vector = new Float32Array(this.dimension);
    const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    for (const token of normalized.split(" ").filter(Boolean)) {
      const padded = ` ${token} `;
      for (let i = 0; i < padded.length - 2; i += 1) {
        const gram = padded.slice(i, i + 3);
        const bucket = hash(gram) % this.dimension;
        vector[bucket] = (vector[bucket] ?? 0) + 1;
      }
    }
    return l2normalize(vector);
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
}

function l2normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  for (let i = 0; i < vector.length; i += 1) vector[i]! /= norm;
  return vector;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
