import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkMarkdown, sectorFromFile } from "./chunk.js";

const opts = { maxChars: 300, minChars: 60 };

test("sectorFromFile tira o número e a extensão", () => {
  assert.equal(sectorFromFile("03-estoque-logistica.md"), "estoque-logistica");
  assert.equal(sectorFromFile("docs/02-financeiro.md"), "financeiro");
});

test("corta por títulos e coloca setor e seção no começo de cada chunk", () => {
  const md = [
    "# Setor X",
    "",
    "## Alçadas",
    "O gerente aprova até 10 mil reais em pagamentos, depois de conferir a nota fiscal no sistema interno.",
    "",
    "## Prazos",
    "Os pagamentos acontecem toda terça e quinta, desde que a nota esteja aprovada até o meio-dia anterior.",
  ].join("\n");
  const chunks = chunkMarkdown("02-financeiro.md", md, opts);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.startsWith("Setor: financeiro | Seção: Setor X > Alçadas"));
  assert.ok(chunks[1].text.includes("terça e quinta"));
  assert.equal(chunks[1].heading, "Setor X > Prazos");
  assert.ok(chunks.every((c) => c.source === "02-financeiro.md" && c.sector === "financeiro"));
});

test("seção grande é dividida e nenhum corpo passa do limite", () => {
  const paragraph = "Esta é uma frase de exemplo com tamanho razoável. ".repeat(3).trim();
  const md = ["## Longa", ...Array.from({ length: 8 }, () => ["", paragraph]).flat()].join("\n");
  const chunks = chunkMarkdown("a.md", md, opts);
  assert.ok(chunks.length > 1, "deveria ter virado mais de um chunk");
  for (const c of chunks) {
    const body = c.text.split("\n\n").slice(1).join("\n\n");
    assert.ok(body.length <= opts.maxChars, `corpo com ${body.length} caracteres`);
  }
});

test("parágrafo único gigante é cortado por frase", () => {
  const md = "## Gigante\n\n" + "Frase curta número um. ".repeat(40).trim();
  const chunks = chunkMarkdown("a.md", md, opts);
  assert.ok(chunks.length > 1);
});

test("seção minúscula é juntada à seguinte, sem perder o texto", () => {
  const md = [
    "## Aviso",
    "Leia com atenção.",
    "",
    "## Regra",
    "O pedido mínimo da linha corporativa é de três mil reais, e a proposta vale quinze dias corridos.",
  ].join("\n");
  const chunks = chunkMarkdown("a.md", md, opts);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.includes("Aviso: Leia com atenção."));
  assert.ok(chunks[0].text.includes("três mil reais"));
});

test("mesmo texto gera o mesmo id, e texto diferente gera id diferente", () => {
  const a = chunkMarkdown("a.md", "## T\n\nTexto igual, com tamanho suficiente para passar do mínimo de caracteres do teste.", opts);
  const b = chunkMarkdown("a.md", "## T\n\nTexto igual, com tamanho suficiente para passar do mínimo de caracteres do teste.", opts);
  const c = chunkMarkdown("a.md", "## T\n\nTexto outro, com tamanho suficiente para passar do mínimo de caracteres do teste.", opts);
  assert.equal(a[0].id, b[0].id);
  assert.notEqual(a[0].id, c[0].id);
});

test("título dentro de bloco de código não vira seção", () => {
  const md = ["## Real", "Texto real com tamanho suficiente para o teste passar do mínimo.", "```", "# isto é comentário de código", "```"].join("\n");
  const chunks = chunkMarkdown("a.md", md, opts);
  assert.equal(chunks.length, 1);
});
