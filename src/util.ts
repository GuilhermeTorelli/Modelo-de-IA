// Funções pequenas e puras, usadas pelo resto do projeto.

/** minúsculas e sem acentos: "Terça" vira "terca". Usado para comparar textos. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Deixa o vetor com tamanho 1. Os vetores "reduzidos" (768 dims) do Gemini não vêm normalizados. */
export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

/** Similaridade de cosseno: 1 = mesma direção, 0 = nada a ver. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mostra a causa real de um erro. "fetch failed" sozinho não diz nada: a causa fica em err.cause. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return `${err.message} (causa: ${code ? code + " - " : ""}${cause.message})`;
  }
  return err.message;
}

/** Tenta de novo (com espera crescente) quando a API responde 429 ou 5xx (comum no plano gratuito) ou a conexão falha. */
export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 5): Promise<T> {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const networkError = status === undefined && err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|terminated/i.test(err.message);
      const retryable = status === 429 || status === 500 || status === 503 || networkError;
      if (!retryable || attempt >= tries) throw err;
      console.warn(`  (${label}: ${status ?? describeError(err)}, nova tentativa em ${delay / 1000}s)`);
      await sleep(delay);
      delay *= 2;
    }
  }
}
