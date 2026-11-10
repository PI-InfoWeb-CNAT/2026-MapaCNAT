# CDU004. Pinar lugar

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Nenhum
- **Resumo**: O usuário marca a localização de um determinado lugar no mapa do instituto, podendo realizar essa ação por meio da seleção direta de um ponto no mapa, da pesquisa pelo nome do local ou do redirecionamento por meio de um link disponível no banner.
- **Pré-condição**: Usuário está na tela inicial da aplicação, visualizando o mapa do instituto.
- **Pós-Condição**: O mapa é atualizado e apresenta um pino indicando a localização selecionada pelo usuário.

## Fluxo Principal

| **Ações do ator** | **Ações do sistema** |
| :-----------------: | :-----------------: |
| 1 - Seleciona um ponto dentro do mapa do instituto | |
| | 2 - Identifica e registra as coordenadas geográficas do ponto selecionado |
| | 3 - Atualiza a visualização do mapa para apresentar um pino na localização selecionada |
| 4 - Visualiza o pino indicando a localização selecionada | |

## Fluxo Alternativo I - Pinar por pesquisa

| **Ações do ator** | **Ações do sistema** |
| :-----------------: | :-----------------: |
| 1 - Acessa a barra de pesquisa | |
| 2 - Insere o nome do lugar desejado | |
| 3 - Seleciona um local apresentado nos resultados da pesquisa | |
| | 4 - Identifica o local selecionado pelo usuário |
| | 5 - Obtém as coordenadas geográficas correspondentes ao local selecionado |
| | 6 - Atualiza a visualização do mapa para apresentar um pino na localização correspondente |
| 7 - Visualiza o pino indicando o local selecionado | |

## Fluxo Alternativo II - Pinar por redirecionamento

| **Ações do ator** | **Ações do sistema** |
| :-----------------: | :-----------------: |
| 1 - Acessa um local por meio da aplicação | |
| 2 - Seleciona o link disponibilizado no banner referente ao local | |
| | 3 - Identifica o local associado ao link selecionado |
| | 4 - Obtém as coordenadas geográficas correspondentes ao local |
| | 5 - Atualiza a visualização do mapa para apresentar um pino na localização correspondente |
| 6 - Visualiza o pino indicando o local selecionado | |

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...
