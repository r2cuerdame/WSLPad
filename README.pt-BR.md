# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português (Brasil)**

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> Um pequeno companheiro do Windows para o WSL.

O WSLPad é um app residente na bandeja do Windows que torna visíveis as partes
invisíveis da sua instalação do WSL: quais distribuições estão em execução,
onde ficam suas ferramentas, o que está escutando em cada porta — além de um
gerenciador de arquivos de verdade, um console interativo e um **servidor MCP
somente leitura**, para que suas ferramentas de LLM possam inspecionar (nunca
modificar) o seu ambiente.

![Dashboard do WSLPad](docs/screenshots/dashboard.png)

## Por quê

Instale Hermes, Codex, Claude, Docker, Node ou Python dentro do WSL e, de
repente, nada mais é visível pelo Windows: caminhos de instalação, arquivos de
configuração, variáveis de ambiente, serviços, portas, estado do systemd ou
como os caminhos do Linux correspondem aos caminhos do Windows. O WSLPad
organiza tudo isso em um dashboard, um explorador de arquivos e uma superfície
MCP — sem nunca alterar o seu sistema pelas suas costas.

## As três superfícies

### Dashboard — estado somente leitura, seção por seção

Escolha uma seção à esquerda e leia à direita — são treze, da visão geral aos
avisos. As tabelas ocupam a janela inteira, em vez de um cartão apertado, e a
lista carrega indicadores ao vivo. O inventário completo está
[abaixo](#o-que-você-realmente-vê); três seções merecem destaque porque
respondem a perguntas que o próprio WSL deixa sem resposta:

**Imagem de disco** — o `ext4.vhdx` da sua distribuição cresce e nunca encolhe,
e o `df` dentro do Linux informa um máximo fictício. O WSLPad mostra onde a
imagem realmente está, quanto ela ocupa no seu disco do Windows, quanto a
distribuição de fato usa por dentro e quanto é recuperável.

![Imagem de disco](docs/screenshots/disk.png)

**Configurações do WSL** — o WSL aceita uma configuração e ignora metade dela em
silêncio. Cada chave do `.wslconfig` e do `wsl.conf` aparece com o valor
declarado, o valor de fato em vigor e um veredito: aplicado, requer reinício,
seção errada, chave desconhecida ou sem suporte nesta build. Inclusive o modo de
rede que você pediu contra o que você recebeu.

![Configurações do WSL](docs/screenshots/wslconfig.png)

**Portas** — um listener do WSL vem marcado como `WSL`, ou `WSL + Windows`
quando ele é realmente acessível pelo Windows (com o processo do Windows que o
segura, normalmente `wslrelay` na rede NAT). Listeners exclusivos do Windows
também são listados. Quando a tabela de portas do host não pode ser lida, o
WSLPad diz *desconhecido* em vez de afirmar "não acessível".

O Dashboard (o Painel) nunca executa nada. Botões como *kill*, *reiniciar
serviço* ou *sudoedit* apenas **preparam** o comando no campo do Console — você
revisa, edita e pressiona Enter.

![Explorer](docs/screenshots/explorer.png)

### Explorer — Windows à esquerda, WSL à direita

O Explorer (o Explorador) é um gerenciador de arquivos de painel duplo de
verdade: suas unidades do **Windows** à esquerda, a **distribuição WSL**
selecionada à direita, com um divisor arrastável entre elas. Copiar entre os
dois lados é o ponto central — arraste de um painel para o outro ou use *Copiar
para o outro painel* — e toda transferência mostra o progresso e pode ser
cancelada. Uma transferência nunca apaga a origem.

Cada painel tem seu próprio histórico, trilha de navegação, barra de caminho,
pesquisa, árvore de pastas opcional com carregamento sob demanda, lista
ordenável, novo arquivo/pasta, renomeação inline (F2), copiar/recortar/colar e
Delete → lixeira, com Shift+Delete para exclusão permanente. O painel do WSL
mostra ainda proprietário/grupo/permissões do Linux e o destino de links
simbólicos, e oferece as quatro variantes de cópia de caminho; operações
privilegiadas não são simuladas com sudo — em vez disso, o comando certo é
preparado no Console. Dê um duplo clique em qualquer arquivo de texto dos dois
lados para abrir o editor embutido (números de linha, localizar, Ctrl+S,
formatação de JSON).

### Console — um shell de verdade, sempre à mão

Uma sessão PTY interativa de verdade por distribuição (bash/zsh, cores, Ctrl+C,
autocompletar com Tab, vim/htop/ssh funcionando) ancorada na base de todas as
abas. O botão direito cola — ou copia a seleção, quando existe uma — do jeito
que todo outro terminal se comporta. Quando você navega pelo painel WSL no
Explorer, o Console acompanha e vai para o mesmo diretório — sem um `cd`
visível, sem poluir o histórico do seu shell. Só os comandos que **você**
executa aparecem na transcrição; as consultas internas do WSLPad são executadas
por um runner oculto separado.

## Servidor MCP (somente leitura)

Enquanto o WSLPad fica na bandeja, ele serve MCP em
`http://127.0.0.1:4923/mcp` (Streamable HTTP, apenas localhost, autenticação
por token Bearer) com 26 ferramentas `Get*` — `GetDashboardSnapshot`,
`GetInstalledTools`, `GetPorts`, `GetTextFile`, `GetPathMapping`, … Não existem,
de propósito, ferramentas de escrita/execução/kill; segredos e chaves privadas
nunca cruzam a fronteira do MCP. Registro em um clique para Claude Desktop
(ponte stdio), Codex e Hermes, além de `Copiar para LLM`, que coloca um resumo
do estado em Markdown, já mascarado, na sua área de transferência.
Detalhes: [docs/MCP.md](docs/MCP.md).

## O que você realmente vê

Cada item abaixo é lido da sua máquina e mostrado como está. Nada disso altera
coisa alguma; quando existe uma ação, ela é escrita no Console para você
executar.

**Visão geral** — nome da distribuição, estado, versão do WSL, marcador de
padrão, nome amigável do SO, kernel, nome do host, usuário, `$HOME`, shell de
login, tempo de atividade, se o systemd está ligado, o IP da distribuição e o
caminho `\\wsl.localhost\…` para o Windows.

**Recursos** — CPU % ao vivo, memória usada/total, swap, uso de disco em `/`,
`/home` e `/mnt/c`, carga média, número de processos. Além da **reconciliação
de memória**: a memória do Windows, o limite de memória do WSL (e se foi você
que o definiu ou se o WSL o calculou), o que o Windows retém no momento para a
VM e a divisão dentro do Linux entre em uso / cache / livre / swap — para que
"o vmmem está devorando 7 GB" vire "a maior parte disso é cache de páginas
recuperável".

**Imagem de disco** — onde o `ext4.vhdx` realmente fica no seu disco do Windows,
seu tamanho lógico, quanto está de fato alocado, se ele é esparso, o tamanho e o
uso do sistema de arquivos dentro da distribuição e quanto é recuperável.

**Configurações do WSL** — cada chave do `.wslconfig` e do `/etc/wsl.conf` com o
valor declarado, o valor de fato em vigor, de onde ele veio e um veredito:
aplicado, requer reinício, não definido, chave desconhecida (erro de digitação),
seção errada ou sem suporte nesta build. Inclui o modo de rede realmente em
execução contra o que você pediu, e um aviso quando a VM é anterior à sua última
edição.

**Caminhos importantes** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`,
`~/.config`, `~/.cache`, `~/.ssh`, `~/.hermes`, o perfil de usuário do Windows
visto do Linux — cada um com sua existência e as grafias tanto do Linux quanto
do Windows.

**Arquivos de configuração** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`,
`~/.bashrc`, `~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment`: onde
cada um está e se ele existe, é legível e é gravável.

**Ferramentas instaladas** — 86 ferramentas em 11 categorias (CLIs de IA,
runtimes, gerenciadores de pacotes, controle de versão, contêineres, nuvem,
build, bancos de dados, editores e shells, mídia, utilitários), cada uma com
estado de instalação, caminho resolvido, versão, método de instalação
(apt / snap / nvm / npm-global / pipx / uv / interop do Windows / …), caminhos
de configuração e número de processos em execução.

**Hermes** — executável, diretório de dados, virtualenv, configuração, estado do
gateway e do dashboard, número de servidores MCP, portas, serviços de usuário e
caminhos de log.

**Variáveis de ambiente** — cada variável com seu comprimento e seus marcadores
(tipo PATH, veio do Windows). Nomes que parecem segredos são mascarados;
revelar é um clique deliberado.

**Processos** — PID, usuário, CPU %, memória %, tempo decorrido, linha de
comando completa.

**Serviços** — cada unidade do systemd com escopo, estado de load/active/sub,
estado de habilitação e descrição — e, para cerca de 71 unidades bem
conhecidas, uma explicação em linguagem simples do que ela é e se normalmente
fica em execução.

**Portas** — protocolo, endereço, porta, PID, processo, estado de escuta e a
origem: `WSL`, `Windows` ou `WSL + Windows` quando é realmente acessível pelo
Windows (com o processo do Windows que a segura). Listeners exclusivos do
Windows estão incluídos.

**Avisos** — distribuição parada, systemd desligado, pouco espaço em disco,
unidades em estado failed, conflitos de porta, falhas de consultas em segundo
plano, problemas de MCP.

**Explorer** — por arquivo: nome, tamanho, data de modificação e, no lado do
WSL, proprietário, grupo, permissões do Linux e destinos de links simbólicos.
Por unidade, no lado do Windows: espaço livre e total.

**Console** — a distribuição, o diretório atual e o estado do shell (pronto, em
execução, aguardando entrada, aguardando a senha do sudo, desconectado).

**Pelo MCP** — tudo isso acima por meio de 26 ferramentas `Get*` somente leitura.
[docs/MCP.md](docs/MCP.md)

## Settings e idiomas

A engrenagem (canto superior direito, sempre disponível) abre a gaveta de
Settings (Configurações) — nunca uma terceira aba: idioma, tema
(sistema/claro/escuro), iniciar com o Windows, pausa do monitoramento +
intervalos de sondagem rápido/médio/lento, padrões do Explorer,
fonte/scrollback do Console, verificação de atualizações, restaurar tudo — e o
**painel MCP** completo: status, copiar endpoint, copiar JSON de configuração,
registro em um clique para Codex / Claude Desktop / Hermes, teste de conexão e
geração de um novo token.

O WSLPad traz traduções completas da interface para **9 idiomas** — 한국어,
English, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português do
Brasil — com detecção automática do idioma do Windows e fallback para o inglês.
Comandos do Linux, caminhos e nomes técnicos nunca são traduzidos; os pacotes de
idioma vão embutidos offline, com paridade de chaves garantida.

## Instalação

Baixe `WSLPad-Setup-<version>.exe` em
[Releases](https://github.com/r2cuerdame/WSLPad/releases) e execute — sem
precisar de direitos de administrador (instalação por usuário). Por padrão, o
WSLPad inicia com o Windows (alterne pela bandeja ou em Settings), fica na
bandeja e se atualiza sozinho pelo GitHub Releases. Fechar a janela apenas a
oculta; *Sair* no menu da bandeja encerra o app.

> A v0.1.0 não é assinada — o SmartScreen vai perguntar uma vez ("Mais informações" → "Executar assim mesmo").

Requisitos: Windows 10/11 x64. O WSL é opcional — sem ele, o WSLPad mostra uma
dica de configuração em vez de quebrar.

## Desenvolvimento

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` roda o app inteiro contra um mundo WSL determinístico em
memória — é o que o CI e os testes E2E usam. Veja
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e
[docs/RELEASING.md](docs/RELEASING.md).

## Privacidade e segurança

Local em primeiro lugar: sem nuvem, sem contas, sem telemetria. O MCP escuta
apenas em localhost, com autenticação por token, e é somente leitura por
construção. Nada é executado sem o seu Enter. Princípios completos:
[docs/SECURITY.md](docs/SECURITY.md).

## Fora de escopo

O WSLPad *não* é um gerenciador/loja de distribuições, não é o Docker Desktop,
não é uma IDE, não tem interface de Git/depurador/LSP, não tem sincronização na
nuvem, nem chat de IA, nem correção automática. Identidade:
**Dashboard + Explorer + Console + MCP somente leitura** — nada além disso.

## Limitações atuais (v0.1.2)

- Somente Windows x64; o instalador não é assinado (aviso do SmartScreen)
- Os números da imagem de disco dependem do registro do Windows e do `fsutil`;
  se algum dos dois não puder ser lido, a seção diz isso em vez de adivinhar
- O modo de rede em vigor depende do `wslinfo` (WSL 2.0.4+); builds mais
  antigas o mostram como desconhecido
- A sincronização de diretório do Console exige bash ou zsh como shell padrão
  (outros shells funcionam, só que sem sincronização automática de caminho)
- Copiar *entre* os painéis nunca move: transferências entre sistemas de
  arquivos são apenas de cópia por design, então nada é excluído se uma
  transferência falhar
- Arrastar de uma janela externa do Explorador de Arquivos do Windows depende de
  o Electron expor os caminhos dos arquivos; use o painel esquerdo (ou o menu
  Importar)
- Ainda não há interface para restaurar da lixeira (os arquivos vão para a
  lixeira padrão do Linux / Lixeira do Windows e podem ser restaurados de lá)
- A ponte stdio do MCP exige que o app da bandeja esteja em execução

## Roadmap

A seguir (0.1.3), a versão do diagnóstico: explicar *por que* uma porta está
inacessível (modo de rede em vigor, endereço de bind, o firewall do Hyper-V
ligado por padrão), indicar de que lado da fronteira lenta do `/mnt` um projeto
está, sinalizar ferramentas de desenvolvimento que silenciosamente resolvem para
binários do Windows, mostrar a diferença entre os relógios, adicionar sparklines
de tendência, incluir presets de cópia para relatório de bug e AGENTS.md, e
colocar o uso de disco por diretório no painel do Explorer. Mais adiante:
ferramentas MCP de nível de agente, uma interface para restaurar da lixeira, um
visualizador de logs de serviço, uma build ARM64, um instalador assinado.

## Licença

MIT
