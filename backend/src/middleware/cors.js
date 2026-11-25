// Lista explícita de origens, nunca "*".
export function cors(origins) {
  const permitidas = new Set(origins);
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    const permitida = origin !== undefined && permitidas.has(origin);
    if (permitida) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Expose-Headers', 'X-Request-Id, Location');
    }
    if (req.method === 'OPTIONS' && req.get('Access-Control-Request-Method')) {
      if (permitida) {
        res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '600');
      }
      return res.status(204).end();
    }
    return next();
  };
}
