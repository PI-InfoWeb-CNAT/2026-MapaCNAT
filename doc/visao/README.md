# Documento de Visão

## Histórico de Revisões

| Data | Versão | Descrição | Autores |
| :--: | :----: | :-------: | :-----: |
| 09/04 | 1.0 | Versão inicial | Gabriel Isaias - Gabriel Albino, Jenyffer, Allaphy |


## 1. Visão Geral do Sistema Proposto

O sistema é uma ferramenta para auxiliar usuários a navegar pelo mapa do IFRN de maneira prática e mais especializada para as necessidades geográficas quee se desenvolverem.

## 2. Descrição do Problema
| - | - |
| :-: | :-: |
| **Problema** | Não há um aplicativo especializado que ajude o usuário a navegar pelo instituto de forma prática |
| **Afeta** | Ingressantes novatos, visitantes e estudantes experientes |  
| **Impacta** | Problemas de navegação |
| **Solução** | Ferramenta prática e livre para facilitar a navegação através do auxílio visual | 

## 3. Descrição dos Usuários 

| Usuário | Descrição | Responsabilidades |
| :-----: | :-------: | :--------------: |
| Usuário | Um usuário sem acesso especial que é o foco do sistema | Nenhuma |
| Administrador | Um administrador com acessos especiais e capaz de gerenciar dados dentro do sistema | Inserir dados no sistema de locais específicos |

## 4. Descrição do Ambiente dos Usuários

| Usuário | Ambiente operacional |
| :-----: | :------------------: |
| Usuário | Tem acesso a tela do mapa contendo vários pinos de localização, podendo clicar no botão superior direito para escolher entre desabilitar ou habilitar a visibilidade. Possui uma lupa no canto superior esquerdo para pesquisar local e uma lista de filtros ao lado da lupa |
| Administrador | Tem acesso a tela do mapa e de inserir local no mapa, contendo um formulário para inserção de nome, foto, como chegar e  descrição do local |

## 5. Principais Necessidades dos Usuários

> Apresentadas no formato de tópicos
1. **Usuário (aluno)**
   - Localizar facilmente prédios, salas e setores dentro do campus.
   - Visualizar rotas para chegar ao destino desejado
   - Pesquisar locais específicos por nome ou categoria.
   - Filtrar pontos no mapa (ex: salas, coordenações, banheiros, etc.).
   - Ter uma interface simples, intuitiva e acessível.
   - Acessar informações adicionais sobre os locais (descrição, foto, como chegar).

1. **Administrador**
   - Cadastrar novos locais no sistema com informações completas.
   - Editar ou remover locais já existentes no mapa.
   - Garantir que as informações cadastradas estejam corretas e atualizadas.
   - Gerenciar imagens e descrições dos pontos cadastrados.
   - Controlar a visibilidade dos locais no mapa.

## 6. Alternativas Concorrentes

1. **Google Maps**
   - mapa geral (cidade, ruas).
   - completo, fácil de usar, famoso.
   - não tem detalhes do campus (salas, etc.)
1. **OpenStreetMap**
   - Mapa colaborativo.
   - Gratuito, pode ser bem detalhado.
   - Difícil de usar, nem sempre atualizado.

## 7. Regras de Negócio

| ID  | Regra | Descrição |
| :-: | :---: | :-------: |
| RN01 | Privacidade de Dados | O app não deverá armazenar o histórico de localização do usuário |
| RN02 | Horário de Funcionamento | O app deve informar se o instituto não possui rotas disponíveis para dada hora de uso |
| RN03 | Acessibilidade | Para usuários com necessidades especiais, trajetórias devem priorizar rampas e elevadores |

## 8. Requisitos Funcionais

| Código | Nome | Descrição | Prioridade |
| :---: | :---: | :--- | :---: |
| RF01 | Pesquisa de Local | O usuário deve poder digitar o nome ou número de uma sala e vê-la destacada no mapa. | Alta |
| RF02 | Filtro por Categorias | O site deve permitir filtrar por "Setor Administrativo", "Salas de Aula", "Esportes", etc. | Média |
| RF01 | Pesquisa de Local | O usuário deve poder digitar o nome ou número de uma sala e vê-la destacada no mapa. | Alta |
| RF02 | Filtro por Categorias | O site deve permitir filtrar por "Setor Administrativo", "Salas de Aula", "Esportes", etc. | Média |
| RF03 | Galeria de Fotos | Ao clicar num ponto, o site deve exibir uma foto e breve descrição do local. | Alta |
| RF04 | Gestão de Pontos | O usuario deve poder Marcar rotas para determinados locais. | Média |


> **Prioridade**: alta, média ou baixa

## 9. Requisitos Não-funcionais

| Código | Nome | Descrição | Categoria | Classificação |
| :----: | :--: | :-------: | :-------: | :-----------: |
| NF01 | Geração de rota | O aplicativo não deve levar mais que cinco segundos para gerar uma rota | performance | obrigatório |
| NF02 | Obtenção de dados | O aplicativo não deve levar mais que três segundos para obter dados do local | performance | obrigatório |
| NF03 | Usabilidade | O aplicativo deve ser intuitivo para qualquer usuário | usabilidade | desejável |
| NF04 | confiabilidade | O aplicativo deve informar diretamente ao usuário quais dados ele irá exigir (localização atual) | obrigatório |
| NF05 | suportabilidade | O aplicativo deverá ter suporte para Android e IOS | desejável |

> **Categoria**: usabilidade, confiabilidade, performance, suportabilidade, restrição de projeto, implementação, interface e requisito físico - segundo classificação [FURP+](https://pt.wikipedia.org/wiki/FURPS).

> **Classificação**: desejável ou obrigatório.
