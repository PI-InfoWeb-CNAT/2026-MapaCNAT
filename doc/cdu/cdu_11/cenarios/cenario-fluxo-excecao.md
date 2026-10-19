# CDU0011. Exibir banner da aplicação

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Django/Banco de Dados
- **Resumo**: O Usuário localiza um local pelo mapa
- **Pré-condição**: Usuário está na tela inicial da aplicação
- **Pós-Condição**: Usuário é apresentado um banner informativo do local

## Fluxo de Exceção - Dados inválidos
1. Usuário
    1. Digita um local que não existe
        - O usuário digita um local que não existe significa que o nome em questão não está presente no banco de dados e não possui nenhuma alternativa com o nível de confiança alto o suficiente.
2. Sistema
    1. Informa que o local não foi encontrado e sugere verificar a escrita
        - A lista da barra de busca mostra uma única mensagem informando o usuário de que não há lugares com o nome digitado.
        ![tela do mapa](./img/cenario-uso-do-mapa-3.png)