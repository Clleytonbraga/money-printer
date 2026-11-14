# Handoff: The Money Printer (recebido em 2026-11-13)

Texto colado pelo Cleyton, vindo de outra sessão. O zip do código (Vite + TypeScript + three.js) ainda não está neste Mac.

## Produto
Uma foto de uma sala branca com uma impressora em cima da mesa. O visitante clica em "Print money" e uma nota de brinquedo sai da impressora, escorrega pela bandeja, cai com física de papel e pousa num monte. O monte cresce com o total impresso por todo mundo (começa em 4.312).
- Todo visitante ganha 3 prints grátis (notas verdes). Tinta paga imprime notas douradas.
- Pacotes: Small 5 prints / $0.99 · Medium 30 / $2.99 (mais popular) · Large 120 / $9.99.
- SÓ o Large libera foto. Fluxo do Large: 1 Tinta → 2 Pagamento (Stripe, fora do site) → 3 Foto → 4 Nota (nome, texto de até 140 caracteres, link) e impressão.
- Small e Medium: depois do pagamento voltam direto para a sala e imprimem notas douradas sem foto.
- Clicar em qualquer nota abre um popup com número, nome, texto, link e foto. O popup tem o atalho "Get the Large ink".
- Tratamento da foto: preto e branco, depois o tom da tinta da nota, depois multiplicada sobre o papel, com a gravura da nota por cima.
- Textos da interface em inglês. Respostas em pt-BR.

## Design
Canvas Claude Design: https://claude.ai/artifact/JA7LjRPYSDj4BuuAfrjFnW
- Pranchetas: Desktop · sala, Celular deitado, Celular em pé, Notas, Compra 1 (tinta), Compra 3 (foto), Compra 4 (nota e impressão), Nota aberta (popup) e "Protótipo completo" (interativa, clicar em Play).
- Estilo tipo Apple: fundo #f5f5f7, azul #0066cc, cards brancos com raio 18px, botões em pílula, painéis de vidro com blur, SF Pro. Regras em `DESIGN.md`.

## Código (zip: Vite + TypeScript + three.js, sem framework de UI)
- `npm install && npm run dev`
- `?debug` abre o painel de calibração. `?lite` força o modo leve.
- `npx tsx scripts/sim-bill.ts 20` simula as quedas no terminal.
- Ler `CLAUDE.md` (arquitetura e regras) e `docs/realismo.md` (física e próximos passos).
- Build e fluxo completo testados em navegador sem placa de vídeo. Ainda não visto em GPU real nem com a foto real.

Partes principais:
- `src/config.ts`: tudo que se ajusta.
- `physics/billBody.ts`: papel como placa fina (força na face ∝ |v|·vn, flutter pelo centro de pressão, vento leve, contato por impulsos em 9 pontos, a nota deita ao tocar).
- `physics/heightfield.ts`: chão, mesa e bandeja lisa, mais o monte com ângulo de repouso. A impressora não entra no heightfield.
- `scene/billBatch.ts`: notas instanciadas, shader de dobra, ondulação, cedência ao sair da fenda e amassado. A nota dourada é feita no shader.
- `scene/pileMesh.ts`: superfície do monte. Notas acima de `visualCap` são aposentadas nela.
- `scene/stage.ts`: foto e canvas travados no mesmo aspecto, sombras sobre a foto, oclusores do tampo da mesa e da impressora.
- `audio/sfx.ts`: sons sintetizados.
- `ui/app.ts`: HUD e telas.
- `payments.ts`: checkout simulado.

## Pendente
1. Colocar os arquivos do design em `public/assets/`: `room.jpg`, `bill-green.webp` e `music.mp3` (opcional). Sem eles o projeto usa uma nota desenhada por código e uma sala cinza. Os dois primeiros já estão prontos em `handoff-assets/`.
2. Calibrar câmera, mesa, impressora e fenda com a foto via `?debug`, depois "Copy config" e colar em `config.ts`.
3. Stripe Checkout de verdade: backend com `/api/checkout` e webhook.
4. Contador global e notas compartilhadas (dono, texto, link, foto) vindos de uma API. O monte inicial nasce desse dado.
5. Moderação de foto e texto.
6. Layouts de celular do design: no "em pé", a foto fica ancorada embaixo e some aos poucos no topo, sobre #e4e2e3.
7. Realismo (`docs/realismo.md`), na ordem: papel deslizar perto do chão antes de parar, notas empurrando notas, papel dobrável (PBD), oclusores para as pernas da mesa, environment map tirado da foto, impressora acelerando com a fila cheia, vibração no celular.

## Atualização de 2026-11-13 (noite)

Feito:
- Itens 1, 2 e 6 do "Pendente" (arquivos, calibração, layouts de celular).
- Correção da textura do monte, que derrubava o WebGL em placa real.
- Física: empurrão de contato limitado, borda de mesa tratada como degrau, chão de verdade embaixo da mesa, `releaseSpeed` 0,9.
- Gestos nas notas: clique abre, arrastar espalha, segurar pega uma nota ou um punhado.
- Código da cota grátis: 3 impressões a cada 24h, por IP + aparelho, contadas no Supabase. Falta publicar.

Regra nova de produto: 3 impressões grátis a cada 24h (a partir da 1ª). O relógio é o do servidor.

Publicado: site em https://clleytonbraga.github.io/money-printer/ (`npm run deploy`), código em https://github.com/Clleytonbraga/money-printer. PRD e handoff completos estão no Notion.
