-- Rode uma vez: cole no SQL Editor do Supabase, ou use `npm run ingest -- --init-db`.
-- O tamanho do vetor (768) precisa ser igual a EMBED_DIMS no .env.

create extension if not exists vector;

create table if not exists public.chunks (
  id         text primary key,          -- hash do conteúdo: mesmo texto, mesmo id (não re-embeda)
  source     text not null,             -- arquivo de origem, ex.: 02-financeiro.md
  sector     text not null,             -- setor, usado como filtro
  heading    text not null,             -- caminho de títulos da seção
  content    text not null,             -- texto do chunk (vai para o prompt)
  embedding  vector(768) not null,      -- o vetor
  created_at timestamptz not null default now()
);

create index if not exists chunks_sector_idx on public.chunks (sector);

-- Índice de busca aproximada (HNSW) por distância de cosseno.
-- Com poucos chunks ele nem é necessário, mas é assim que se faz em produção.
create index if not exists chunks_embedding_idx
  on public.chunks using hnsw (embedding vector_cosine_ops);

-- SEGURANÇA: no Supabase, tabelas do schema public ficam expostas pela API REST.
-- Sem RLS, quem tiver a chave anon (que é pública no frontend) lê e escreve aqui.
-- Com RLS ligado e sem nenhuma policy, a API pública não acessa nada.
-- Este projeto conecta direto no Postgres (role postgres), que ignora o RLS.
alter table public.chunks enable row level security;
