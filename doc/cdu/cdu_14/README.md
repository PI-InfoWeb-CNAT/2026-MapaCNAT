# CDU0014. Efetuar auto-cadastro

- **Ator principal**: Usuário
- **Atores secundários**: Django/Banco de Dados
- **Resumo**: O Usuário realiza seu cadastro no sistema, informando seus dados para criar uma nova conta.
- **Pré-condição**: Usuário está na tela inicial do aplicativo ou na tela de login e não possui uma conta cadastrada.
- **Pós-Condição**: Uma nova conta de usuário é criada e os dados são armazenados no banco de dados.

## Fluxo Principal
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1 - Acessa a opção de cadastro | |  
| | 2 - Exibe o formulário de cadastro | 
| 3 - Informa seus dados pessoais | | 
| 4 - Informa o e-mail |
| 5 - Cria uma senha | |
| 6 - Confirma a senha | |
| 7 - Seleciona a opção "Cadastrar" |
| | 8 -  Valida os dados informados |
| | 9 -  Verifica se o e-mail já está cadastrado |
| | 10 - Cria a conta do usuário | |
| | 11 - Armazena os dados no banco de dados | |
| | 12 - Informa que o cadastro foi realizado com sucesso | |
| 13 - Acessa o sistema |

## Fluxo Alternativo I - E-mail já cadastrado
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 - Informa um e-mail já utilizado em outra conta | |  
| 1.2 - Preenche os demais campos do cadastro | 
| 2 - Seleciona a opção "Cadastrar" | 
| | 2.1 - Verifica o e-mail informado |
| | 2.2 - Identifica que o e-mail já está cadastrado | |
| | 2.3 - Informa que o e-mail já está sendo utilizado | |
| 3 - Informa outro e-mail | |
| | 4 - Valida novamente os dados | |
| | 5 - Prossegue com o cadastro |


## Fluxo Alternativo II - Senhas não coincidem
| Ações do ator | Ações do sistema |
| :-----------------: | :-----------------: | 
| 1.1 - Insere uma senha | |  
| 1.2 - Insere uma senha diferente no campo de confirmação | |  
| 2 - Seleciona a opção "Cadastrar" | 
| | 2.1 - Compara as senhas informadas |
| | 2.2 - Identifica que as senhas são diferentes |
| | 2.3 - Informa que as senhas não coincidem |
| 3 - Corrige a senha de confirmação | |
| | 4 - Valida novamente as senhas | |
| | 5 - Prossegue com o cadastro | |


## Fluxo de Exceção - Campos Obrigatórios Não Preenchidos
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Tenta realizar o login sem preencher um ou mais campos obrigatórios | |
| | 2 - Identifica os campos não preenchidos |
| | 3 - Informa quais campos precisam ser preenchidos |
| 4 - Preenche os campos solicitados | |
| | 5 - Valida os dados novamente |
| | 6 - Realiza a autenticação do usuário | 



## Fluxo de Exceção - Dados Inválidos
| Ações do ator | Ações do sistema |
| :-----------------: |:-----------------: |
| 1 - Insere dados em formato inválido | |
| 2 - Seleciona a opção "Cadastrar" |
| | 3 - Valida os dados informados |
| | 4 - Identifica os dados inválidos | |
| | 5 - Informa quais dados precisam ser corrigidos |
| 6 - Corrige as informações | 
| | 7 - Valida novamente os dados |
| | 8 - Prossegue com o cadastro |

> Obs. as seções a seguir apenas serão utilizadas na segunda unidade do PDSWeb (segundo orientações do gerente do projeto).

## Diagrama de Interação (Sequência ou Comunicação)

> Substituir pela imagem correspondente...

## Diagrama de Classes de Projeto

> Substituir pela imagem contendo as classes (modelo, visão e templates) que implementam o respectivo CDU...