// PASSO 1: CHUNKING.
// Divide um documento Markdown em pedaços (chunks) que fazem sentido sozinhos.
//
// Escolhas deste projeto (todas são ESCOLHAS, não regras):
//  - corta por títulos (#, ##, ###), porque cada seção costuma ser um assunto só;
//  - seções grandes são divididas por parágrafo, respeitando um tamanho máximo;
//  - seções minúsculas são juntadas à seguinte, para não virar um chunk quase vazio;
//  - o chunk que vai para o embedding começa com "Setor | Seção", para o vetor saber de que assunto se trata.
//
// Este arquivo é puro: não chama API nem lê arquivo. Por isso é fácil de testar.

import { createHash } from "node:crypto";
import { basename } from "node:path";

export type Chunk = {
  id: string; // hash do conteúdo: mesmo texto = mesmo id (assim não refazemos o embedding)
  source: string; // arquivo de origem, ex.: 02-financeiro.md
  sector: string; // ex.: financeiro
  heading: string; // caminho de títulos, ex.: Setor Financeiro > Alçadas de pagamento
  text: string; // o que vai para o embedding e para o prompt
};

export type ChunkOptions = {
  maxChars: number; // tamanho máximo do corpo de um chunk
  minChars: number; // seções menores que isso são juntadas à seção seguinte
};

/** "03-estoque-logistica.md" vira "estoque-logistica". */
export function sectorFromFile(file: string): string {
  return basename(file, ".md").replace(/^\d+-/, "");
}

type Section = { path: string[]; paragraphs: string[] };

function toParagraphs(lines: string[]): string[] {
  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Quebra o Markdown em seções, uma por título, guardando o caminho de títulos de cada uma. */
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: string[] = [];
  let current: Section | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (current) {
      current.paragraphs = toParagraphs(buffer);
      if (current.paragraphs.length > 0) sections.push(current);
    }
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      stack.length = level - 1; // descarta títulos de nível igual ou mais fundo
      stack[level - 1] = m[2].trim();
      current = { path: stack.filter(Boolean), paragraphs: [] };
    } else {
      if (!current) current = { path: [], paragraphs: [] }; // texto antes de qualquer título
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Um parágrafo maior que o limite é cortado por frase (e, em último caso, por caractere). */
function splitLongParagraph(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const sentence of p.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > max) {
      push();
      for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + 1 + sentence.length > max) push();
    cur = cur ? `${cur} ${sentence}` : sentence;
  }
  push();
  return out;
}

/**
 * Junta parágrafos até o limite. Quando começa um chunk novo na mesma seção, repete o último
 * parágrafo do anterior (se for curto): é a "sobreposição" (overlap), que evita perder o contexto no corte.
 */
function packParagraphs(paragraphs: string[], max: number): string[] {
  const parts = paragraphs.flatMap((p) => splitLongParagraph(p, max));
  const bodies: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const part of parts) {
    if (cur.length && len + 2 + part.length > max) {
      bodies.push(cur.join("\n\n"));
      const last = cur[cur.length - 1];
      const keep = last.length <= max / 3 && last.length + 2 + part.length <= max;
      cur = keep ? [last] : [];
      len = keep ? last.length : 0;
    }
    len += (cur.length ? 2 : 0) + part.length;
    cur.push(part);
  }
  if (cur.length) bodies.push(cur.join("\n\n"));
  return bodies;
}

export function chunkMarkdown(source: string, markdown: string, opts: ChunkOptions): Chunk[] {
  const sector = sectorFromFile(source);
  const sections = splitSections(markdown);
  const chunks: Chunk[] = [];
  let carry = ""; // texto de seções minúsculas, que viaja junto com a próxima

  sections.forEach((section, index) => {
    const title = section.path[section.path.length - 1] ?? "(sem título)";
    const heading = section.path.join(" > ") || "(sem título)";
    const isLast = index === sections.length - 1;
    const size = section.paragraphs.join("\n\n").length;

    if (size < opts.minChars && !isLast) {
      carry += (carry ? "\n\n" : "") + `${title}: ${section.paragraphs.join("\n\n")}`;
      return;
    }

    const paragraphs = carry ? [carry, ...section.paragraphs] : section.paragraphs;
    carry = "";

    packParagraphs(paragraphs, opts.maxChars).forEach((body, i) => {
      const text = `Setor: ${sector} | Seção: ${heading}\n\n${body}`;
      const id = createHash("sha1").update(`${source}|${heading}|${i}|${text}`).digest("hex").slice(0, 16);
      chunks.push({ id, source, sector, heading, text });
    });
  });

  return chunks;
}
