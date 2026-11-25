import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('')
});

// Falhar na inicialização é melhor do que descobrir a configuração errada em produção.
export function loadConfig(env = process.env) {
  const values = schema.parse(env);
  return {
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    corsOrigins: values.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  };
}
