// Gesotório de configuração Expo.
// Regras:
//  - app.json tem os valores por defeito (placeholders vazios) e é commitado.
//  - app.config.local.json existe apenas localmente (ignorado pelo git) e
//    sobrepõe os valores reais de apiBaseUrl / scrapeSecret para este build.
// Assim nenhum segredo/URL de produção entra no repositório.
const path = require('path');
const fs = require('fs');

const base = require('./app.json');
const localPath = path.join(__dirname, 'app.config.local.json');
if (fs.existsSync(localPath)) {
  const local = require(localPath);
  const baseExtra = base.expo.extra || {};
  base.expo.extra = { ...baseExtra, ...(local.expo && local.expo.extra ? local.expo.extra : {}) };
}

module.exports = base;