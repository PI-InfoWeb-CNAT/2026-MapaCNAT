# Implantação

## 1. Visão Geral

A ferramenta de deployment utilizada foi o **Vercel**, sob o domínio https://mapa-cnat.vercel.app.

O sistema se conecta ao GitHub através de um fork que é constantemente atualizado.

## 2. Impedimentos

Por mais desenvolvido que seja, o sistema ainda possuia frentes simples para o banco de dados e configurações de Build e gerenciamento de dados.
1. Banco de dados
   - Para que dados do sistema possam ser registrados, é altamente recomendado que seja usado um banco de dados externo, para a persistência de dados através de diferentes deployments.
   - A escolha de ferramenta foi o Neon, e para isso foi criado uma conta e feito a conexão do banco com o sistema do vercel através da definição de variáveis de ambiente.
2. Configurações de Build
   - O mapa CNAT possui uma pipeline de inicialização relativamente simples. Primeiro é necessário ter Python, instalar os requisitos, realizar as migrações e então iniciar o serviço. Para que o Vercel seja capaz de realizar esse procedimento é criado um arquivo build_files.sh, para organizar as etapas. O arquivo então é específicado em vercel.json, que resolve a localização de arquivos essenciais, como o WSGI do Django, e os arquivos estáticos do sistema.
   - O vercel é operado utilizando Python 3.9.x, e por si só isso não apresenta um erro. Porém devido ao versionamento das ferramentas, a versão 3.9.x se encontra desatualizada em relação ao Django. Para resolver, é necessário incluir uma atualização da versão do Python dentro do arquivo build_files.sh.
   - Por fim, o Vercel por padrão ignora os arquivos static do Django, e como forma de resolver esse problema, o middleware Whitenoise é responsável por recriar os conteúdos estáticos no domínio staticfiles, possibilitando sua utilização com o serviço de deployment.
3. Gerenciamento de Dados e tipos
   - Devido a simplicidade da versão anterior a respeito do gerenciamento de dados, informações grandes como imagens de banneres acabavam sendo guardadas em caminhos dentro dos arquivos do projeto através da pasta media/. Esse procedimento introduziu problema relacionados ao Vercel, então portanto passou-se a salvar arquivos de imagens em BLOB + mime_type dentro do banco de dados externos. Para recuperá-los, foi criado uma endpoint responsável por se comunicar com o SGBD e retornar o BLOB da imagem, que pode então ser processado pelo front-end.
   - Por fim, os arquivos de CSS retornados pelo atributo GET ao acessar a página estavam omitindo o mime type, causando confusão no sistema e portanto eram ignorados. Para resolver isso foi adicionado o atributo ```type="text/css"``` para as tags de stylesheet.

## 3. Objetivos futuros
   1. Configuração de um domínio de desenvolvimento para deploy que esteja online, mas que não seja exposto para o usuário qualquer.
   2. Estado de manutenção para quem tentar acessar o site durante configurações de deployment.