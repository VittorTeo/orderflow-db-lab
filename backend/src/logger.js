import pino from 'pino';

export function createLogger(level) {
  return pino({ level, base: { servico: 'orderflow-api' }, timestamp: pino.stdTimeFunctions.isoTime });
}
