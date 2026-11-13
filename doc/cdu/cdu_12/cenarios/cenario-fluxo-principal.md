# CDU0012. Traçar rota entre pontos

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Nenhum
- **Resumo**: Traça rota entre pontos no mapa
- **Pré-condição**: Usuário está na tela de interação com o mapa
- **Pós-Condição**: Uma rota é traçada de um ponto ao outro 

## Fluxo Principal

1. Usuário
   1. Usuário aperta em um ponto do mapa
      ![tela do mapa](./img/cenario-tracar-rota-0.png)
   2. Usuário aperta em outro ponto
      ![tela do mapa](./img/cenario-tracar-rota-1.png)
   
2. Sistema
   1. Registra o primeiro ponto selecionado
      - Javascript armazena as cordenadas do ponto selecionado
   2. Registra o segundo ponto selecionado
      - Javascript armazena as cordenadas do outro ponto selecionado
   3. Relaciona o primeiro ponto ao segundo
      - Busca nas rotas salvas a rota mais eficiente entre os pontos
   4. Mostra a rota selecionada em azul entre os pontos
      ![tela do mapa](./img/cenario-tracar-rota-2.png)