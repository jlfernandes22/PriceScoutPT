import axios from 'axios';
import {
  getLastPulledAt,
  setLastPulledAt,
  applyRemoteChanges,
} from '@nozbe/watermelondb/sync/impl';
import { API_BASE_URL } from '../config';

const BATCH_SIZE = 5000;

/**
 * Sincronização incremental com aplicação lote-a-lote.
 *
 * Em vez de acumular as ~56.000 linhas do catálogo em memória e aplicá-las numa
 * única transação (o que estourava a RAM e matava o processo no Hermes com SIGSEGV),
 * cada lote de 5.000 registos é aplicado imediatamente ao SQLite local através do
 * protocolo low-level `applyRemoteChanges` do WatermelonDB (com _unsafeBatchPerCollection
 * para partir a gravação em sub-lotes de 5.000 e nunca bloquear a transação).
 *
 * O resultado é idempotente: se a sincronização for interrompida a meio, o cursor
 * local não avança e a próxima execução volta a descarregar (e o WatermelonDB converte
 * "criar já existente" em update — ver applyRemote.js).
 */
export async function syncDatabase(database, options = {}) {
  const { onProgress } = options;
  console.log('[Sync] A iniciar protocolo de sincronização Offline-First (lote a lote)...');

  const lastPulledAt = (await getLastPulledAt(database)) || 0;
  const lastPulledAtParam = lastPulledAt
    ? new Date(lastPulledAt).toISOString()
    : new Date(0).toISOString();

  console.log(`[Sync] A solicitar alterações ao servidor desde: ${lastPulledAtParam}`);

  let cursor = null;
  let hasMore = true;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalCategories = 0;
  let finalTimestamp = Date.now();
  let batchCount = 0;

  while (hasMore) {
    const params = { last_pulled_at: lastPulledAtParam, limit: BATCH_SIZE };
    if (cursor) {
      params.cursor = cursor;
    }

    const response = await axios.get(`${API_BASE_URL}/api/sync`, {
      params,
      // Timeout generoso para tolerar o arranque a frio do free tier
      // (scale-to-zero) sem deixar o ecrã de carregamento pendurado para sempre.
      timeout: 60000,
    });
    if (response.status !== 200) {
      throw new Error(`Erro na API de sincronização: Status ${response.status}`);
    }

    const { changes, next_cursor, has_more, timestamp } = response.data;
    finalTimestamp = timestamp || finalTimestamp;

    const created = changes?.products?.created || [];
    const updated = changes?.products?.updated || [];
    const deleted = changes?.products?.deleted || [];
    const categories = changes?.categories?.created || [];

    // Aplicar este lote imediatamente — a memória fica limitada ao tamanho do lote.
    if (created.length || updated.length || deleted.length || categories.length) {
      await database.write(async () => {
        await applyRemoteChanges(changes, {
          db: database,
          _unsafeBatchPerCollection: true,
        });
      });
    }

    totalCreated += created.length;
    totalUpdated += updated.length;
    totalDeleted += deleted.length;
    totalCategories += categories.length;
    batchCount += 1;

    console.log(
      `[Sync] Lote ${batchCount}: +${created.length} criados, ${updated.length} atualizados, ` +
        `${deleted.length} apagados, ${categories.length} categorias (acumulado: ` +
        `${totalCreated}/${totalUpdated}/${totalDeleted}/${totalCategories})`
    );

    cursor = next_cursor || null;
    hasMore = Boolean(has_more);

    if (onProgress) {
      onProgress({ done: totalCreated + totalUpdated, total: null, batch: batchCount });
    }
  }

  // Gravar o timestamp de última sincronização apenas no fim, com sucesso.
  await setLastPulledAt(database, finalTimestamp);

  if (onProgress) {
    onProgress({ done: totalCreated + totalUpdated, total: totalCreated + totalUpdated, batch: batchCount });
  }

  console.log(
    `[Sync] Sincronização concluída! Lotes: ${batchCount}, ` +
      `Criados ${totalCreated}, Atualizados ${totalUpdated}, Apagados ${totalDeleted}, Categorias ${totalCategories}`
  );
}
