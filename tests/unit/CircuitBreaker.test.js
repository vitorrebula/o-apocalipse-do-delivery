const { CircuitBreaker } = require('../../src/resilience/CircuitBreaker');

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ threshold: 0.5, windowSize: 4, minRequests: 2, resetTimeoutMs: 100 });
  });

  describe('Estado CLOSED (normal)', () => {
    it('deve iniciar no estado CLOSED', () => {
      expect(cb.state).toBe('CLOSED');
    });

    it('deve executar a função e retornar o resultado com sucesso', async () => {
      const resultado = await cb.execute(() => Promise.resolve('ok'));
      expect(resultado).toBe('ok');
    });

    it('deve propagar erros sem abrir o circuito prematuramente', async () => {
      await expect(cb.execute(() => Promise.reject(new Error('erro')))).rejects.toThrow('erro');
      expect(cb.state).toBe('CLOSED');
    });
  });

  describe('Transição CLOSED → OPEN', () => {
    it('deve abrir o circuito quando taxa de erro ultrapassa o threshold', async () => {
      // 3 falhas em 4 requisições = 75% > 50%
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('falha'))); } catch (_) {}
      }
      await cb.execute(() => Promise.resolve('ok')).catch(() => {});

      expect(cb.state).toBe('OPEN');
    });

    it('deve lançar erro de circuit breaker aberto sem chamar a função', async () => {
      cb._state = 'OPEN';
      cb._openedAt = Date.now();

      const fn = jest.fn().mockResolvedValue('ok');
      await expect(cb.execute(fn)).rejects.toThrow('Circuit Breaker ABERTO');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('Transição OPEN → HALF_OPEN → CLOSED', () => {
    it('deve passar para HALF_OPEN após resetTimeoutMs', async () => {
      cb._state = 'OPEN';
      cb._openedAt = Date.now() - 200; // já passou o timeout

      const resultado = await cb.execute(() => Promise.resolve('recuperado'));
      expect(resultado).toBe('recuperado');
      expect(cb.state).toBe('CLOSED');
    });

    it('deve voltar para OPEN se a tentativa em HALF_OPEN falhar', async () => {
      cb._state = 'OPEN';
      cb._openedAt = Date.now() - 200;

      try {
        await cb.execute(() => Promise.reject(new Error('ainda falhando')));
      } catch (_) {}

      expect(cb.state).toBe('OPEN');
    });
  });

  describe('reset()', () => {
    it('deve restaurar o circuit breaker ao estado inicial', () => {
      cb._state = 'OPEN';
      cb._requests = [false, false, false];
      cb.reset();

      expect(cb.state).toBe('CLOSED');
      expect(cb._requests).toHaveLength(0);
    });
  });

  describe('Janela deslizante', () => {
    it('deve descartar resultados antigos ao exceder windowSize', () => {
      for (let i = 0; i < 10; i++) {
        cb._addResult(false);
      }
      expect(cb._requests).toHaveLength(4); // windowSize = 4
    });
  });

  describe('Configuração e valores default', () => {
    it('usa valores default quando nenhuma opção é fornecida', () => {
      const def = new CircuitBreaker();
      expect(def.threshold).toBe(0.5);
      expect(def.windowSize).toBe(10);
      expect(def.minRequests).toBe(5); // Math.ceil(10 / 2)
      expect(def.resetTimeoutMs).toBe(30000);
    });

    it('respeita as opções customizadas fornecidas', () => {
      const custom = new CircuitBreaker({ threshold: 0.7, windowSize: 6, minRequests: 3, resetTimeoutMs: 1000 });
      expect(custom.threshold).toBe(0.7);
      expect(custom.windowSize).toBe(6);
      expect(custom.minRequests).toBe(3);
      expect(custom.resetTimeoutMs).toBe(1000);
    });

    it('calcula minRequests como metade do windowSize, arredondado para cima', () => {
      expect(new CircuitBreaker({ windowSize: 7 }).minRequests).toBe(4); // Math.ceil(7 / 2)
    });

    it('inicia com a janela de requisições vazia', () => {
      expect(new CircuitBreaker()._requests).toEqual([]);
    });
  });

  describe('Boundary de abertura do circuito', () => {
    it('abre exatamente ao atingir minRequests com taxa de erro acima do threshold', async () => {
      const c = new CircuitBreaker({ threshold: 0.5, windowSize: 4, minRequests: 2 });
      for (let i = 0; i < 2; i++) {
        try { await c.execute(() => Promise.reject(new Error('f'))); } catch (_) {}
      }
      expect(c.state).toBe('OPEN'); // 2 falhas: errorRate 1.0 > 0.5 e length 2 >= minRequests 2
    });

    it('NÃO abre enquanto não atingir minRequests, mesmo com 100% de falhas', async () => {
      const c = new CircuitBreaker({ threshold: 0.5, windowSize: 10, minRequests: 5 });
      try { await c.execute(() => Promise.reject(new Error('f'))); } catch (_) {}
      expect(c.state).toBe('CLOSED'); // length 1 < minRequests 5
    });

    it('NÃO abre quando errorRate é exatamente igual ao threshold (estritamente maior)', async () => {
      const c = new CircuitBreaker({ threshold: 0.5, windowSize: 4, minRequests: 2 });
      await c.execute(() => Promise.resolve('ok'));                                   // sucesso, length 1
      try { await c.execute(() => Promise.reject(new Error('f'))); } catch (_) {}     // falha, length 2, rate 0.5
      expect(c.state).toBe('CLOSED'); // 0.5 > 0.5 é false
    });

    it('NÃO abre quando a taxa de erro está abaixo do threshold (conta apenas falhas)', async () => {
      const c = new CircuitBreaker({ threshold: 0.5, windowSize: 4, minRequests: 2 });
      await c.execute(() => Promise.resolve('ok'));
      await c.execute(() => Promise.resolve('ok'));
      await c.execute(() => Promise.resolve('ok'));
      try { await c.execute(() => Promise.reject(new Error('f'))); } catch (_) {}     // 1 falha / 4 = 0.25
      expect(c.state).toBe('CLOSED');
    });
  });

  describe('Boundary de reset (OPEN → HALF_OPEN)', () => {
    it('transiciona para HALF_OPEN exatamente quando o tempo decorrido atinge resetTimeoutMs', async () => {
      const c = new CircuitBreaker({ resetTimeoutMs: 100 });
      c._state = 'OPEN';
      c._openedAt = 1000;
      jest.spyOn(Date, 'now').mockReturnValue(1100); // decorrido = 100 (== resetTimeoutMs)

      const resultado = await c.execute(() => Promise.resolve('recuperado'));

      expect(resultado).toBe('recuperado');
      expect(c.state).toBe('CLOSED'); // passou por HALF_OPEN e fechou no sucesso
    });

    it('permanece OPEN logo antes de atingir resetTimeoutMs', async () => {
      const c = new CircuitBreaker({ resetTimeoutMs: 100 });
      c._state = 'OPEN';
      c._openedAt = 1000;
      jest.spyOn(Date, 'now').mockReturnValue(1099); // decorrido = 99 (< resetTimeoutMs)

      const fn = jest.fn().mockResolvedValue('x');
      await expect(c.execute(fn)).rejects.toThrow('Circuit Breaker ABERTO');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('Registro de resultados', () => {
    it('registra sucessos como sucesso na janela (não como falha)', async () => {
      const c = new CircuitBreaker({ threshold: 0.5, windowSize: 4, minRequests: 2 });
      for (let i = 0; i < 4; i++) {
        await c.execute(() => Promise.resolve('ok'));
      }
      expect(c._requests).toEqual([true, true, true, true]);
      expect(c.state).toBe('CLOSED');
    });

    it('_recordSuccess só fecha o circuito a partir de HALF_OPEN, não de OPEN', () => {
      cb._state = 'OPEN';
      cb._recordSuccess();
      expect(cb.state).toBe('OPEN'); // sucesso registrado em OPEN não deve fechar o circuito
    });
  });
});
