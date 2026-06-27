/**
 * Envolve uma Promise com um timeout rígido (RN04).
 * Se a promise não resolver dentro de `ms` milissegundos, rejeita com erro de timeout.
 */
function withTimeout(promise, ms) {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Timeout: operação excedeu ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

module.exports = { withTimeout };
