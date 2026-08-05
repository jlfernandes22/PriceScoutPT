import Constants from 'expo-constants';
import { Platform } from 'react-native';

const getApiBaseUrl = () => {
  const productionUrl = Constants.expoConfig?.extra?.apiBaseUrl;
  
  if (productionUrl && productionUrl.trim() !== '') {
    return productionUrl;
  }
  
  // Fallback de desenvolvimento local
  return Platform.select({
    android: 'http://10.0.2.2:3000',
    default: 'http://localhost:3000',
  });
};

export const API_BASE_URL = getApiBaseUrl();

// Secret opcional para proteger o endpoint /api/scrape. Se estiver vazio, a
// aplicação não envia o cabeçalho (o servidor só exige o header se tiver
// SCRAPE_SECRET definido). Preencher apenas se o backend for protegido.
const scrapeSecret = Constants.expoConfig?.extra?.scrapeSecret;
export const SCRAPE_SECRET = (scrapeSecret && scrapeSecret.trim() !== '')
  ? scrapeSecret.trim()
  : '';

console.log(`[Config] API_BASE_URL configurado para: ${API_BASE_URL}`);
console.log(`[Config] SCRAPE_SECRET configurado: ${SCRAPE_SECRET ? 'sim' : 'não'}`);
