# Cron externo (cron-job.org) para disparar el bot cada 15 min

GitHub Actions throttlea los cron de repos gratis: aunque pongamos cada 15 min,
en la práctica corre ~1/hora. La solución gratuita más simple es disparar el
workflow manualmente cada 15 min desde un servicio externo (cron-job.org),
porque los `workflow_dispatch` NO se throttlean.

## Paso 1 — Crear Personal Access Token (GitHub)

1. Abre https://github.com/settings/tokens?type=beta (Fine-grained tokens)
2. Pulsa **Generate new token**
3. Rellena:
   - **Token name:** `arbitrage-bot-cron`
   - **Expiration:** 1 año (o lo que prefieras)
   - **Repository access:** *Only select repositories* → `MiguelMialdeaDev/arbitrage-bot`
   - **Repository permissions:**
     - `Actions` → **Read and write**
     - `Metadata` → Read (se añade solo)
     - `Contents` → Read (se añade solo)
4. **Generate token** → **copia el token** (no lo verás después). Empieza por `github_pat_...`

## Paso 2 — Cuenta en cron-job.org

1. https://cron-job.org/en/signup/ → crear cuenta gratis (gratis hasta 50 jobs, sobra)
2. Verifica el email

## Paso 3 — Crear el cronjob

Dentro del panel, **Create cronjob** con estos campos:

### Common
- **Title:** `Arbitrage Bot`
- **URL:** 
  ```
  https://api.github.com/repos/MiguelMialdeaDev/arbitrage-bot/actions/workflows/bot.yml/dispatches
  ```
- **Schedule:** *Every 15 minutes* (o custom: `*/15 * * * *`)

### Advanced
- **Request method:** `POST`
- **Request body:**
  ```json
  {"ref":"main","inputs":{"mode":"normal"}}
  ```
- **Request headers** (añade uno por uno con el botón "+"):
  - `Accept` → `application/vnd.github+json`
  - `Authorization` → `Bearer github_pat_...` *(pega aquí el token del paso 1)*
  - `X-GitHub-Api-Version` → `2022-11-28`
  - `Content-Type` → `application/json`

### Save

Pulsa **Create** / **Save**.

## Paso 4 — Verificar

1. En cron-job.org panel → el job debería dispararse en los próximos 15 min
2. Tras el primer disparo, mira **Execution history** del job → debe salir HTTP `204` (éxito)
3. Verifica en GitHub: https://github.com/MiguelMialdeaDev/arbitrage-bot/actions → aparecerá un run nuevo con trigger `workflow_dispatch`

## Paso 5 — (Opcional) Probar manualmente desde terminal

Antes de esperar 15 min puedes probar el token/payload con curl:

```bash
curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer github_pat_..." \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/MiguelMialdeaDev/arbitrage-bot/actions/workflows/bot.yml/dispatches \
  -d '{"ref":"main","inputs":{"mode":"normal"}}'
```

Respuesta esperada: `HTTP/2 204` + body vacío → éxito.

## Troubleshooting

- **401 Unauthorized** → el token no tiene permiso `Actions: Read and write` sobre el repo
- **404 Not Found** → revisa la URL (owner/repo) y que el workflow file sea `bot.yml`
- **422 Unprocessable** → el body JSON está mal formado o falta `ref:"main"`
- **403 rate limited** → raro con PAT, pero baja frecuencia si pasa

## Resultado esperado

- 96 runs/día garantizados (4 por hora) en vez de 15-20 actuales
- En 48h aparecerán modelos en 🔥 Hot 24h
- En 7 días aparecerán 🚀 Proven seller
- Coste: 0€
