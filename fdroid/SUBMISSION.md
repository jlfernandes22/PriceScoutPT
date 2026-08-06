# Submissão ao F-Droid — Passos

Tudo o que é necessário já está preparado neste repositório:

| Item | Localização |
|---|---|
| Licença GPL-3.0 | `LICENSE` |
| Repositório público | github.com/jlfernandes22/PriceScoutPT |
| Metadata (fastlane) | `fastlane/metadata/android/en-US/` (descrições, changelog, ícone, screenshots) |
| Tag `v1.0.0` | já criada e pushed |
| Build metadata | `fdroid/com.pricescoutpt.app.yml` |

## Passos manuais (GitLab)

1. Cria uma conta em https://gitlab.com (se ainda não tiveres).
2. Faz fork de https://gitlab.com/fdroid/fdroiddata.
3. Clona o fork:
   ```bash
   git clone https://gitlab.com/<TEU-USER>/fdroiddata.git
   cd fdroiddata
   git checkout -b pricescoutpt
   ```
4. Copia o metadata:
   ```bash
   cp <caminho>/fdroid/com.pricescoutpt.app.yml metadata/com.pricescoutpt.app.yml
   ```
5. Commita e faz push do branch:
   ```bash
   git add metadata/com.pricescoutpt.app.yml
   git commit -m "New App: com.pricescoutpt.app"
   git push origin pricescoutpt
   ```
6. Abre um **Merge Request** no fdroiddata (o botão aparece depois do push) com o título
   `New App: com.pricescoutpt.app`.
7. Aguarda. Os pipelines de CI do fdroiddata vão correr o lint e a build. Se falharem,
   lê o log e ajusta o YAML (ver abaixo) — e re-push.

## Se a build falhar no CI

Pontos prováveis de ajuste:

- **NDK/Java**: o RN 0.81 precisa de NDK 27.1 e Java 17. Se o ambiente do buildserver
  não tiver o NDK certo, o log mostra `Failed to find NDK`. Nesse caso, adicionar ao bloco
  `sudo:` os passos de instalação do NDK via sdkmanager, ou pedir ajuda no thread do MR
  (os packagers do F-Droid costumam ajudar com receitas RN/Expo).
- **Node**: a receita instala Node 20 via NodeSource. Se o F-Droid preferir apt,
  usar `apt-get install -y nodejs npm` (apenas se a versão for >= 20).
- **`npm ci`**: se o lockfile conflitar no CI, trocar por `npm install --legacy-peer-deps`.

## Depois do merge

- O F-Droid constrói e publica sozinho (24–48h após o merge no fdroiddata).
- Para versões futuras: basta criar um novo tag (`v1.0.1`...) — o `AutoUpdateMode: Version`
  + `UpdateCheckMode: Tags` trata do resto. Os screenshots/descrições em `fastlane/`
  são puxados automaticamente do upstream.
