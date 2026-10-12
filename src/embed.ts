// PASSO 2: EMBEDDINGS.
// Transforma texto em vetor (uma lista de números que representa o significado).
// O resto do projeto só conhece a interface Embedder, então dá para trocar de provedor
// (OpenAI, Cohere, um modelo local) mexendo apenas aqui.

import type { GoogleGenAI } from "@google/genai";
import { l2normalize, withRetry } from "./util.js";

export interface Embedder {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const BATCH = 50; // quantos textos por chamada

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export class GeminiEmbedder implements Embedder {
  private ai: GoogleGenAI;
  private model: string;
  private dims: number;

  constructor(ai: GoogleGenAI, model: string, dims: number) {
    this.ai = ai;
    this.model = model;
    this.dims = dims;
  }

  // ESCOLHA: o Gemini aceita dizer se o texto é um "documento" ou uma "pergunta".
  // Isso melhora a busca: pergunta e resposta nem sempre se parecem, e o modelo sabe disso.
  private async embed(texts: string[], taskType: TaskType): Promise<number[][]> {
    const res = await withRetry(
      () =>
        this.ai.models.embedContent({
          model: this.model,
          contents: texts,
          // ESCOLHA: 768 dimensões em vez das 3072 padrão: menor, mais barato, quase a mesma qualidade.
          config: { taskType, outputDimensionality: this.dims },
        }),
      "embeddings",
    );
    const vectors = (res.embeddings ?? []).map((e) => l2normalize(e.values ?? []));
    if (vectors.length !== texts.length) {
      throw new Error(`A API devolveu ${vectors.length} vetores para ${texts.length} textos.`);
    }
    return vectors;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await this.embed(texts.slice(i, i + BATCH), "RETRIEVAL_DOCUMENT")));
      if (texts.length > BATCH) console.log(`  embeddings: ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embed([text], "RETRIEVAL_QUERY"))[0];
  }
}
