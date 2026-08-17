import Constants from 'expo-constants';

// Servidor de produção da aplicação (partilhado por todos os utilizadores).
const PRODUCTION_API_BASE_URL = 'https://pricescoutpt-api.yellowflower-63c75e19.northeurope.azurecontainerapps.io';

const getApiBaseUrl = () => {
  // Override de build (expo extra.apiBaseUrl) — usado por exemplo em
  // desenvolvimento local. Sem override, todos os builds usam o servidor
  // de produção da aplicação.
  const buildUrl = Constants.expoConfig?.extra?.apiBaseUrl;
  if (buildUrl && buildUrl.trim() !== '') {
    return buildUrl.trim();
  }
  return PRODUCTION_API_BASE_URL;
};

export const API_BASE_URL = getApiBaseUrl();

// Secret opcional para proteger o endpoint /api/scrape. Se estiver vazio, a
// aplicação não envia o cabeçalho (o servidor só exige o header se tiver
// SCRAPE_SECRET definido). Preencher apenas se o backend for protegido.
const scrapeSecret = Constants.expoConfig?.extra?.scrapeSecret;
export const SCRAPE_SECRET = (scrapeSecret && scrapeSecret.trim() !== '')
  ? scrapeSecret.trim()
  : '';

// Logs apenas em desenvolvimento (nunca em builds de produção/Play Store).
if (__DEV__) {
  console.log(`[Config] API_BASE_URL configurado para: ${API_BASE_URL}`);
  console.log(`[Config] SCRAPE_SECRET configurado: ${SCRAPE_SECRET ? 'sim' : 'não'}`);
}
