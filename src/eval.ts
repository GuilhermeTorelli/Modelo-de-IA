// AVALIAÇÃO: roda as perguntas de eval/perguntas.json e mede se o RAG acerta.
//
//   npm run eval                 busca + resposta do LLM (uma chamada de chat por pergunta)
//   npm run eval -- --sem-llm    só a busca: rápido, gratuito e já mostra se o problema é a busca
//
// Para cada pergunta do escopo medimos:
//   - achou a fonte certa?  (algum dos k chunks vem do arquivo esperado, e passa do limite de similaridade)
//   - respondeu certo?      (a resposta contém as palavras esperadas)
// Para perguntas fora do escopo medimos se o sistema se recusa a responder.
//
// No fim, o relatório mostra a faixa de similaridade que ajuda a escolher o MIN_SCORE.

import { readFileSync } from "node:fs";
import { createRuntime } from "./runtime.js";
import { NOT_FOUND, generate, retrieve } from "./rag.js";
import { normalize, sleep } from "./util.js";

type Question = {
  id: string;
  pergunta: string;
  fontes?: string[]; // arquivos onde a resposta está (basta um deles aparecer)
  palavras?: string[]; // a resposta precisa conter todas; use "a|b" para alternativas
  foraDoEscopo?: "obvia" | "plausivel"; // obvia: nada a ver com a empresa; plausivel: parece da empresa, mas não está nos documentos
};

const noLlm = process.argv.includes("--sem-llm");
const questions = JSON.parse(readFileSync("eval/perguntas.json", "utf8")) as Question[];
const { cfg, ai, embedder, store } = createRuntime();

function contains(answer: string, words: string[]): boolean {
  const a = normalize(answer);
  return words.every((w) => w.split("|").some((alt) => a.includes(normalize(alt))));
}

type Result = { q: Question; pass: boolean | null; top: number; expectedScore: number; note: string; answer?: string };
const results: Result[] = [];

try {
  const stats = await store.stats();
  if (stats.total === 0) throw new Error("O índice está vazio. Rode primeiro: npm run ingest");
  console.log(`${questions.length} perguntas | k=${cfg.topK} | limite=${cfg.minScore} | ${noLlm ? "só busca" : "busca + LLM"}\n`);

  for (const q of questions) {
    const r = await retrieve(embedder, store, q.pergunta, { k: cfg.topK, minScore: cfg.minScore });
    let pass: boolean | null;
    let note: string;
    let answer: string | undefined;
    let expectedScore = 0;

    if (q.foraDoEscopo) {
      const blocked = r.usable.length === 0;
      if (blocked) {
        pass = true;
        note = "barrada na busca";
      } else if (noLlm) {
        pass = q.foraDoEscopo === "obvia" ? false : null; // plausível: só o LLM pode recusar
        note = q.foraDoEscopo === "obvia" ? "deveria ter sido barrada na busca" : "passou da busca; depende do LLM recusar";
      } else {
        answer = await generate(ai, cfg.chatModel, q.pergunta, r.usable);
        pass = normalize(answer).includes(normalize("não encontrei"));
        note = pass ? "recusada pelo LLM" : "RESPONDEU algo que não está nos documentos";
      }
    } else {
      const expected = q.fontes ?? [];
      const fromExpected = r.hits.filter((h) => expected.includes(h.source));
      expectedScore = fromExpected[0]?.score ?? 0;
      const found = fromExpected.some((h) => h.score >= cfg.minScore);
      if (!found) {
        pass = false;
        note = fromExpected.length ? "fonte certa, mas abaixo do limite" : "fonte certa NÃO apareceu nos k primeiros";
      } else if (noLlm) {
        pass = true;
        note = "fonte certa encontrada";
      } else {
        answer = await generate(ai, cfg.chatModel, q.pergunta, r.usable);
        const ok = contains(answer, q.palavras ?? []);
        pass = ok;
        note = ok ? "fonte e resposta ok" : "fonte ok, resposta sem as palavras esperadas";
      }
    }

    results.push({ q, pass, top: r.topScore, expectedScore, note, answer });
    const mark = pass === null ? "?" : pass ? "✓" : "✗";
    console.log(`${mark} ${q.id.padEnd(8)} topo=${r.topScore.toFixed(3)} esperado=${expectedScore ? expectedScore.toFixed(3) : "  -  "}  ${note}`);
    if (!noLlm) await sleep(400); // gentileza com o limite de requisições do plano gratuito
  }

  // ---- relatório
  const scored = results.filter((r) => r.pass !== null);
  const passed = scored.filter((r) => r.pass).length;
  console.log(`\nResultado: ${passed}/${scored.length} ok`);

  const failed = results.filter((r) => r.pass === false);
  if (failed.length) {
    console.log("\nFalhas:");
    for (const f of failed) {
      console.log(`  ${f.q.id}: ${f.q.pergunta}\n    -> ${f.note}`);
      if (f.answer) console.log(`    resposta: ${f.answer.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }

  // Calibração do limite: onde ficam as perguntas boas e as fora do escopo?
  const inScope = results.filter((r) => !r.q.foraDoEscopo && r.expectedScore > 0).map((r) => r.expectedScore);
  const obvious = results.filter((r) => r.q.foraDoEscopo === "obvia").map((r) => r.top);
  if (inScope.length && obvious.length) {
    const lowGood = Math.min(...inScope);
    const highBad = Math.max(...obvious);
    console.log(`\nCalibração do MIN_SCORE (atual: ${cfg.minScore})`);
    console.log(`  menor similaridade de um chunk correto: ${lowGood.toFixed(3)}`);
    console.log(`  maior similaridade de pergunta sem relação: ${highBad.toFixed(3)}`);
    if (highBad < lowGood) console.log(`  -> um limite entre ${highBad.toFixed(2)} e ${lowGood.toFixed(2)} separa os dois grupos.`);
    else console.log("  -> os grupos se sobrepõem: só o limite não resolve; vale melhorar chunks, usar reranking ou depender do LLM.");
  }
  const plausible = results.filter((r) => r.q.foraDoEscopo === "plausivel");
  if (plausible.length) {
    console.log("\nPerguntas 'plausíveis, mas fora dos documentos' costumam passar da busca (parecem da empresa).");
    console.log("Quem as barra é o prompt, por isso elas só contam como acerto no modo com LLM.");
  }
  if (failed.length) process.exitCode = 1;
} finally {
  await store.close();
}
