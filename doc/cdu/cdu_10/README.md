# CDU0010. Editar mapa

- **Ator principal**: Administrador
- **Atores secundários**: Django/Banco de Dados
- **Resumo**: O Administrador edita as informações e elementos disponíveis no mapa do aplicativo.
- **Pré-condição**: Administrador está autenticado no sistema e possui acesso à funcionalidade de edição do mapa.
- **Pós-Condição**: As alterações realizadas no mapa são salvas e ficam disponíveis para os usuários do aplicativo.

## Fluxo Principal
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1 - Acessa a opção de edição do mapa | |  
| | 2 - Exibe o mapa e os locais cadastrados | 
| 3 - Seleciona o local que deseja editar | | 
| | 4.1 - Busca as informações do local selecionado |
| | 4.2 - Exibe os dados do local para edição | |
| 5 -  Altera as informações desejadas | |
| | 6.1 - Valida os dados informados |
| | 6.2 - Atualiza as informações do local no banco de dados |
| | 6.3 - Atualiza o mapa com as novas informações |
| 7 - Visualiza o mapa atualizado | |


## Fluxo Alternativo I - Administrador pesquisa pelo lugar
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 - Acessa a barra de pesquisa | |  
| 1.2 - Insere o nome de um lugar | 
| | 2.1 - Busca os locais correspondentes no banco de dados |
| | 2.2 - Exibe o local encontrado | |
| 3 -  Seleciona o local desejado | |
| | 4.1 - Busca as informações do local selecionado |
| | 4.2 - Exibe os dados do local para edição |
| 5 - Altera as informações desejadas | |
| | 6.1 - Valida e salva as alterações |
| | 6.2 - Atualiza o mapa com as novas informações |
| 7 - Visualiza o mapa atualizado | |


## Fluxo Alternativo II - Administrador adiciona ou altera informações do local
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1 - Seleciona um local no mapa | |  
| | 2 - Exibe as informações cadastradas |
| 3.1 - Seleciona a opção de editar informações | |
| 3.2 -  Altera o nome, descrição, localização, imagem ou outras informações | |
| | 4.1 - Valida os dados informados |
| | 4.2 - Salva as alterações no banco de dados |
| | 4.3 - Atualiza as informações exibidas no mapa |
| 5 - Visualiza as informações atualizadas | |


## Fluxo de Exceção - Dados inválidos
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Insere informações inválidas ou deixa campos obrigatórios vazios | |
| | 2.1 - Identifica os dados inválidos |
| | 2.2 - Informa quais campos precisam ser corrigidos |
| 3 - Corrige as informações | |
| | 4 - Valida novamente os dados e salva as alterações |


## Fluxo de Exceção - Local Não Encontrado
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Pesquisa por um local inexistente | |
| | 2.1 - Informa que o local não foi encontrado |
| | 2.2 - Sugere verificar o nome digitado ou cadastrar um novo local |

> Obs. as seções a seguir apenas serão utilizadas na segunda unidade do PDSWeb (segundo orientações do gerente do projeto).

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...