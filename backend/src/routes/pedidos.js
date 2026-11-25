import { Router } from 'express';
import { schemas, validar } from '../validation.js';

// Express 5 encaminha rejeições de handlers async ao tratador de erros.
export function pedidosRouter(service) {
  const router = Router();
  const idDe = (req) => validar(schemas.id, req.params.id);

  router.get('/', async (req, res) => res.json(await service.listar(validar(schemas.listarPedidos, req.query))));
  router.get('/:id', async (req, res) => res.json(await service.buscar(idDe(req))));
  router.post('/', async (req, res) => {
    const pedido = await service.criar(validar(schemas.novoPedido, req.body));
    res.status(201).location(`/api/pedidos/${pedido.id}`).json(pedido);
  });
  router.patch('/:id', async (req, res) =>
    res.json(await service.editar(idDe(req), validar(schemas.editarPedido, req.body))));
  router.patch('/:id/etapa', async (req, res) =>
    res.json(await service.mudarEtapa(idDe(req), validar(schemas.mudarEtapa, req.body).etapa)));
  router.delete('/:id', async (req, res) => {
    await service.excluir(idDe(req));
    res.status(204).end();
  });
  return router;
}
