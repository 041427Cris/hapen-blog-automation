# Automação de Blog — Hapen Imóveis

Cola o link de um imóvel/empreendimento do site da Hapen → gera 3 artigos
(bairro, empreendimento, investimento) otimizados para SEO e GEO via IA →
publica como **rascunho** no blog (nunca publica direto).

## Por que não usa a API do WordPress

O site é hospedado pela **Rocket Imob**, uma plataforma multi-cliente que
expõe o wp-admin mas esconde recursos nativos como Application Passwords.
Por isso a publicação funciona por **automação de navegador** (Playwright):
um robô faz login como você e preenche a tela de "Adicionar novo post",
igual um humano clicando.

**Isso é mais frágil que uma API.** Se a Rocket Imob mudar o layout do
painel, os seletores em `netlify/functions/publish-wordpress-background.js`
podem quebrar. Veja a seção "Ajustando os seletores" abaixo.

## Passo a passo de deploy

1. Crie um repositório no GitHub com estes arquivos e conecte no Netlify
   (ou rode `netlify deploy` pela CLI a partir desta pasta).
2. Em **Site settings → Environment variables**, adicione:
   - `ANTHROPIC_API_KEY` — sua chave da API da Anthropic
   - `WP_ADMIN_URL` — `https://hapenimoveis.com.br/wp-admin`
   - `WP_USERNAME` — `fdtaborda`
   - `WP_PASSWORD` — a senha do WordPress (nunca coloque isso em nenhum
     arquivo do projeto, só aqui no painel do Netlify)
3. Ative **Netlify Blobs** (já vem habilitado por padrão em sites novos —
   é usado só para acompanhar o status da publicação em segundo plano).
4. Dê deploy. Abra a URL gerada, cole o link de um imóvel e teste.

## Ajustando os seletores (se algo não funcionar)

O arquivo `publish-wordpress-background.js` tem um objeto `SELECTORS` no
topo com os elementos da tela que o robô precisa clicar/preencher (campo de
título, aba "Texto" do editor, botão de mídia, campos do Yoast, etc.). Eles
foram montados a partir das prints do painel, mas o jeito mais confiável de
confirmar é gravar você mesmo clicando:

```bash
npm install -g playwright
npx playwright codegen https://hapenimoveis.com.br/wp-login.php
```

Isso abre um navegador. Faça login, clique em "Adicionar novo post", crie um
post de teste preenchendo os mesmos campos (título, texto, imagem, SEO). O
Codegen mostra ao vivo o código Playwright correspondente — copie os
seletores que ele gerar para dentro de `SELECTORS`.

## Fluxo dos arquivos

- `extract-imovel.js` — busca a página do imóvel e extrai título, preço,
  bairro, descrição, diferenciais e fotos da galeria.
- `start-generate.js` — dispara a geração dos artigos em segundo plano e
  devolve um `jobId`.
- `generate-articles-background.js` — chama a API da Claude 3 vezes (um
  ângulo por vez: bairro / empreendimento / investimento) e devolve título,
  corpo em HTML e os campos de SEO de cada artigo. Roda em segundo plano
  porque gerar os 3 textos costuma passar dos 10s de limite das funções
  normais do Netlify.
- `start-publish.js` — dispara a publicação em segundo plano e devolve um
  `jobId`.
- `publish-wordpress-background.js` — abre o navegador headless, loga no
  wp-admin, cria os 3 posts como rascunho.
- `check-status.js` — o front-end consulta esta função a cada poucos
  segundos até a geração ou a publicação terminar (é a mesma função para
  as duas etapas, cada job tem seu próprio `jobId`).

## Limitações conhecidas

- O upload da imagem destacada depende do modal de mídia do WordPress abrir
  do jeito esperado — é o ponto mais provável de precisar ajuste fino.
- Se o Yoast estiver na versão mais nova (a que tem botões "Use AI" e
  "Insert variable" nas prints que você mandou), os campos de SEO são
  renderizados em React — os seletores por `placeholder`/`aria-label` usados
  aqui tendem a funcionar, mas confirme com o Codegen.
- Os seletores de `extract-imovel.js` também são um ponto de partida —
  ajuste conforme a estrutura real do HTML das páginas de imóvel da Hapen.
