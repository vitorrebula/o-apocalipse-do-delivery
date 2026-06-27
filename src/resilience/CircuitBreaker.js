/**
 * Circuit Breaker com 3 estados: CLOSED → OPEN → HALF_OPEN (RF05/RN07).
 * Abre o circuito quando a taxa de erro acumulada ultrapassa `threshold` (padrão: 50%).
 * Após `resetTimeoutMs`, passa para HALF_OPEN e permite uma tentativa de teste.
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.threshold = options.threshold || 0.5;
    this.windowSize = options.windowSize || 10;
    this.minRequests = options.minRequests || Math.ceil(this.windowSize / 2);
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this._state = 'CLOSED';
    this._requests = [];
    this._openedAt = null;
  }

  get state() {
    return this._state;
  }

  async execute(fn) {
    if (this._isOpen()) {
      throw new Error('Circuit Breaker ABERTO: serviço indisponível, tente novamente mais tarde');
    }

    try {
      const result = await fn();
      this._recordSuccess();
      return result;
    } catch (error) {
      this._recordFailure();
      throw error;
    }
  }

  _isOpen() {
    if (this._state === 'OPEN') {
      if (Date.now() - this._openedAt >= this.resetTimeoutMs) {
        this._state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  _recordSuccess() {
    this._addResult(true);
    if (this._state === 'HALF_OPEN') {
      this._state = 'CLOSED';
    }
  }

  _recordFailure() {
    this._addResult(false);
    // Em HALF_OPEN, qualquer falha reabre o circuito imediatamente
    if (this._state === 'HALF_OPEN') {
      this._state = 'OPEN';
      this._openedAt = Date.now();
      return;
    }
    if (this._requests.length < this.minRequests) return;
    const errorRate = this._requests.filter(r => !r).length / this._requests.length;
    if (errorRate > this.threshold) {
      this._state = 'OPEN';
      this._openedAt = Date.now();
    }
  }

  _addResult(success) {
    this._requests.push(success);
    if (this._requests.length > this.windowSize) {
      this._requests.shift();
    }
  }

  reset() {
    this._state = 'CLOSED';
    this._requests = [];
    this._openedAt = null;
  }
}

module.exports = { CircuitBreaker };
