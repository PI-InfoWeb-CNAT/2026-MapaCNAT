# CDU0011. Exibir banner da aplicação

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Nenhum
- **Resumo**: O Usuário localiza um local pelo mapa
- **Pré-condição**: Usuário está na tela inicial da aplicação
- **Pós-Condição**: Usuário é apresentado um banner informativo do local

## Fluxo Principal

1. Usuário
   1. Aperta duas vezes no lugar da tela em que está o local que deseja conhecer
      ![tela do mapa](./img/cenario-uso-do-mapa-0.png)
2. Sistema
   1. Registrar o local de aperto relativo ao mapa
      - Javascript obtêm as coordenadas do ponto de toque na tela e processa o objeto em colisão com o toque.
   2. Busca as informações do local selecionado
      - O django retorna ao javascript os dados do local selecionado.
   3. Expôe os dados de informações, imagens e descrições para o usuário visualmente.
      ![tela do mapa](./img/cenario-uso-do-mapa-1.png)
3. Usuário
   1. Aperta no banner
4. Sistema
   1. Amplia a imagem do banner para melhor vizualização