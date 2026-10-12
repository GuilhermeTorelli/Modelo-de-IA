// Monta as peças (cliente Gemini, embedder e store) a partir da configuração.
// ingest, chat e eval usam isto, assim todos enxergam o mesmo índice.

import { GoogleGenAI } from "@google/genai";
import { loadConfig, type Config } from "./config.js";
import { GeminiEmbedder, type Embedder } from "./embed.js";
import { MemoryStore, PgStore, type VectorStore } from "./store.js";

export type Runtime = { cfg: Config; ai: GoogleGenAI; embedder: Embedder; store: VectorStore };

export function createRuntime(): Runtime {
  const cfg = loadConfig();
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  const embedder = new GeminiEmbedder(ai, cfg.embedModel, cfg.embedDims);
  const store: VectorStore =
    cfg.store === "pg"
      ? new PgStore({ databaseUrl: cfg.databaseUrl as string, caCertPath: cfg.pgCaCert })
      : new MemoryStore(`${cfg.embedModel}:${cfg.embedDims}`);
  return { cfg, ai, embedder, store };
}
