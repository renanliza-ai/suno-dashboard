# Force redeploy — fix no_rows

Garantia de que o commit `451a3b2` + trailing slash fix subiram pra produção:

- Inclui ambas variantes de trailing slash no pathFilter inListFilter
- Trata res sem rows como resposta vazia válida (não erro)
- Cache-Control: no-store no endpoint pra eliminar caches antigos

Trigger date: 2026-05-21
