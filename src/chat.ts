// CHAT NO TERMINAL.
//   /setores        lista os setores indexados
//   /setor <nome>   restringe a busca a um setor (ex.: /setor financeiro); "/setor todos" volta ao normal
//   /k <n>          muda quantos chunks são buscados
//   /sair           encerra

import * as readline from "node:readline/promises";
import { createRuntime } from "./runtime.js";
import { NOT_FOUND, generate, retrieve } from "./rag.js";
import { describeError } from "./util.js";

const { cfg, ai, embedder, store } = createRuntime();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

try {
  const stats = await store.stats();
  if (stats.total === 0) {
    console.log("O índice está vazio. Rode primeiro: npm run ingest");
  } else {
    let sector: string | undefined;
    let k = cfg.topK;
    console.log(`Armazenamento: ${store.name} | ${stats.total} chunks | modelo: ${cfg.chatModel}`);
    console.log(`Limite de similaridade: ${cfg.minScore}. Comandos: /setores /setor <nome> /k <n> /sair\n`);

    while (true) {
      const q = (await rl.question(sector ? `[${sector}] Pergunta: ` : "Pergunta: ")).trim();
      if (!q) continue;

      if (q.startsWith("/")) {
        const [cmd, arg] = q.split(/\s+/, 2);
        if (cmd === "/sair") break;
        if (cmd === "/setores") console.log(Object.entries(stats.bySector).map(([s, n]) => `  ${s} (${n})`).join("\n"));
        else if (cmd === "/setor") {
          if (!arg || arg === "todos") sector = undefined;
          else if (stats.bySector[arg]) sector = arg;
          else console.log("  setor desconhecido; use /setores para ver a lista");
        } else if (cmd === "/k") {
          const n = Number(arg);
          if (Number.isInteger(n) && n > 0) k = n;
          else console.log("  use: /k 5");
        } else console.log("  comando desconhecido");
        console.log();
        continue;
      }

      try {
        const r = await retrieve(embedder, store, q, { k, minScore: cfg.minScore, sector });
        console.log("\nChunks encontrados (✓ = passou do limite e vai para o prompt):");
        r.hits.forEach((h, i) => {
          const mark = h.score >= cfg.minScore ? "✓" : "·";
          console.log(`  ${mark} [${i + 1}] ${h.source} > ${h.heading.split(" > ").slice(1).join(" > ") || "(início)"}  (${h.score.toFixed(3)})`);
        });
        const answer = r.usable.length ? await generate(ai, cfg.chatModel, q, r.usable) : NOT_FOUND;
        console.log(`\nResposta:\n${answer}\n`);
      } catch (err) {
        console.log(`\nErro: ${describeError(err)}\n`);
      }
    }
  }
} finally {
  rl.close();
  await store.close();
}
