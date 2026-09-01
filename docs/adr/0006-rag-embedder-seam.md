# ADR-0006 — Retrieval with a pluggable embedder

**Status:** accepted

## Context

The role calls for RAG, embeddings and a vector database. Help and policy questions
(roaming, payment, plan changes, coverage, eSIM, cancellation) are not customer data
and should be answered from a knowledge base, not invented by the model.

## Decision

Add a `search_knowledge_base` tool on the MCP server backed by a vector store: documents
are embedded at boot, a query is embedded, and the top passages are retrieved by cosine
similarity with optional MMR re-ranking for diversity. The tool is public
(scope `catalog:read`), so it is available to any authenticated caller, unlike the
customer-data tools. The `Embedder` is an interface: the default is a deterministic,
dependency-free local embedder so retrieval is reproducible in tests and free in the
demo; production swaps in a real model (Amazon Bedrock Titan Embeddings) reached through
an IAM role, with no change to the retrieval or tool code above it.

## Consequences

- The RAG competency is demonstrated end to end — embeddings, a vector store, cosine
  retrieval, MMR, a scope-gated tool and grounding — and tested without a key or network.
- The local embedder trades retrieval quality for determinism: it matches core intents
  well but is weaker than a real model on nuanced queries. The seam is where the real
  model plugs in; on AWS the store is a managed vector database (OpenSearch / pgvector).
- The answer is grounded: the model responds from retrieved passages, so a policy answer
  is traceable to a document rather than invented.
