// Configuração lida do .env. Cada valor tem um padrão razoável e pode ser trocado sem mexer no código.

export type Config = {
  geminiApiKey: string;
  chatModel: string; // o LLM que escreve a resposta
  embedModel: string; // o modelo que transforma texto em vetor
  embedDims: number; // tamanho do vetor (precisa bater com vector(768) no sql/schema.sql)
  topK: number; // quantos chunks buscar por pergunta
  minScore: number; // similaridade mínima para um chunk ser usado
  chunkMaxChars: number; // tamanho máximo do corpo de um chunk
  docsDir: string;
  store: "memory" | "pg";
  databaseUrl?: string;
  pgCaCert?: string;
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} precisa ser um número (recebi "${raw}").`);
  return n;
}

export function loadConfig(): Config {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey || geminiApiKey === "cole_sua_chave_aqui") {
    throw new Error("Falta a GEMINI_API_KEY no arquivo .env (copie _env.example para .env e cole sua chave).");
  }
  const store = process.env.STORE ?? "memory";
  if (store !== "memory" && store !== "pg") throw new Error(`STORE deve ser "memory" ou "pg" (recebi "${store}").`);
  if (store === "pg" && !process.env.DATABASE_URL) throw new Error("STORE=pg exige DATABASE_URL no .env.");

  return {
    geminiApiKey,
    chatModel: process.env.CHAT_MODEL || "gemini-3.8-flash",
    embedModel: process.env.EMBED_MODEL || "gemini-embedding-001",
    embedDims: num("EMBED_DIMS", 768),
    topK: num("TOP_K", 5),
    minScore: num("MIN_SCORE", 0.55),
    chunkMaxChars: num("CHUNK_MAX_CHARS", 1000),
    docsDir: process.env.DOCS_DIR || "docs",
    store,
    databaseUrl: process.env.DATABASE_URL,
    pgCaCert: process.env.PG_CA_CERT || undefined,
  };
}
