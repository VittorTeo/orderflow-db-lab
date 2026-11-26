// Endereço da API usado pelo frontend.
// Ao publicar o backend, coloque a URL HTTPS na linha 5, sem barra no final,
// e acrescente a mesma origem ao connect-src da CSP em firebase.json.
// Vazio: o site publicado roda sempre em modo demonstração.
export const API_URL_PRODUCAO = '';

// Na sua máquina, usa a API do Docker Compose.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API_URL = local ? 'http://localhost:3000' : API_URL_PRODUCAO;
