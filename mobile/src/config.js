import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Servidor de produção da aplicação (partilhado por todos os utilizadores).
//
// NOTA F-DROID: este é um serviço de rede operado pelo programador — por isso
// o metadata F-Droid declara o AntiFeature "NonFreeNet". O servidor NÃO é
// fixo: pode ser substituído em runtime (Definições → Servidor) por um
// endpoint próprio/self-hosted, sem reconstruir a app (ver setApiBaseUrl).
export const DEFAULT_API_BASE_URL =
  'https://pricescoutpt-api.yellowflower-63c75e19.northeurope.azurecontainerapps.io';

const SERVER_URL_KEY = '@api_base_url';

// Normaliza um URL de servidor: exige http(s), remove barras finais e
// espaços. Aceita sem esquema ("meuservidor.example:3000" → https://...).
const normalizeBaseUrl = (url) => {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
};

// URL em uso: override de build (expo extra.apiBaseUrl, p.ex. desenvolvimento
// local) ou, na falta dele, o servidor de produção partilhado. Pode ser
// alterado em runtime pelo utilizador (ver setApiBaseUrl).
let currentBaseUrl = (() => {
  const buildUrl = Constants.expoConfig?.extra?.apiBaseUrl;
  if (buildUrl && buildUrl.trim() !== '') return buildUrl.trim();
  return DEFAULT_API_BASE_URL;
})();

// URL do servidor atualmente em uso. Os consumidores devem chamar esta função
// (não guardar o valor) para refletir alterações feitas nas Definições.
export const getApiBaseUrl = () => currentBaseUrl;

// O utilizador está a usar um servidor próprio (não o predefinido)?
export const isCustomApiBaseUrl = () => currentBaseUrl !== DEFAULT_API_BASE_URL;

// Carrega o servidor guardado pelo utilizador (se existir). Deve ser chamado
// uma vez no arranque, antes de qualquer pedido de rede.
export const loadApiBaseUrl = async () => {
  try {
    const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
    const normalized = normalizeBaseUrl(saved);
    if (normalized) {
      currentBaseUrl = normalized;
    }
  } catch (e) {
    console.error('[Config] Erro ao carregar o servidor guardado:', e);
  }
  return currentBaseUrl;
};

// Define um novo servidor (self-hosted). String vazia/null repõe o predefinido.
// Persiste em AsyncStorage para sobreviver a reinícios da app.
export const setApiBaseUrl = async (url) => {
  const normalized = normalizeBaseUrl(url);
  currentBaseUrl = normalized || DEFAULT_API_BASE_URL;
  try {
    if (normalized) {
      await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
    } else {
      await AsyncStorage.removeItem(SERVER_URL_KEY);
    }
  } catch (e) {
    console.error('[Config] Erro ao guardar o servidor:', e);
  }
  return currentBaseUrl;
};

// Secret opcional para proteger o endpoint /api/scrape. Se estiver vazio, a
// aplicação não envia o cabeçalho (o servidor só exige o header se tiver
// SCRAPE_SECRET definido). Preencher apenas se o backend for protegido.
const scrapeSecret = Constants.expoConfig?.extra?.scrapeSecret;
export const SCRAPE_SECRET = (scrapeSecret && scrapeSecret.trim() !== '')
  ? scrapeSecret.trim()
  : '';

// Logs apenas em desenvolvimento (nunca em builds de produção/Play Store).
if (__DEV__) {
  console.log(`[Config] API base URL configurado para: ${currentBaseUrl}`);
  console.log(`[Config] SCRAPE_SECRET configurado: ${SCRAPE_SECRET ? 'sim' : 'não'}`);
}
