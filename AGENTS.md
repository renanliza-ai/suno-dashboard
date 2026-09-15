<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Rotina obrigatória deste projeto

Criada em 15/09/2026 depois de o Renan apontar erro demais no código. A auditoria
mostrou que **quase nenhum erro foi de lógica ou de tipo**: foram de supor a
FORMA ou o ESTADO de algo externo em vez de observar primeiro.

Exemplos reais, todos com `tsc`, `lint` e `build` passando limpos:

- Li `subTotal` para toda métrica do Clarity. `Traffic` usa
  `totalSessionCount`, então o denominador saía **zero em toda linha** e a tela
  ficava vazia **sem erro nenhum**.
- Reportei todos os eventos como ausentes porque supus que a linha da nossa
  própria API tinha campo `label`. É `dimension`.
- Rodei três baterias de validação contra um deploy que não estava no ar.

Tipo escrito à mão para resposta externa não é verificação, é a mesma suposição
escrita duas vezes.

## As três guardas

### 1. `npm run guarda:contrato`

Acha todo arquivo do diff que fala com dado externo e exige UMA prova:

- **Sonda de contrato** no arquivo: um caminho que devolva a forma crua da
  resposta, com os nomes reais dos campos. Marcador: `@sonda-contrato`.
  Referência pronta: `src/lib/clarity-api.ts` devolve `amostraCrua`, e
  `/api/cro/evidence?debug=1` expõe.
- **Anotação** `@forma-observada: <onde e quando eu vi>`, quando a sonda não
  couber.

Também sinaliza coerção para zero (`?? 0`, `|| 0`) alimentando divisão, que é a
receita do zero silencioso.

`--tudo` roda no projeto inteiro. Em 15/09/2026 havia **32 arquivos** de passivo:
a guarda cobra só o que muda, senão travaria tudo para sempre.

### 2. `npm run guarda:deploy`

Compara o SHA que está no ar (`/api/build-info`) com o HEAD local, e **sai com
código 1 se forem diferentes**. Espera até 5 minutos; `-- --agora` responde sem
esperar.

**Rode isto ANTES de qualquer validação contra produção.** Sem ele, o resultado
pode ser do código anterior e a conclusão sai errada sem aviso. Aconteceu três
vezes numa sessão só, mesmo havendo memória avisando.

Também imprime o NOME das variáveis de integração vistas no runtime (nunca o
valor), o que separa "não configurei" de "configurei com outro nome" de
"configurei só em Preview".

### 3. `npm run guarda`

Roda contrato, `tsc --noEmit` e build. É o portão antes de `git push`.

**O lint ficou de fora do portão de propósito.** Em 15/09/2026 o projeto tinha
**105 erros de lint pré-existentes**, a maioria `react-hooks/set-state-in-effect`.
Portão que sempre falha ensina a ignorar portão. O lint continua disponível em
`npm run guarda:lint` e o passivo é dívida a pagar à parte, não desculpa para
código novo sujo.

### ⚠️ Nunca canalize o portão para `grep`

```bash
npm run guarda | grep -i "error"   &&  git push     # ERRADO
```

O código de saída de um pipe é o do ÚLTIMO comando. O `grep` acha o texto,
devolve 0, e o `&&` empurra o push mesmo com a guarda REPROVANDO. Aconteceu em
15/09/2026: a guarda barrou `monday/create-task/route.ts` por falta de prova de
forma, imprimiu o erro, e o push passou assim mesmo.

Use uma destas:

```bash
npm run guarda && git push                       # sem pipe, a forma certa
set -o pipefail; npm run guarda | tail -5 && git push
```

Portão contornado por acidente de shell é pior que portão nenhum: ele dá a
sensação de proteção sem a proteção.

## A pergunta de revisão

A guarda de contrato imprime, com os arquivos na mão:

> Este código supõe a FORMA ou o ESTADO de algum dado que eu não observei NESTA
> sessão?
>
> Não vale a documentação da API, não vale o tipo que eu mesmo escrevi, não vale
> a lembrança de outra vez. Vale ter olhado a resposta crua agora.

Revisão genérica não pega esta classe de erro. Essa pergunta pega.

## Regras que valem sem script

- **Zero silencioso é defeito, não resultado.** Se vieram linhas e TODAS com
  denominador zero, o campo mudou de nome. Falhe alto e liste os campos que
  vieram, para a correção não custar outra rodada. Implementado em
  `src/lib/clarity-api.ts`.
- **Resultado vazio é `rows.length === 0`.** Qualquer outra coisa parecendo
  vazio é suspeita de leitura.
- **Nunca ecoar valor de token.** Nome de variável não é segredo; token é.
