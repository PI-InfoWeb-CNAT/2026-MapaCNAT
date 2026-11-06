# CDU0011. Exibir banner da aplicação

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Nenhum
- **Resumo**: O Usuário localiza um local pelo mapa
- **Pré-condição**: Usuário está na tela inicial da aplicação
- **Pós-Condição**: Usuário é apresentado um banner informativo do local

## Fluxo Alternativo II - Usuário usa sugestão de pesquisa

1. Usuário
   1. acessa a barra de pesquisa
      ![tela do mapa](./img/cenario-uso-do-mapa-2.png)
   2. Insere o nome de um local
      - O usuário digita por um texto com o teclado recém aberto.
2. Sistema
   1. Sugere lugares relacionados
      ![tela do mapa](./img/cenario-uso-do-mapa-3.png)
3. Usuario
   1. Usuário seleciona uma das sugestões de lugar
      - O usuário aperta um dos locais das sugestões apresentadas.
4. Sistema
   1. Busca os dados do lugar
      - Javascript faz um fetch pelo local em específico selecionado pelo usuário.
   2. Expôe os dados de informações, imagens e descrições para o usuário visualmente
      ![tela do mapa](./img/cenario-uso-do-mapa-1.png)
5. Usuário
   1. Aperta no banner
6. Sistema
   1. Amplia a imagem do banner para melhor vizualização