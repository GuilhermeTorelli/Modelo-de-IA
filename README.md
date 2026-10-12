# RAG com Gemini e pgvector: assistente de uma empresa fictícia

Projeto de estudo de **RAG** (Retrieval-Augmented Generation) em TypeScript. Um assistente responde perguntas de colaboradores da **Prisma Móveis**, uma empresa fictícia com 10 setores, usando **somente** a documentação interna e citando as fontes. Quando a resposta não está nos documentos, ele diz isso em vez de inventar.

> Projeto de estudo construído com ajuda de IA (Claude). O objetivo foi entender cada etapa do pipeline, medir a qualidade e testar falhas de segurança, não só fazer funcionar.

## Exemplo real de uso

```text
Pergunta: Vendedor tem comissão por venda?

Chunks encontrados (✓ = passou do limite e vai para o prompt):
  ✓ [1] 01-comercial.md > Comissões  (0.772)
  ✓ [2] 01-comercial.md > Alçadas de desconto  (0.680)
  ...
Resposta:
Sim, o vendedor tem comissão de 3% nas vendas da linha Casa e de 2% nas
vendas da linha Corporativo [1]. O pagamento é realizado até o dia 10 do
mês seguinte, após a confirmação do recebimento pelo Financeiro [1].

Pergunta: Como o avião é abastecido durante o voo?

  · [1] 08-atendimento.md > Assistência técnica  (0.530)
  · [2] 08-atendimento.md > Canais e horários  (0.516)
  ...
Resposta:
Não encontrei na documentação.
```

Na segunda pergunta nenhum trecho passou do limite de similaridade (0.55), então o modelo de chat **nem é chamado**: economiza custo e evita alucinação.

<!-- PREENCHA: coloque aqui o print do seu terminal (docs/img/chat.png) -->

## Como funciona

```text
docs/*.md ─► chunking por título ─► embeddings ─► vetores (memória ou pgvector)
                                                        │
pergunta ─► embedding ─► busca por similaridade ◄───────┘
                              │ só trechos acima do limite
                              ▼
                    prompt com os trechos ─► LLM ─► resposta com fontes
```

| Arquivo | Etapa |
|---|---|
| `src/chunk.ts` | divide por título, com cabeçalho "Setor / Seção" em cada chunk, sobreposição e ids estáveis (hash) |
| `src/embed.ts` | embeddings do Gemini (768 dimensões, normalizados) |
| `src/store.ts` | armazenamento: memória (arquivo local) ou Postgres + pgvector (HNSW, distância de cosseno) |
| `src/rag.ts` | busca, limite de similaridade, prompt e geração |
| `src/ingest.ts` | indexação incremental: só reprocessa o que mudou |
| `src/chat.ts` | chat no terminal, com filtro por setor |
| `src/eval.ts` | avaliação com 53 perguntas |

## Como rodar

Requisitos: Node 20.6+ e uma chave do Gemini (aistudio.google.com).

```bash
npm install
cp _env.example .env      # cole a GEMINI_API_KEY
npm run ingest            # só precisa repetir se mudar docs/ ou o chunking
npm run chat
```

Com Postgres/pgvector: `docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 pgvector/pgvector:pg16`, depois `STORE=pg` e `DATABASE_URL` no `.env`, e `npm run ingest -- --init-db`.

Outros comandos: `npm run eval`, `npm run eval -- --sem-llm`, `npm test`, `npm run check`.

## Avaliação

`npm run eval` roda 53 perguntas: de um setor, que cruzam setores, e fora do escopo (algumas óbvias, outras que *parecem* da empresa, como "qual o salário do Diretor Geral?").

| Modo | Resultado |
|---|---|
| Só busca (`--sem-llm`, `MIN_SCORE=0.55`) | **46/48** (as 5 perguntas "plausíveis, mas fora dos documentos" não entram na conta: só o LLM pode barrá-las) |
| Busca + LLM | parcial: 13 de 13 perguntas testadas ok (Comercial, Financeiro e Logística). O plano gratuito limita o modelo a 20 chamadas por dia, então o restante é rodado em dias diferentes com `--so=` |

As duas falhas da busca foram perguntas sem relação com a empresa que passaram do limite por pouco: o plantio de ipê (0.552) e a fotossíntese (0.562).

Calibração do `MIN_SCORE` (valores reais da minha execução):

- menor similaridade de um chunk correto: **0.590**
- maior similaridade de pergunta sem relação: **0.562**
- conclusão: um limite entre 0.56 e 0.59 separa os dois grupos, mas com margem pequena (0.03). A calibração foi feita nas mesmas perguntas em que se mede, então com perguntas novas a separação pode ser pior.
- as 5 perguntas "plausíveis" ficaram entre 0.603 e 0.646, **acima** do pior chunk correto. Nenhum limite de similaridade as barra; só o prompt consegue.

PREENCHA: resultado depois de testar `MIN_SCORE=0.575` e do `npm run eval -- --so=fora`.

## Segurança

- **Prompt injection:** `extras/ataque-injection.md` contém um comentário escondido mandando o modelo liberar descontos. O prompt trata os trechos como dados e avisa o modelo para ignorar ordens dentro deles. Resultado do meu teste: PREENCHA (o modelo obedeceu? ignorou? avisou?).
- **Banco:** a tabela tem RLS ligado. Credenciais ficam só no `.env`, que está no `.gitignore`.
- **Limite honesto:** nada impede 100% prompt injection. Em produção, controle de acesso por usuário deve ser feito na busca (filtro por permissão), não no prompt.

## O que aprendi

- **Medir muda a conversa.** Sem o eval eu acharia que o limite de 0.55 estava bom. Com ele vi que perguntas sem relação chegam a 0.562 e que o ideal fica entre 0.56 e 0.59.
- **A busca por similaridade não entende "fora do assunto".** Perguntas que parecem da empresa (salário do Diretor Geral, senha do Wi-Fi) pontuam mais que chunks corretos de outras perguntas. Quem as barra é o prompt, e isso precisa ser testado com o LLM.
- **Limites de API são parte do projeto.** O plano gratuito tem cota diária por modelo. Retentar com espera não resolve cota diária, então o código detecta esse caso, para e mostra um relatório parcial.
- **Padrão x escolha.** O fluxo (dividir, embedar, buscar, montar prompt, gerar) é fixo; tamanho do chunk, `TOP_K`, `MIN_SCORE` e prompt são escolhas que se ajustam medindo.
- PREENCHA: o que mudou quando testei `CHUNK_MAX_CHARS` 400 e 2000.

## Limitações e próximos passos

- Documentos são fictícios e pequenos (89 chunks); com bases maiores, busca híbrida (vetor + palavra-chave) e reranking passam a importar.
- Sem controle de acesso por usuário.
- Próximos passos: busca híbrida, reranking, interface web e transformar a busca em uma ferramenta MCP para um agente.

## Stack

TypeScript, Node, `@google/genai` (Gemini), PostgreSQL + pgvector, `pg`, `tsx`, `node:test`.
