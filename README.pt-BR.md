# WSLPad — GUI, painel, gerenciador de arquivos e ferramenta de diagnóstico do WSL para Windows

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português (Brasil)**

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **Veja o que o WSL realmente está fazendo — e por que está falhando.**

O WSLPad é uma **GUI do WSL, painel do WSL e ferramenta de diagnóstico do WSL para Windows 10/11**, de código aberto. Diferente de um gerenciador de WSL básico, ele se concentra em inspecionar e explicar o ambiente que você já usa. Ele torna visíveis as partes invisíveis do Windows Subsystem for Linux: distribuições em execução, CPU e memória, uso de disco do `ext4.vhdx`, `.wslconfig` e `wsl.conf`, portas, rede, estado do firewall do Hyper-V, DNS, serviços systemd, ferramentas de desenvolvimento instaladas, Docker, caminhos de arquivos e muito mais.

Ele também inclui um **gerenciador de arquivos Windows ↔ WSL em dois painéis**, um terminal interativo de verdade, diagnósticos de ambiente, ferramentas de recuperação, visibilidade de USB/usbipd, um fluxo seguro de realocação de VHDX e um **servidor MCP do WSL somente leitura para Claude, Codex e outras ferramentas de LLM**.

![Dashboard do WSLPad](docs/screenshots/dashboard.png)

## Diagnóstico do WSL: o que o WSLPad ajuda você a resolver

O WSLPad foi construído em torno das perguntas que os usuários do WSL acabam depurando à mão repetidamente:

- **Por que o WSL está lento?** — Veja quando um projeto ou terminal está rodando em `/mnt/c` em vez do sistema de arquivos nativo do Linux, inspecione a pressão de memória e identifique os consumidores de disco.
- **Por que o Windows ou minha rede local não alcançam uma porta do WSL?** — Veja juntos o listener, o endereço de bind, o modo de rede em vigor, a exposição no Windows, o estado do firewall do Hyper-V e um veredito de alcance.
- **Por que o `.wslconfig` ou o `wsl.conf` não surtiu efeito?** — Compare os valores declarados com o que está realmente ativo e veja se é necessário reiniciar, se a chave não é suportada, se a seção está errada ou se a configuração simplesmente não está em vigor.
- **Onde está o `ext4.vhdx`, e por que ele é tão grande?** — Veja o caminho da imagem, o tamanho alocado, o uso do sistema de arquivos Linux e o espaço recuperável.
- **Para onde foi o meu espaço em disco do WSL?** — Inspecione caches de pacotes, journals, caches de build, lixeira e armazenamento do Docker em vez de adivinhar só pelo `df`.
- **Qual processo está com a porta 3000 / 5173 / 8080?** — Filtre os listeners do WSL e do Windows por porta ou processo e veja se a porta é alcançável.
- **Uma ferramenta está instalada no WSL ou está resolvendo por acidente para o Windows?** — Inspecione mais de 100 ferramentas de desenvolvimento, seus caminhos, versões, métodos de instalação e lado do sistema de arquivos.
- **Como copio arquivos entre o Windows e o WSL de forma limpa?** — Use um gerenciador de arquivos Windows/WSL em dois painéis de verdade, com permissões, links simbólicos, histórico, busca e transferências canceláveis.
- **Por que o WSL parou de responder depois de suspensão, VPN ou mudança de rede?** — Use diagnósticos e orientações de recuperação que deixam as ações destrutivas por último.
- **O Claude ou o Codex podem inspecionar meu ambiente WSL com segurança?** — Exponha ferramentas MCP somente leitura sem dar ao modelo capacidades de executar, escrever, matar processos ou excluir.

## Por que o WSLPad em vez de outro gerenciador de WSL?

Muitas ferramentas GUI para WSL se concentram em operações de ciclo de vida das distribuições: instalar, iniciar, parar, exportar ou desregistrar uma distro. O WSLPad é deliberadamente diferente.

Sua principal função é **inspecionar, explicar e diagnosticar o ambiente que você já usa**.

Isso significa reunir em um só lugar os fatos que o WSL normalmente deixa espalhados pelo Windows, pelo Linux, por arquivos de configuração, pelo registro, por camadas de rede e por ferramentas de linha de comando — e dizer **por que** algo está lento, inalcançável, desatualizado, mal configurado ou inconsistente, em vez de apenas mostrar o estado bruto.

O WSLPad não “conserta” seu sistema em silêncio. As ações que alteram o sistema são preparadas para revisão no Console ou copiadas como comandos; você decide se vai executá-las.

## Recursos principais

### Painel do WSL e inspeção do ambiente

O Dashboard expõe o estado do WSL sem exigir que você lembre de uma cadeia de comandos do PowerShell, do Linux e de rede.

