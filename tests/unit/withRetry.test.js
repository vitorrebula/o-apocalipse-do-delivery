const { withRetry, _sleep } = require('../../src/resilience/withRetry');

// Marcador de backoff incomum para isolar as chamadas de setTimeout feitas pelo _sleep
const BACKOFF_MARCADOR = 7;

describe('withRetry', () => {
  afterEach(() => jest.restoreAllMocks());

  function contarSleeps(spy) {
    return spy.mock.calls.filter(c => c[1] === BACKOFF_MARCADOR).length;
  }

  it('retorna o valor na primeira tentativa bem-sucedida, sem dormir', async () => {
    const spy = jest.spyOn(global, 'setTimeout');
    const fn = jest.fn().mockResolvedValue('ok');

    const resultado = await withRetry(fn, 3, BACKOFF_MARCADOR);

    expect(resultado).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(contarSleeps(spy)).toBe(0);
  });

  it('tenta novamente após uma falha e retorna o sucesso seguinte', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('temporario'))
      .mockResolvedValue('ok');

    const resultado = await withRetry(fn, 3, 0);

    expect(resultado).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('chama fn exatamente maxRetries+1 vezes quando todas falham', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('falha'));

    await expect(withRetry(fn, 3, 0)).rejects.toThrow('falha');

    expect(fn).toHaveBeenCalledTimes(4); // 1 original + 3 retries
  });

  it('dorme exatamente maxRetries vezes (entre tentativas, nunca após a última)', async () => {
    const spy = jest.spyOn(global, 'setTimeout');
    const fn = jest.fn().mockRejectedValue(new Error('falha'));

    await expect(withRetry(fn, 2, BACKOFF_MARCADOR)).rejects.toThrow();

    // 3 tentativas (0,1,2): dorme após 0 e 1, NÃO após 2 => exatamente 2 sleeps
    expect(contarSleeps(spy)).toBe(2);
  });

  it('não dorme nenhuma vez quando maxRetries é 0', async () => {
    const spy = jest.spyOn(global, 'setTimeout');
    const fn = jest.fn().mockRejectedValue(new Error('falha'));

    await expect(withRetry(fn, 0, BACKOFF_MARCADOR)).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(contarSleeps(spy)).toBe(0);
  });

  it('propaga o último erro após esgotar todas as tentativas', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('erro-1'))
      .mockRejectedValue(new Error('erro-final'));

    await expect(withRetry(fn, 2, 0)).rejects.toThrow('erro-final');
  });

  it('usa o default de 3 retries quando maxRetries não é informado', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('falha'));

    await expect(withRetry(fn, undefined, 0)).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(4); // default 3 retries + 1 original
  });

  describe('_sleep', () => {
    it('retorna uma Promise que resolve para undefined', async () => {
      const p = _sleep(0);
      expect(p).toBeInstanceOf(Promise);
      await expect(p).resolves.toBeUndefined();
    });

    it('aguarda aproximadamente o tempo especificado antes de resolver', async () => {
      const inicio = Date.now();
      await _sleep(30);
      expect(Date.now() - inicio).toBeGreaterThanOrEqual(25);
    });
  });
});
