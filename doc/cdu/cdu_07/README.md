# CDU0013. Realizar login

- **Ator principal**: Usuário
- **Atores secundários**: Django/Banco de Dados
- **Resumo**: O Usuário realiza autenticação no sistema por meio de suas credenciais de acesso.
- **Pré-condição**: Usuário está na tela inicial do aplicativo ou na tela de login.
- **Pós-Condição**: Usuário é autenticado e tem acesso às funcionalidades disponíveis para sua conta.

## Fluxo Principal
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1 - Acessa a opção de login | |  
| | 2 - Exibe o formulário de login | 
| 3 - Insere seu e-mail ou nome de usuário | | 
| 4 - Insere sua senha |
| 5 - Seleciona a opção "Entrar" | |
| | 6 -  Valida os dados informados | |
| | 7 -  Consulta as credenciais no banco de dados |
| | 8 -  Autentica o usuário |
| | 9 -  Redireciona o usuário para a tela inicial do aplicativo |
| 10 - Acessa as funcionalidades disponíveis | |


## Fluxo Alternativo I - Usuário informa credenciais incorretas
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 - Insere seu e-mail ou nome de usuário | |  
| 1.2 - Insere uma senha incorreta | 
| 2 - Seleciona a opção "Entrar" | 
| | 2.1 - Valida as credenciais informadas |
| | 2.2 - Identifica que os dados estão incorretos | |
| | 2.3 - Informa que o usuário ou senha estão incorretos | |
| 3 - Corrige as credenciais | |
| | 4 - Realiza uma nova validação | |
| | 5 - Autentica o usuário |
| 6 - Acessa o sistema | |


## Fluxo Alternativo II - Usuário esqueceu a senha
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 - Acessa a opção "Esqueci minha senha" | |  
| | 2 - Exibe o formulário para recuperação de senha |
| 3 -   Informa o e-mail cadastrado | |
| 4 -   Solicita a recuperação da senha |
| | 5 - Verifica o e-mail informado no banco de dados |
| | 6 - Envia as instruções para recuperação da senha |
| 7 - Acessa as instruções recebidas | |
| 8 - Cadastra uma nova senha | |
| | 9 - Atualiza a senha no banco de dados | |
| 10 - Retorna à tela de login | |


## Fluxo de Exceção - Campos Obrigatórios Não Preenchidos
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Tenta realizar o login sem preencher um ou mais campos obrigatórios | |
| | 2 - Identifica os campos não preenchidos |
| | 3 - Informa que os campos obrigatórios devem ser preenchidos |
| 4 - Preenche os campos solicitados | |
| | 5 - Valida os dados novamente |
| | 6 - Realiza a autenticação do usuário | 



## Fluxo de Exceção - Usuário Não Cadastrado
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Informa um e-mail ou nome de usuário não cadastrado | |
| 2 - Insere a senha |
| 3 - Seleciona a opção "Entrar" |
| | 4 - Consulta os dados no banco de dados | |
| | 5 - Identifica que não existe uma conta correspondente |
| | 6 - Informa que o usuário não foi encontrado |
| 7 - Opta por realizar o cadastro |
| | 8 - Redireciona o usuário para a tela de cadastro |

> Obs. as seções a seguir apenas serão utilizadas na segunda unidade do PDSWeb (segundo orientações do gerente do projeto).

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...