Ele cobre:

- estado da distro, versões do WSL/kernel, nome do host, usuário, shell e tempo de atividade
- CPU, memória, swap, número de processos e uso de disco
- localização, alocação, estado esparso e espaço recuperável do `ext4.vhdx`
- valores declarados vs. em vigor do `.wslconfig` e do `/etc/wsl.conf`
- caminhos importantes do Linux e do Windows
- variáveis de ambiente com valores que parecem segredos mascarados
- serviços systemd e logs de serviço
- processos do WSL e do Windows
- portas em escuta e alcance
- modo de rede, DNS e estado do firewall do Hyper-V
- regras de encaminhamento de portas do Windows e destinos obsoletos
- engine/cliente do Docker, imagens, contêineres, cache de build e raiz de dados
- CLIs de IA, runtimes, gerenciadores de pacotes, compiladores, ferramentas de nuvem e utilitários instalados
- marcadores de download do Windows (`Zone.Identifier`)
- estado do perfil do Windows Terminal
- avisos para problemas comuns do WSL

### Diagnóstico de rede, localhost e encaminhamento de portas do WSL

Uma porta “aberta” dentro do Linux não significa que o Windows ou outra máquina consiga alcançá-la.

O WSLPad correlaciona:

- endereço e porta do listener do WSL
- processo proprietário
- exposição no lado do Windows
- rede NAT vs. espelhada (mirrored)
- estado do firewall do Hyper-V
- regras de encaminhamento de portas
- configuração de DNS

Cada listener recebe um veredito de alcance como **alcançável pela LAN**, **somente este PC**, **somente WSL**, **inalcançável** ou **desconhecido**, com o motivo exibido em vez de adivinhado.

![Portas](docs/screenshots/ports.png)

### Alterações no `.wslconfig` e no `wsl.conf` que não são aplicadas

A configuração do WSL fica dividida entre o Windows e o Linux, e muitas alterações só entram em vigor depois de reiniciar a VM do WSL.

O WSLPad mostra o valor configurado ao lado do valor em vigor e classifica o resultado como aplicado, requer reinício, não definido, sem suporte, chave desconhecida ou seção errada. Ele também mostra o modo de rede que você solicitou em comparação com o modo realmente em execução.

![Configurações do WSL](docs/screenshots/wslconfig.png)

### Espaço em disco do WSL, `ext4.vhdx` e análise de armazenamento VHDX

O `df` dentro do Linux não diz quanto espaço o disco virtual do WSL está consumindo no Windows.

O WSLPad mostra:

- a localização real do `ext4.vhdx`
- o tamanho lógico e alocado da imagem
- se a imagem é esparsa
- o uso do sistema de arquivos dentro da distro
- o espaço recuperável
- os principais consumidores de disco, como caches de pacotes, journals, caches de build, lixeira e Docker

![Imagem de disco](docs/screenshots/disk.png)

### Gerenciador de arquivos Windows ↔ WSL

![Explorer](docs/screenshots/explorer.png)

O Explorer é um gerenciador de arquivos de dois painéis de verdade: **unidades do Windows à esquerda, a distro WSL selecionada à direita**.

Os dois painéis têm histórico de navegação, trilhas de navegação (breadcrumbs), barras de caminho, busca, ordenação, criação de arquivos/pastas, renomeação, copiar/recortar/colar e lixeira. O painel do WSL também mostra proprietário/grupo, permissões e destinos de links simbólicos do Linux.

As transferências entre sistemas de arquivos são apenas de cópia por design, mostram progresso e podem ser canceladas. Arquivos de texto podem ser abertos no editor embutido, com números de linha, busca, salvamento e formatação de JSON.

### Terminal WSL interativo para Windows

O WSLPad inclui um shell de verdade com suporte a PTY por distro, com bash/zsh, cores, Ctrl+C, autocompletar com Tab, vim, htop e suporte a SSH.

Quando você navega pelo painel de arquivos do WSL, o Console acompanha o mesmo diretório sem adicionar comandos `cd` visíveis ao histórico do seu shell. As consultas internas do WSLPad usam um runner oculto separado, então a transcrição do seu terminal contém apenas os comandos que você realmente executou.

### Environment Doctor e perfis de desenvolvedor

O Environment Doctor verifica problemas comuns de integridade do espaço de trabalho WSL e apresenta os resultados sem alterar a máquina automaticamente.

Os perfis de desenvolvedor agrupam fluxos de trabalho comuns de **Web, Python, Rust, IA e contêineres/Kubernetes** em torno das ferramentas de que normalmente precisam, usando o modelo de descoberta já existente do WSLPad para mostrar o que está instalado e o que está faltando.

### Recuperação, backup, clonagem e realocação

