# Realismo das notas: física e animação

Este documento descreve o que já está no código e o que vale fazer depois, em ordem de impacto.

## O que já está implementado

### 1. Saída da impressora

- O papel sai da fenda em `emergeTime` (1,25 s), com um avanço levemente aos trancos, como o motor de passo de uma impressora real.
- A parte que já saiu da fenda cede com o peso (deformação proporcional a `emerge²` no shader).
- O som acompanha o mesmo ritmo: chiado de papel e o zumbido do motor em pulsos.
- Uma caixa invisível no lugar da impressora esconde a nota enquanto ela ainda está dentro dela.

### 2. Bandeja e queda

- Na frente da fenda existe uma bandeja inclinada e lisa (atrito × 0,15). O papel escorrega por ela e cai da ponta.
- O que faz a nota tombar ao sair da bandeja é a física de verdade: quando a ponta passa da borda, o peso sem apoio inclina a nota para baixo.

### 3. Papel no ar: modelo de placa fina

Baseado no modelo de "falling paper" (Andersen, Pesavento & Wang, 2005), em 3D:

| Efeito | Na prática | Parâmetro |
|---|---|---|
| Força na face ∝ \|v\|·vₙ | Freia muito quando está de frente e funciona como asa quando está quase de lado. Faz a nota planar para os lados | `kNormal` |
| Arrasto na borda | A nota corta o ar de lado | `kTangent` |
| Sustentação por circulação | Curvas mais longas | `kLift` |
| Centro de pressão perto da borda da frente | Levanta o nariz, perde sustentação, volta para o outro lado. É o balanço de folha caindo | `copShift`, `kTorque` |
| Amortecimento do giro (implícito) | Giros naturais, sem explodir | `rotDamp`, `rotDamp2` |
| Corrente de ar da sala (value noise 3D) | Cada nota cai de um jeito | `windStrength` |

A inércia é anisotrópica: girar em torno do eixo comprido é fácil, mas esse giro empurra muito ar, por isso é o eixo mais amortecido. Esse equilíbrio entre "gira fácil" e "freia forte" é o que produz o tombo característico do papel.

### 4. Pouso

- Contato por impulsos sequenciais em 9 pontos da nota (3 × 3). É estável em qualquer velocidade e não atravessa o chão.
- Atrito de Coulomb, com o cone limitado por `friction`.
- O papel é mole: quando toca o chão, um torque deita a nota (`flatten`) em vez de deixá-la rolar de lado como uma moeda.
- No primeiro pouso de verdade (fora da bandeja), a nota amassa: duas dobras e um ruído em escala de papel no shader (`crumple` de 0,35 a 0,85, animado).
- Um farfalhar toca com volume proporcional à velocidade do impacto.

### 5. O monte

- Um heightfield de 2 cm guarda o chão, a mesa e a bandeja, mais a altura do monte.
- Cada nota que para soma uma "pegada" retangular, mais alta no centro, porque papel amassado prende ar.
- Um relaxamento por ângulo de repouso (`repose`, cerca de 31°) escoa o excesso para os vizinhos e transforma o empilhamento num morro natural.
- As notas novas caem em cima do monte, porque o contato usa o heightfield.
- Até `visualCap` notas existem em 3D. As mais antigas viram a superfície do monte, uma malha com colagem de notas e borda irregular. Isso deixa o monte crescer sem limite e manter o FPS.
- O monte inicial nasce do contador global, então todo visitante vê o morro do tamanho do que já foi impresso.

### 6. Visual

- Uma luz de janela com sombras suaves e superfícies invisíveis que só recebem sombra, para as notas projetarem sombra no chão e na mesa da foto.
- Normais recalculadas no shader, então a luz acompanha cada dobra.
- Nota dourada: a mesma gravura convertida para tinta dourada, um pouco metálica.
- Verso da nota mais escuro.

## Próximos passos sugeridos (do maior para o menor ganho)

1. **Calibrar com a foto real.** É o que mais pesa no realismo. Sombra e oclusão só convencem com a câmera batendo com a imagem.
2. **Oclusão da mesa completa.** Hoje só o tampo e a impressora escondem as notas. Adicionar as pernas (caixas finas em `stage.ts`) ou, melhor, uma máscara de profundidade pintada sobre a foto.
3. **Papel como pano leve (PBD).** Trocar a deformação procedural por uma grade de 12 × 5 partículas com restrições de distância e dobra, com 4 a 8 iterações. A nota passa a se dobrar de verdade ao bater na quina da mesa e ao cair em cima de outra. Rodar só para as notas no ar (poucas por vez) e congelar a forma ao parar.
4. **Notas empurrando notas.** Uma nota que pousa poderia deslizar as notas recentes que estão embaixo: um pequeno impulso nas 3D mais próximas, acordando-as por alguns frames.
5. **Ar deslocado.** Quando a nota está quase no chão, aplicar o efeito solo: mais sustentação perto da superfície, que faz o papel deslizar alguns centímetros antes de parar. É um detalhe muito reconhecível.
6. **Luz tirada da foto.** Gerar um environment map a partir da própria foto (`PMREMGenerator`) para o reflexo dourado bater com a sala.
7. **Oclusão de ambiente no monte.** Escurecer os vales do heightfield (curvatura negativa) e o pé do monte. É barato e dá volume.
8. **Quantidade de impressão.** Com a fila cheia, a impressora pode acelerar (`emergeTime` menor) e emitir várias notas meio sobrepostas, como uma impressora de verdade sob carga.
9. **Câmera viva.** Um tremor sutil de "câmera na mão" e um leve zoom quando o monte passa da mesa reforçam o momento.
10. **Háptica no celular.** `navigator.vibrate(8)` em cada pouso perto da câmera.

## Desempenho

- Uma draw call por tipo de nota (instancing). Cada foto enviada vira um lote próprio.
- Só as notas no ar rodam física. As paradas custam apenas o shader.
- Modo leve: 12 × 5 vértices por nota, 500 notas 3D, sombra de 1024 px, pixel ratio 1.
- Se precisar de mais: congelar a deformação das notas paradas numa geometria estática por lote (merge a cada 200 notas) e desligar `castShadow` delas.
