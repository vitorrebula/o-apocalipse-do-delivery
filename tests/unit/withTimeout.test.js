const { withTimeout } = require('../../src/resilience/withTimeout');

describe('withTimeout', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolve com o valor da promise quando ela responde antes do timeout', async () => {
    const resultado = await withTimeout(Promise.resolve('rapido'), 1000);
    expect(resultado).toBe('rapido');
  });

  it('rejeita com a mensagem de timeout quando a promise excede o tempo limite', async () => {
    const lenta = new Promise(resolve => setTimeout(() => resolve('tarde'), 200));
    await expect(withTimeout(lenta, 20)).rejects.toThrow('Timeout: operação excedeu 20ms');
  });

  it('inclui o valor de ms exato na mensagem de erro', async () => {
    const lenta = new Promise(resolve => setTimeout(() => resolve('tarde'), 200));
    await expect(withTimeout(lenta, 33)).rejects.toThrow('33ms');
  });

  it('limpa o timer (clearTimeout) quando a promise resolve primeiro', async () => {
    const spy = jest.spyOn(global, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 1000);
    expect(spy).toHaveBeenCalled();
  });

  it('limpa o timer (clearTimeout) também quando a promise rejeita', async () => {
    const spy = jest.spyOn(global, 'clearTimeout');
    await expect(withTimeout(Promise.reject(new Error('falha-orig')), 1000)).rejects.toThrow('falha-orig');
    expect(spy).toHaveBeenCalled();
  });
});