O espaço de trabalho de Recuperação cobre backup, restauração, clonagem, realocação e histórico de verificação com barreiras de segurança explícitas.

O fluxo de realocação ajuda a mover uma distro WSL para fora de uma unidade C: cheia, verificando a folga de espaço no destino, a integridade do backup e o usuário padrão do Linux. O WSLPad nunca desregistra, exclui ou sobrescreve uma distro existente em silêncio.

### Visibilidade de USB / usbipd

O WSLPad pode inspecionar o estado dos dispositivos USB/usbipd e preparar comandos de bind, attach e detach para revisão. Os dispositivos nunca são retirados automaticamente do Windows.

### Diagnósticos e recuperação remota

![Diagnósticos](docs/screenshots/diagnostics.png)

Uma linha do tempo de diagnóstico, válida apenas durante a sessão, conecta eventos de suspensão/retomada, responsividade da distro, mudanças de DNS, mudanças de modo de rede e recuperação do Console.

Para falhas do VS Code Remote / WSL, o WSLPad identifica apenas processos comprovados do VS Code Server e mantém a escada de recuperação do menos destrutivo para o mais destrutivo: recarregar o editor, reiniciar os processos de servidor medidos, encerrar uma distro e, só então, usar `wsl --shutdown` como último recurso.

### Docker no WSL e visibilidade de ferramentas de desenvolvimento

O WSLPad detecta as ferramentas de desenvolvimento dentro da distro selecionada e mostra para onde cada comando realmente resolve.

O Docker tem sua própria superfície de inspeção para versões do engine/cliente, contexto, raiz de dados, imagens, contêineres e `docker system df` — incluindo o cache de build. Contextos remotos do Docker não são contatados automaticamente.

![Docker](docs/screenshots/docker.png)

O WSLPad também tem visibilidade dedicada para ferramentas como Hermes e OpenClaw quando elas estão presentes.

## Servidor MCP do WSL somente leitura para Claude e Codex

Enquanto o WSLPad está em execução, ele serve MCP localmente em:

```text
http://127.0.0.1:4923/mcp
```

O servidor usa Streamable HTTP, binding apenas em localhost e autenticação por token Bearer. Ele expõe **42 ferramentas `Get*` somente leitura**, incluindo snapshots do ambiente, portas, ferramentas instaladas, resolução de comandos e inspeção de arquivos de texto.

Deliberadamente **não existem ferramentas MCP de escrita, execução, kill ou exclusão**. Chaves privadas e valores secretos não são expostos através da fronteira do MCP.

O registro em um clique está disponível para Claude Desktop, Codex e Hermes. `Copy for LLM` cria um resumo em Markdown, já mascarado, do ambiente WSL atual.

`GetDeveloperEnvironmentContext` é o ponto de partida de um agente: um único documento versionado e limitado — distro, diretório de trabalho e a fronteira Windows ↔ WSL, runtimes e ferramentas, PATH e interop, DNS, Docker, serviços, portas, espaço livre em disco, configurações, os veredictos do Environment Doctor e o que ainda é desconhecido. É byte a byte o mesmo bloco que `Copy for LLM → Agent context` coloca na área de transferência para um CLAUDE.md / AGENTS.md; `GetEnvironmentDoctor` retorna apenas as verificações de saúde.

Veja [docs/MCP.md](docs/MCP.md) para a lista de ferramentas e os detalhes do protocolo.

## Modelo de segurança

O WSLPad é intencionalmente conservador em relação a alterações no sistema.

- A inspeção do Dashboard é somente leitura.
- O MCP é somente leitura por construção.
- Operações perigosas não são executadas em silêncio.
- Ações como reinícios de serviço, edições privilegiadas, limpeza, alterações de USB ou etapas de recuperação são preparadas no Console ou copiadas para revisão.
- Um estado desconhecido é exibido como **desconhecido** em vez de adivinhado.

O objetivo é tornar o WSL mais fácil de entender sem se transformar em mais uma ferramenta de segundo plano que altera sua máquina pelas suas costas.

## Instalar o WSLPad no Windows

### Download direto

Baixe o `WSLPad-Setup-<version>.exe` mais recente em [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) e execute-o.

