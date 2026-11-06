# CDU0011. Exibir banner de localização

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Django/Banco de Dados
- **Resumo**: O Usuário visualiza um banner com informações de um local
- **Pré-condição**: Usuário está na tela inicial do aplicativo
- **Pós-Condição**: Usuário é apresentado ao banner informativo do local selecionado

## Fluxo Alternativo I - Usuário pesquisa pelo lugar

1. Usuário
   1. acessa a barra de pesquisa
      ![tela do mapa](./img/cenario-uso-do-mapa-2.png)
   2. Insere o nome de um local
      - O usuário digita por um texto com o teclado recém aberto e confirma a busca.
2. Sistema
   1. Busca as informações do local selecionado
      - O Javascript faz um fetch pelo lugar no banco de dado com o nome mais semelhante.
   2. Expôe os dados de informações, imagens e descrições para o usuário visualmente
      ![tela do mapa](./img/cenario-uso-do-mapa-1.png)
3. Usuário
   1. Aperta no banner
4. Sistema
   1. Amplia a imagem do banner para melhor vizualização