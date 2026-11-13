# CDU002. Uso de Sugestões do Banner

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Nenhum
- **Resumo**: O Usuário localiza um local pelo banner
- **Pré-condição**: Usuário está vendo um banner
- **Pós-Condição**: Usuário é redirecionado a outro banner

## Fluxo Principal

| **Ações do ator** | **Ações do sistema** |
| :-----------------: | :-----------------: |
| 1 - Seleciona uma sugestão de local disponível no banner | |
| | 2 - Identifica o local selecionado pelo usuário |
| | 3 - Busca as informações correspondentes ao local selecionado |
| | 4 - Obtém os dados, imagens e descrições do local |
| | 5 - Exibe visualmente as informações do local selecionado no banner |
| 6 - Visualiza as informações apresentadas | |

## Fluxo Alternativo I - Informações do local não encontradas

| **Ações do ator** | **Ações do sistema** |
| :-----------------: | :-----------------: |
| 1 - Seleciona uma sugestão de local disponível no banner | |
| | 2 - Busca as informações correspondentes ao local selecionado |
| | 3 - Identifica que não existem informações disponíveis para o local |
| | 4 - Informa que não foi possível carregar os dados do local selecionado |
| 5 - Retorna à visualização do banner anterior | |

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...
