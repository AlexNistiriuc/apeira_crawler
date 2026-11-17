// Esegue fn su ogni elemento con al massimo n lavori in parallelo, fermandosi alla scadenza.
export async function pool(items, n, fn, { deadline = Infinity } = {}) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch (e) { console.error('errore su', items[idx]?.url || items[idx]?.dominio || idx, e?.message); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
