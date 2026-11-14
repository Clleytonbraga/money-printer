# The Money Printer

A sala branca com a impressora que imprime dinheiro de brinquedo. As notas saem da impressora, caem com física de papel e formam um monte no chão que cresce com o total impresso por todo mundo.

Stack: Vite + TypeScript + three.js. Não usa framework de UI (é DOM simples por cima do canvas 3D).

## Rodar

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host   # para abrir no celular na mesma rede
npm run build        # gera dist/
```

Parâmetros de URL:

- `?debug` abre o painel de calibração e as caixas de referência (mesa, impressora, saída do papel).
- `?lite` força o modo leve (é automático em telas estreitas e máquinas com 4 núcleos ou menos).

## Primeiro passo: colocar os arquivos do design

Copie para `public/assets/`:

| Arquivo | O que é |
|---|---|
| `room.jpg` | A foto da sala, a mesma do canvas de design |
| `bill-green.webp` | A arte da nota verde, com o círculo vazio no centro |
| `music.mp3` (opcional) | A música de fundo, em loop |

Sem esses arquivos o projeto continua rodando, com uma nota desenhada por código e uma sala cinza.

## Segundo passo: calibrar a câmera com a foto

O 3D é desenhado por cima da foto. Para as notas caírem no chão e na mesa da foto, a câmera e a posição da mesa e da impressora precisam bater com a imagem.

1. Abra `http://localhost:5173/?debug`.
2. Em **Camera**, ajuste `fov`, `pos` e `target` até a grade do chão seguir o piso da foto.
3. Em **Table** e **Printer**, encaixe as caixas rosa e azul na mesa e na impressora.
4. Coloque a bolinha verde (`slot`) na fenda da impressora. A seta mostra para onde o papel sai.
5. Use **Print ten** para testar e **Copy config** para copiar os valores. Cole em `src/config.ts`.

Enquanto você ajusta, os valores ficam salvos no navegador. **Reset** apaga.

## Mapa do código

```
src/
  config.ts              tudo que se ajusta: câmera, mesa, impressora, física, monte
  main.ts                junta tudo e roda o loop
  state.ts               carteira (tinta grátis e paga), pacotes, tela atual
  payments.ts            checkout simulado, com o roteiro do Stripe nos comentários
  physics/
    billBody.ts          física de papel caindo (arrasto, sustentação, flutter, contato)
    heightfield.ts       chão, mesa, bandeja e o monte de notas (com ângulo de repouso)
    noise.ts             corrente de ar suave da sala
  scene/
    stage.ts             foto + canvas 3D travados juntos, luz, sombras, oclusores
    billBatch.ts         notas instanciadas, shader de dobra, ondulação e amassado
    billTexture.ts       arte da nota, foto tratada na nota, textura do monte
    pileMesh.ts          superfície do monte
    world.ts             fila da impressora, notas vivas, aposentadoria no monte, clique
  audio/sfx.ts           sons sintetizados (impressora, papel soltando, papel caindo)
  ui/app.ts              HUD e telas: loja, pagamento, foto, nota, popup
  debug.ts               painel de calibração (?debug)
scripts/sim-bill.ts      simula quedas no terminal para ajustar a física
docs/realismo.md         como a física funciona e o que dá para melhorar
```

## Ajustar a física sem abrir o navegador

```bash
npx tsx scripts/sim-bill.ts 20
```

O script mostra, para cada nota, quando tocou, onde parou, quantas vezes trocou de direção (swoops), quantas vezes virou (flips) e quanto amassou.

## O que ainda é simulado

- **Pagamento:** `src/payments.ts` finge que o pagamento deu certo. O roteiro para o Stripe Checkout está no arquivo.
- **Contador global:** `count` e o monte inicial vêm de `CONFIG.pile.initialBills`. Precisam vir de uma API.
- **Notas de outras pessoas:** só as notas impressas neste navegador têm nome, texto e foto. As do monte inicial são anônimas.
- **Moderação de foto e texto:** ainda não existe.
