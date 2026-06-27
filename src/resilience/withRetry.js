/**
 * Executa `fn` com política de retry automático (RN05/RN06).
 * Tenta `maxRetries` vezes adicionais com `backoffMs` de espera entre tentativas.
 */
async function withRetry(fn, maxRetries = 3, backoffMs = 500) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await _sleep(backoffMs);
      }
    }
  }

  throw lastError;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { withRetry, _sleep };
