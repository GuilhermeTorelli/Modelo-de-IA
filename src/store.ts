// PASSO 3: ARMAZENAMENTO E BUSCA.
// Duas implementações da mesma interface:
//  - MemoryStore: guarda tudo num arquivo JSON local (.cache/index.json). Ótimo para começar.
//  - PgStore: guarda em Postgres com pgvector (funciona no Supabase). É o que se usa em produção.
// O resto do projeto não sabe qual das duas está em uso.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import type { Chunk } from "./chunk.js";
import { cosine } from "./util.js";

export type StoredChunk = Chunk & { vector: number[] };
export type Hit = Chunk & { score: number };
export type StoreStats = { total: number; bySector: Record<string, number> };

export interface VectorStore {
  readonly name: string;
  existingIds(): Promise<Set<string>>;
  upsert(chunks: StoredChunk[]): Promise<void>;
  deleteExcept(keepIds: string[]): Promise<number>;
  clear(): Promise<void>;
  /** Devolve os k chunks mais parecidos com o vetor, do mais para o menos parecido. */
  search(vector: number[], k: number, sector?: string): Promise<Hit[]>;
  stats(): Promise<StoreStats>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------- memória

type CacheFile = { meta: string; items: StoredChunk[] };

export class MemoryStore implements VectorStore {
  readonly name = "memória (arquivo .cache/index.json)";
  private items = new Map<string, StoredChunk>();
  private file: string;
  private meta: string;

  /** `meta` identifica o modelo de embeddings: se mudar, o cache antigo deixa de valer. */
  constructor(meta: string, file = ".cache/index.json") {
    this.file = file;
    this.meta = meta;
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8")) as CacheFile;
        if (data.meta === meta) for (const c of data.items) this.items.set(c.id, c);
        else console.log("(o modelo de embeddings mudou: o cache antigo foi descartado)");
      } catch {
        console.log("(cache ilegível: vou recriar)");
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const data: CacheFile = { meta: this.meta, items: [...this.items.values()] };
    writeFileSync(this.file, JSON.stringify(data));
  }

  async existingIds() {
    return new Set(this.items.keys());
  }

  async upsert(chunks: StoredChunk[]) {
    for (const c of chunks) this.items.set(c.id, c);
    this.save();
  }

  async deleteExcept(keepIds: string[]) {
    const keep = new Set(keepIds);
    let removed = 0;
    for (const id of [...this.items.keys()]) {
      if (!keep.has(id)) {
        this.items.delete(id);
        removed++;
      }
    }
    if (removed) this.save();
    return removed;
  }

  async clear() {
    this.items.clear();
    this.save();
  }

  async search(vector: number[], k: number, sector?: string): Promise<Hit[]> {
    return [...this.items.values()]
      .filter((c) => !sector || c.sector === sector)
      .map(({ vector: v, ...chunk }) => ({ ...chunk, score: cosine(vector, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async stats(): Promise<StoreStats> {
    const bySector: Record<string, number> = {};
    for (const c of this.items.values()) bySector[c.sector] = (bySector[c.sector] ?? 0) + 1;
    return { total: this.items.size, bySector };
  }

  async close() {}
}

// ---------------------------------------------------------------- Postgres + pgvector

/** pgvector recebe o vetor como texto: "[0.1,0.2,...]". */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export type PgOptions = { databaseUrl: string; caCertPath?: string };

export class PgStore implements VectorStore {
  readonly name = "Postgres + pgvector";
  private pool: pg.Pool;

  constructor(opts: PgOptions) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(opts.databaseUrl);
    let ssl: pg.PoolConfig["ssl"] = false;
    if (!local && opts.caCertPath) {
      ssl = { ca: readFileSync(opts.caCertPath, "utf8"), rejectUnauthorized: true };
    } else if (!local) {
      // Conexão criptografada, mas SEM verificar quem está do outro lado. Aceitável para estudo.
      // Para verificar de verdade, baixe o certificado da CA do seu banco e aponte PG_CA_CERT para ele.
      console.warn("(aviso: TLS sem verificação de certificado; veja o README, seção Segurança)");
      ssl = { rejectUnauthorized: false };
    }
    this.pool = new pg.Pool({ connectionString: opts.databaseUrl, ssl, max: 4 });
  }

  /** Executa um arquivo SQL inteiro (usado por `--init-db`). */
  async runSql(sql: string) {
    await this.pool.query(sql);
  }

  async existingIds() {
    const r = await this.pool.query<{ id: string }>("select id from chunks");
    return new Set(r.rows.map((row) => row.id));
  }

  async upsert(chunks: StoredChunk[]) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const c of chunks) {
        await client.query(
          `insert into chunks (id, source, sector, heading, content, embedding)
           values ($1, $2, $3, $4, $5, $6::vector)
           on conflict (id) do update set
             source = excluded.source, sector = excluded.sector, heading = excluded.heading,
             content = excluded.content, embedding = excluded.embedding`,
          [c.id, c.source, c.sector, c.heading, c.text, toVectorLiteral(c.vector)],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteExcept(keepIds: string[]) {
    const r = await this.pool.query("delete from chunks where not (id = any($1::text[]))", [keepIds]);
    return r.rowCount ?? 0;
  }

  async clear() {
    await this.pool.query("truncate table chunks");
  }

  // `<=>` é a distância de cosseno do pgvector. Similaridade = 1 - distância.
  async search(vector: number[], k: number, sector?: string): Promise<Hit[]> {
    const r = await this.pool.query<{
      id: string;
      source: string;
      sector: string;
      heading: string;
      content: string;
      score: string;
    }>(
      `select id, source, sector, heading, content, 1 - (embedding <=> $1::vector) as score
         from chunks
        where ($3::text is null or sector = $3)
        order by embedding <=> $1::vector
        limit $2`,
      [toVectorLiteral(vector), k, sector ?? null],
    );
    return r.rows.map((row) => ({
      id: row.id,
      source: row.source,
      sector: row.sector,
      heading: row.heading,
      text: row.content,
      score: Number(row.score),
    }));
  }

  async stats(): Promise<StoreStats> {
    const r = await this.pool.query<{ sector: string; n: string }>(
      "select sector, count(*) as n from chunks group by sector order by sector",
    );
    const bySector: Record<string, number> = {};
    let total = 0;
    for (const row of r.rows) {
      bySector[row.sector] = Number(row.n);
      total += Number(row.n);
    }
    return { total, bySector };
  }

  async close() {
    await this.pool.end();
  }
}