- Windows 10/11 x64
- instalação por usuário em `%LOCALAPPDATA%\Programs\WSLPad\`
- não exige direitos de administrador para a instalação normal
- app de bandeja com inicialização opcional junto com o Windows
- verificações automáticas de atualização pelo GitHub Releases

> **Windows SmartScreen:** os instaladores atuais não são assinados, então o Windows pode exibir um aviso de “Editor desconhecido” na primeira execução. Use **Mais informações → Executar assim mesmo** somente se você baixou o instalador da página oficial de Releases deste repositório.

O WSL em si é opcional na inicialização; se nenhuma distro estiver disponível, o WSLPad mostra orientações de configuração em vez de travar.

### WinGet

A submissão do pacote WinGet é acompanhada em [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317). Até que a entrada no repositório comunitário alcance as versões atuais, o GitHub Releases é a forma recomendada de instalar a versão mais recente.

Assim que o pacote estiver disponível no repositório comunitário:

```powershell
winget install r2cuerdame.WSLPad
```

### Opções de linha de comando

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## Idiomas

O WSLPad traz traduções completas da interface para **9 idiomas**:

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

A detecção do idioma do Windows é automática, com fallback para o inglês. Comandos do Linux, caminhos e nomes técnicos permanecem sem tradução.

## Privacidade e telemetria

O WSLPad não tem sistema de contas nem dependência de nuvem para seus recursos de inspeção do WSL. Dados do ambiente, caminhos de arquivos, comandos do terminal, portas, conteúdo de configurações e dados do MCP permanecem locais, a menos que você os exporte ou copie explicitamente.

As builds de produção empacotadas enviam um **heartbeat mínimo do PurplePulse no máximo uma vez por dia local** para estimar o número de instalações ativas. O payload contém:

- um ID de instalação aleatório e persistente
- a versão do WSLPad
- o SO (`windows`)
- a plataforma (`electron`)

Execuções de desenvolvimento e QA não enviam telemetria de produção. O heartbeat **não** inclui conteúdo do WSL, caminhos de arquivos, variáveis de ambiente, comandos do terminal, endereços IP, portas, nomes de distros, nomes de projetos ou segredos.

Veja [docs/SECURITY.md](docs/SECURITY.md) para o modelo de segurança mais amplo.

## Desenvolvimento

```bash
npm install          # or npm ci
npm run dev          # electron-vite development build
npm run typecheck    # strict TypeScript checks
npm run lint         # ESLint
npm run test         # unit + integration tests
npm run build        # production build
npm run test:e2e     # Playwright Electron E2E
npm run dist         # NSIS installer + blockmap
```

A versão v1.1.1 foi verificada com:

- typecheck do TypeScript: aprovado
- ESLint: aprovado
- unitários/integração: **1.614 aprovados**
- Playwright E2E: **52 aprovados**
- teste de fumaça do ciclo de vida do instalador: instalação, inicialização, desinstalação e reinstalação aprovadas
- validação do manifesto WinGet: aprovada

`WSLPAD_FIXTURE_MODE=1` executa o aplicativo contra um mundo WSL determinístico em memória para CI e testes E2E.

Detalhes de arquitetura e de lançamento:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## Fora de escopo

O WSLPad **não** é uma IDE, um substituto do Docker Desktop, um cliente Git, um aplicativo de chat de IA ou um corretor autônomo de sistema.

Ele também não é, em primeiro lugar, uma loja de distros. Se tudo o que você precisa é de um botão para instalar/iniciar/parar distribuições, um gerenciador de WSL convencional pode ser uma opção melhor.

A identidade do WSLPad é:

**Painel do WSL + diagnóstico + gerenciador de arquivos Windows/WSL + terminal + ferramentas de recuperação + MCP somente leitura.**

## Limitações atuais (v1.1.1)

- Somente Windows x64; o instalador atualmente não é assinado.
- Algumas informações da imagem de disco exigem acesso ao registro do Windows e ao `fsutil`.
- A detecção do modo de rede em vigor exige builds modernas do WSL com `wslinfo`; builds mais antigas podem informar desconhecido.
- As informações do firewall do Hyper-V só estão disponíveis em builds do Windows que expõem essa camada.
- O histórico de tendências é mantido em memória e é reiniciado quando o WSLPad é encerrado.
- A sincronização automática do diretório atual (cwd) do Console atualmente contempla bash e zsh.
- As transferências Windows ↔ WSL entre painéis são apenas de cópia por design.
- Arrastar arquivos a partir de uma janela externa do Explorador de Arquivos do Windows depende de o Electron expor os caminhos dos arquivos; o painel do Windows embutido e o fluxo de Importar são o caminho confiável.
- A ponte stdio do MCP exige que o aplicativo da bandeja esteja em execução.

## Roadmap

As direções atuais incluem:

- comandos de redução/expansão (shrink/expand) de VHDX preparados com segurança para o Console
- builds ARM64
- instalador do Windows assinado

## Comunidade

Perguntas e ideias vão para as [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions). Bugs vão para o [rastreador de issues](https://github.com/r2cuerdame/WSLPad/issues/new/choose), e questões de segurança podem ser relatadas por meio de um [aviso de segurança privado](https://github.com/r2cuerdame/WSLPad/security/advisories/new).

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## Licença

MIT
