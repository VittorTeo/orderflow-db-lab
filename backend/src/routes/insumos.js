import { Router } from 'express';
import { schemas, validar } from '../validation.js';

export function insumosRouter(service) {
  const router = Router();
  const idDe = (req) => validar(schemas.id, req.params.id);

  router.get('/', async (req, res) => res.json(await service.listar()));
  router.post('/', async (req, res) => res.status(201).json(await service.criar(validar(schemas.novoInsumo, req.body))));
  router.post('/:id/entradas', async (req, res) =>
    res.status(201).json(await service.registrarEntrada(idDe(req), validar(schemas.entrada, req.body))));
  router.get('/:id/movimentacoes', async (req, res) =>
    res.json(await service.movimentacoes(idDe(req), validar(schemas.paginar, req.query))));
  return router;
}
