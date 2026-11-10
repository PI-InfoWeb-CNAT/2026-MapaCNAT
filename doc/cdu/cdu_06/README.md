# CDU006. Receber localização

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Nenhum
- **Resumo**: O usuário recebe uma localização por meio de um redirecionamento para o aplicativo, que atualiza o mapa de acordo com as coordenadas recebidas.
- **Pré-condição**: Usuário acessou um link de redirecionamento para o aplicativo contendo as coordenadas de uma localização.
- **Pós-Condição**: O mapa é atualizado e centralizado na localização correspondente às coordenadas recebidas.

## Fluxo Principal

| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: |
| 1 - Acessa o link de redirecionamento para o aplicativo | |
| | 2 - Recebe as coordenadas geográficas enviadas pelo redirecionamento |
| | 3 - Valida as coordenadas recebidas |
| | 4 - Atualiza o mapa, centralizando a visualização na localização correspondente |
| 5 - Visualiza a localização indicada no mapa | |

## Fluxo Alternativo I - Coordenadas inválidas ou não encontradas

| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: |
| 1 - Acessa o link de redirecionamento para o aplicativo | |
| | 2 - Recebe as coordenadas geográficas enviadas pelo redirecionamento |
| | 3 - Identifica que as coordenadas são inválidas ou não foram encontradas |
| | 4 - Informa que não foi possível localizar o endereço |
| 5 - Permanece na visualização padrão do mapa | |

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...
