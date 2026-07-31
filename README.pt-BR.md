# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português (Brasil)**

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
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

Escolha uma seção à esquerda e leia à direita — são dezesseis, da visão geral aos
avisos. As tabelas ocupam a janela inteira, em vez de um cartão apertado, e a
lista carrega indicadores ao vivo. O inventário completo está
[abaixo](#o-que-você-realmente-vê); quatro seções merecem destaque porque
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
rede que você pediu contra o que você recebeu. Os dois arquivos vivem em duas máquinas diferentes e são editados em lugares diferentes, então você lê um de cada vez — o seletor mostra quantas chaves cada arquivo declara e sinaliza o que precisa de atenção.

![Configurações do WSL](docs/screenshots/wslconfig.png)

**Rede** — o firewall do Hyper-V que a janela do Firewall do Windows nunca
mostra, que vem ligado por padrão e descarta em silêncio o tráfego de entrada
para o WSL, além de um bloco de resolução de nomes que coloca lado a lado o
`/etc/resolv.conf`, o `generateResolvConf`, o tunelamento de DNS e os servidores
do adaptador do Windows — para que "Temporary failure in name resolution" tenha
um único lugar para se olhar.

**Portas** — um listener do WSL vem marcado como `WSL`, ou `WSL + Windows`
quando ele é realmente acessível pelo Windows, e cada um agora traz um
**veredito de alcance**: alcança a rede, somente este computador, somente dentro
do WSL, ou nada — com o motivo, derivado do endereço de bind, do modo de rede em
vigor e do firewall. Quando os fatos não podem ser lidos, o WSLPad diz
*desconhecido* em vez de adivinhar. Uma máquina movimentada lista centenas de portas em escuta, então há um filtro por faixa de portas e por nome de processo — "quem está com a 5173" é uma pergunta, não um exercício de rolagem.

![Portas](docs/screenshots/ports.png)

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

Ele também se recupera sozinho. O WSL costuma continuar ocupado quando o WSLPad sobe junto com o Windows, e um shell que não pôde ser iniciado agora é relatado exatamente assim — **com o motivo** — em vez de um enganoso "distribuição parada". Assim que a distribuição aparece como em execução, o Console tenta de novo sem ser pedido, e se ainda assim não iniciar, o botão de reconectar continua ali. Reiniciar o aplicativo nunca é a resposta.

## Servidor MCP (somente leitura)

Enquanto o WSLPad fica na bandeja, ele serve MCP em
`http://127.0.0.1:4923/mcp` (Streamable HTTP, apenas localhost, autenticação
por token Bearer) com 31 ferramentas `Get*` — `GetDashboardSnapshot`,
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
login, tempo de atividade, se o systemd está ligado, o IP da distribuição, o
caminho `\\wsl.localhost\…` para o Windows e a diferença de relógio entre o
Windows e a distribuição — a causa invisível de falhas repentinas de apt e TLS
depois que o host entra em suspensão.

**Recursos** — CPU % ao vivo, memória usada/total, swap, uso de disco em `/`,
`/home` e `/mnt/c`, carga média, número de processos e sparklines de tendência,
para que um número responda "isso está subindo?". Além da **reconciliação
de memória**: a memória do Windows, o limite de memória do WSL (e se foi você
que o definiu ou se o WSL o calculou), o que o Windows retém no momento para a
VM e a divisão dentro do Linux entre em uso / cache / livre / swap — para que
"o vmmem está devorando 7 GB" vire "a maior parte disso é cache de páginas
recuperável".

**Imagem de disco** — onde o `ext4.vhdx` realmente fica no seu disco do Windows,
seu tamanho lógico, quanto está de fato alocado, se ele é esparso, o tamanho e o
uso do sistema de arquivos dentro da distribuição e quanto é recuperável.

**Configurações do WSL** — primeiro o build do WSL, o kernel, WSLg, MSRDC,
Direct3D, DXCore e a versão do Windows que o `wsl --version` informa, porque cada
veredicto de "não suportado neste build" é uma afirmação sobre esses números.
Depois, cada chave do `.wslconfig` e do `/etc/wsl.conf` com o
valor declarado, o valor de fato em vigor, quem o definiu (você, no seu arquivo,
o padrão do WSL ou um valor calculado pelo WSL a partir do seu hardware) e um
veredito: aplicado, requer reinício, não definido, chave desconhecida (erro de
digitação), seção errada ou sem suporte nesta build. Inclui o modo de rede
realmente em execução contra o que você pediu, e um aviso quando a VM é anterior
à sua última edição.

**Caminhos importantes** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`,
`~/.config`, `~/.cache`, `~/.ssh`, `~/.hermes`, o perfil de usuário do Windows
visto do Linux — cada um com sua existência, as grafias tanto do Linux quanto
do Windows e de que lado da fronteira do sistema de arquivos ele está (no ext4
nativo ou do outro lado da montagem lenta do Windows).

**Arquivos de configuração** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`,
`~/.bashrc`, `~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment`: onde
cada um está e se ele existe, é legível e é gravável.

**Ferramentas instaladas** — 86 ferramentas em 11 categorias (CLIs de IA,
runtimes, gerenciadores de pacotes, controle de versão, contêineres, nuvem,
build, bancos de dados, editores e shells, mídia, utilitários), cada uma com
estado de instalação, caminho resolvido, versão, método de instalação, caminhos
de configuração, número de processos em execução, de que lado da fronteira do
sistema de arquivos ela fica e — o mais importante — se o comando na verdade
acaba em um binário do **Windows** sob `/mnt/c` em vez de um instalado na
distribuição.

**Docker** — uma seção própria: versões do engine e do cliente, contexto, raiz
de dados, imagens e contêineres, e o detalhamento do `docker system df` —
inclusive o **cache de build**, que nenhuma listagem mostra e que costuma ser a
maior coisa da máquina. Com o Docker Desktop ele ainda nomeia a distribuição
cujo disco virtual realmente guarda esse espaço, porque não é a que você está
olhando. Somente leitura: nada é baixado, iniciado, parado ou limpo — os
comandos de prune ficam preparados no Console.

![Docker](docs/screenshots/docker.png)

**Hermes** — executável, diretório de dados, virtualenv, configuração, estado do gateway, **a quais mensageiros ele está de fato conectado**, os perfis que você chamaria de agentes (com o atual marcado), sessões ativas, tarefas agendadas, estado e endereço do painel, número de servidores MCP, portas, serviços de usuário e caminhos de log. Mensageiros e perfis vêm da CLI somente leitura do próprio Hermes; quando não dá para perguntar, a linha diz *desconhecido* em vez de "nenhum configurado". O painel web não está rodando? O comando para iniciá-lo fica preparado no Console.

**OpenClaw** — uma seção própria ao lado do Hermes: executável, diretório de
dados, versão, método de instalação, de que lado da fronteira do sistema de
arquivos ele vive e se está rodando. Detectado na mesma passagem de catálogo que
qualquer outra ferramenta — o WSLPad nunca inicia o OpenClaw para perguntar.

![Hermes](docs/screenshots/hermes.png)

**Variáveis de ambiente** — cada variável com seu comprimento e seus marcadores
(tipo PATH, veio do Windows). Nomes que parecem segredos são mascarados;
revelar é um clique deliberado.

**Processos** — PID, usuário, CPU %, memória %, tempo decorrido, linha de
comando completa.

**Serviços** — cada unidade do systemd com escopo, estado de load/active/sub,
estado de habilitação e descrição — e, para cerca de 71 unidades bem
conhecidas, uma explicação em linguagem simples do que ela é e se normalmente
fica em execução.

**Portas** — protocolo, endereço, porta, PID, processo, estado de escuta, a
origem (`WSL`, `Windows`, `WSL + Windows`) e um veredito de alcance com o seu
motivo: alcança a rede, somente este computador, somente dentro do WSL, nada ou
desconhecido. Filtre por faixa de portas e por nome de processo — a busca por nome olha tanto o processo do WSL quanto o do Windows que segura a mesma porta.

**Rede** — o estado do firewall do Hyper-V para a máquina virtual do WSL
(ligado, ação padrão de entrada e de saída, exceção de loopback, número de
regras) e a resolução de nomes: se o `/etc/resolv.conf` é o link simbólico
gerado pelo WSL ou foi editado à mão, o `generateResolvConf` em vigor, o
tunelamento de DNS, os servidores de nomes em uso e o que o adaptador do Windows
entrega. E as regras de **encaminhamento de portas** do Windows: sob NAT a distribuição recebe um endereço novo a cada reinício do WSL, então uma regra `netsh portproxy` adicionada uma vez passa a encaminhar para lugar nenhum, em silêncio. O WSLPad coloca cada regra ao lado do endereço atual e diz quais estão mortas.

**Avisos** — distribuição parada, systemd desligado, pouco espaço em disco,
unidades em estado failed, conflitos de porta, falhas de consultas em segundo
plano, problemas de MCP.

**Explorer** — por arquivo: nome, tamanho, data de modificação e, no lado do
WSL, proprietário, grupo, permissões do Linux e destinos de links simbólicos.
Por unidade, no lado do Windows: espaço livre e total.

**Console** — a distribuição, o diretório atual e o estado do shell (pronto, em execução, aguardando entrada, aguardando a senha do sudo, desconectado, distribuição parada ou não foi possível iniciar — este último com o motivo).

**Pelo MCP** — tudo isso acima por meio de 31 ferramentas `Get*` somente leitura.
[docs/MCP.md](docs/MCP.md)

## Settings e idiomas

A engrenagem (canto superior direito, sempre disponível) abre a gaveta de
Settings (Configurações) — nunca uma terceira aba: idioma, tema
(sistema/claro/escuro), iniciar com o Windows, pausa do monitoramento +
intervalos de sondagem rápido/médio/lento, padrões do Explorer,
fonte/scrollback do Console, verificação de atualizações — com o estado sempre à vista: verificando, disponível, progresso do download, pronta para instalar (com botão de reiniciar) ou por que falhou —, restaurar tudo — e o
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
oculta; *Sair* no menu da bandeja encerra o app. O submenu **Sobre** da bandeja
leva a versão em execução, o repositório no GitHub, as notas da versão e a
página de apoio. Verificar atualizações pela bandeja é respondido na bandeja: o
item do menu vira o estado (verificando, disponível, progresso do download,
pronta para instalar) e o resultado chega como notificação; a janela nunca é
jogada na sua frente.

> O instalador não é assinado — o SmartScreen vai perguntar uma vez ("Mais informações" → "Executar assim mesmo").

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

## Limitações atuais (v0.1.10)

- Somente Windows x64; o instalador não é assinado (aviso do SmartScreen)
- Os números da imagem de disco dependem do registro do Windows e do `fsutil`;
  se algum dos dois não puder ser lido, a seção diz isso em vez de adivinhar
- O modo de rede em vigor depende do `wslinfo` (WSL 2.0.4+); builds mais
  antigas o mostram como desconhecido
- A camada de firewall do Hyper-V só existe em builds recentes do Windows; onde
  ela não existe, o WSLPad informa desconhecido em vez de "desativado"
- As sparklines de tendência ficam apenas na memória — o histórico é reiniciado
  quando você fecha o app, e isso é intencional: um companheiro de bandeja não é
  um agente de monitoramento
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

A seguir: ferramentas MCP de nível de agente, moldadas em torno das perguntas
que um agente de fato faz (mapeamento de caminhos, quem é o dono de uma porta,
qual binário é resolvido), uma interface para restaurar da lixeira, um
visualizador somente leitura de logs de serviço, uma build ARM64 e um instalador
assinado.

## Comunidade

Perguntas, ideias e "isso deveria aparecer assim?" vão para as
[Discussions](https://github.com/r2cuerdame/WSLPad/discussions) — em qualquer um dos nove idiomas que o WSLPad fala.
Bugs vão para o [rastreador de issues](https://github.com/r2cuerdame/WSLPad/issues/new/choose); questões de segurança, para
um [aviso privado](https://github.com/r2cuerdame/WSLPad/security/advisories/new).

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a) — como se faz, e por que aparece assim
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas) — o que o WSLPad deve mostrar em seguida; a lista para a 0.2
  já está lá, tirada daquilo de que os usuários de WSL mais reclamam lá em cima
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell) — o que ele encontrou na sua máquina

[CONTRIBUTING](.github/CONTRIBUTING.md) lista as quatro regras que um pull request não pode
quebrar.

## Licença

MIT
