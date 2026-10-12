// INDEXAÇÃO: lê os documentos, divide em chunks, gera embeddings só do que é novo e guarda.
//
//   npm run ingest                  indexa (e só refaz o que mudou)
//   npm run ingest -- --reset       apaga o índice antes
//   npm run ingest -- --init-db     (STORE=pg) cria a tabela antes, usando sql/schema.sql

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkMarkdown, type Chunk } from "./chunk.js";
import { createRuntime } from "./runtime.js";
import { PgStore } from "./store.js";

const args = new Set(process.argv.slice(2));
const { cfg, embedder, store } = createRuntime();

try {
  console.log(`Armazenamento: ${store.name}`);

  if (args.has("--init-db")) {
    if (!(store instanceof PgStore)) throw new Error("--init-db só faz sentido com STORE=pg.");
    await store.runSql(readFileSync("sql/schema.sql", "utf8"));
    console.log("Tabela e índices criados (sql/schema.sql).");
  }
  if (args.has("--reset")) {
    await store.clear();
    console.log("Índice apagado.");
  }

  // 1. ler e dividir
  const files = readdirSync(cfg.docsDir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) throw new Error(`Nenhum .md encontrado em ${cfg.docsDir}/`);

  const chunks: Chunk[] = [];
  for (const file of files) {
    const markdown = readFileSync(join(cfg.docsDir, file), "utf8");
    const fileChunks = chunkMarkdown(file, markdown, { maxChars: cfg.chunkMaxChars, minChars: 120 });
    chunks.push(...fileChunks);
    console.log(`  ${file.padEnd(28)} ${String(fileChunks.length).padStart(3)} chunks`);
  }
  const sizes = chunks.map((c) => c.text.length);
  console.log(
    `Total: ${chunks.length} chunks (média ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)} caracteres, maior ${Math.max(...sizes)}).`,
  );

  // 2. embeddings, só do que ainda não está no índice
  const existing = await store.existingIds();
  const fresh = chunks.filter((c) => !existing.has(c.id));
  console.log(`${fresh.length} chunks novos ou alterados, ${chunks.length - fresh.length} já estavam no índice.`);

  if (fresh.length > 0) {
    const vectors = await embedder.embedDocuments(fresh.map((c) => c.text));
    await store.upsert(fresh.map((c, i) => ({ ...c, vector: vectors[i] })));
  }

  // 3. remove do índice o que não existe mais nos documentos
  const removed = await store.deleteExcept(chunks.map((c) => c.id));
  if (removed) console.log(`${removed} chunks antigos removidos (o texto mudou ou o arquivo saiu).`);

  const stats = await store.stats();
  console.log(`Índice pronto: ${stats.total} chunks em ${Object.keys(stats.bySector).length} setores.`);
} finally {
  await store.close();
}
