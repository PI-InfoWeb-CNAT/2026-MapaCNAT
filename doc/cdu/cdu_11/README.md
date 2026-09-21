# CDU0011. Exibir banner de localização

- **Ator principal**: Usuário qualquer
- **Atores secundários**: Django/Banco de Dados
- **Resumo**: O Usuário visualiza um banner com informações de um local
- **Pré-condição**: Usuário está na tela inicial do aplicativo
- **Pós-Condição**: Usuário é apresentado ao banner informativo do local selecionado

## Fluxo Principal
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1 -  Aperta no local desejado no mapa | |
| | 2 - Registra o local selecionado | 
| | 3 - Busca as informações do local | | 
| | 4 - Exibe o banner com informações, imagens e descrições do local |
| 5 - Visualiza o banner de localização | |

## Fluxo Alternativo I - Usuário pesquisa pelo lugar
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 -  Acessa a barra de pesquisa | |
| 1.2 -  Insere o nome de um lugar  | |
| | 2.1 - Busca as informações do local selecionado |
| | 2.2 - Exibe o banner com informações, imagens e descrições do local |
| 3 - Visualiza o banner de localização | |

## Fluxo Alternativo II - Usuário usa sugestão de pesquisa
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 -  Acessa a barra de pesquisa | |
| 1.2 -  Insere o nome de um lugar  | |
| | 2 -  Sugere lugares relacionados |
| 3.1 -  Seleciona uma das sugestões de lugar	 | |
| | 3.2 - Busca os dados do lugar |
| | 3.3 - Exibe o banner com informações, imagens e descrições do local |
| 4 -    Visualiza o banner de localização ||


## Fluxo de Exceção - Dados inválidos
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Digita um local que não existe	 | |
| | 2.2 -  Informa que o local não foi encontrado e sugere verificar a escrita |

> Obs. as seções a seguir apenas serão utilizadas na segunda unidade do PDSWeb (segundo orientações do gerente do projeto).

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...
quero que faça essa mesma estrutura mas com o cdu Exibir banner de localização