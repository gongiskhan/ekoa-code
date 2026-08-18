# =============================================================================
#  Ponte Ekoa - instalador para Windows (PowerShell).
#
#  Uso (copie a linha que a Ekoa lhe mostra, ja com o endereco correto):
#    & ([scriptblock]::Create((irm https://github.com/gongiskhan/ekoa-bridge/releases/latest/download/install.ps1))) -Url https://app.ekoa.pt
#
#  A forma `irm ... | iex` tambem funciona, mas nao aceita parametros - por isso a
#  linha acima cria um scriptblock, que aceita. Sem -Url o CLI usa o seu proprio
#  valor por omissao, que quase nunca e o correto numa maquina de utilizador.
#
#  Sem janelas de dialogo: este script corre num terminal que o utilizador abriu,
#  por isso fala no terminal. MessageBox exigia System.Windows.Forms e falhava em
#  PowerShell 7 / Windows Server sem o Desktop runtime.
# =============================================================================
[CmdletBinding()]
param(
  [string]$Url = $env:EKOA_CORTEX_URL,
  [string]$Tarball = $(if ($env:EKOA_BRIDGE_TARBALL) { $env:EKOA_BRIDGE_TARBALL } else { 'https://github.com/gongiskhan/ekoa-bridge/releases/latest/download/ekoa-bridge-latest.tgz' }),
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$NeedMajor = 20

Write-Host ''
Write-Host '==================================================='
Write-Host '  Ponte Ekoa'
Write-Host '==================================================='
Write-Host ''

# --- 1) Node.js 20+ ----------------------------------------------------------
# A instalacao do Node NAO e automatizada de proposito: instalar um runtime a
# revelia numa maquina que nao e nossa e uma decisao do dono da maquina.
$nodeMajor = 0
try { $nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]' 2>$null) } catch { $nodeMajor = 0 }
if ($nodeMajor -lt $NeedMajor) {
  Write-Host "A Ponte Ekoa precisa do Node.js $NeedMajor ou superior (gratuito)."
  if ($nodeMajor -gt 0) { Write-Host "Encontrado: Node.js $nodeMajor." } else { Write-Host 'Node.js nao encontrado.' }
  Write-Host ''
  Write-Host 'Instale com um destes:'
  Write-Host '  winget install OpenJS.NodeJS.LTS'
  Write-Host '  ou descarregue de https://nodejs.org/en/download/prebuilt-installer'
  Write-Host ''
  Write-Host 'Depois FECHE este terminal, abra um novo e volte a colar o mesmo comando.'
  throw 'Node.js em falta.'
}

# --- 2) instalar / atualizar -------------------------------------------------
Write-Host 'A instalar a Ponte Ekoa (pode demorar um minuto)...'
# O navegador da automacao (Chromium, ~150 MB) NAO e descarregado aqui: so faz
# falta a quem usar captura de sessao, e e obtido na primeira vez que for preciso.
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
& npm install -g $Tarball
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'A instalacao falhou. Se o erro foi de permissoes, abra o PowerShell'
  Write-Host 'como Administrador e volte a colar o mesmo comando.'
  throw 'Instalacao falhou.'
}

$bridge = (Get-Command ekoa-bridge -ErrorAction SilentlyContinue).Source
if (-not $bridge) {
  # Um PATH so e relido em processos novos: logo apos a primeira instalacao global
  # o comando existe em disco mas ainda nao esta resolvivel nesta sessao.
  $npmPrefix = (& npm prefix -g).Trim()
  foreach ($name in @('ekoa-bridge.cmd', 'ekoa-bridge.ps1', 'ekoa-bridge')) {
    $cand = Join-Path $npmPrefix $name
    if (Test-Path $cand) { $bridge = $cand; break }
  }
}
if (-not $bridge) {
  Write-Host 'A ponte foi instalada mas o comando ekoa-bridge nao esta no PATH.'
  Write-Host 'Feche este terminal, abra um novo e escreva:  ekoa-bridge pair'
  throw 'Comando nao encontrado.'
}

Write-Host 'Ponte Ekoa instalada.'

if ($NoStart) {
  Write-Host ''
  Write-Host 'Proximos passos:'
  if ($Url) { Write-Host "  ekoa-bridge pair --url $Url" } else { Write-Host '  ekoa-bridge pair' }
  Write-Host '  ekoa-bridge serve'
  return
}

# --- 3) emparelhar (so na primeira vez) --------------------------------------
# Testamos o FICHEIRO de configuracao, nao o texto do `status`. O instalador antigo
# procurava a frase "nao emparelhado" na saida em portugues, o que depende de
# acentos, da locale do terminal e de a mensagem nunca mudar - tres formas de o
# passo de emparelhamento ser silenciosamente saltado numa maquina por emparelhar.
$bridgeHome = if ($env:EKOA_BRIDGE_HOME) { $env:EKOA_BRIDGE_HOME } else { Join-Path $HOME '.ekoa-bridge' }
$configPath = Join-Path $bridgeHome 'config.json'
if (-not (Test-Path $configPath)) {
  Write-Host ''
  Write-Host 'A ligar a sua conta Ekoa...'
  if ($Url) {
    & $bridge pair --url $Url
  } else {
    # Um endereco errado aqui e a falha mais comum: o instalador antigo assumia
    # http://localhost:4111, que numa maquina de utilizador aponta para a propria
    # maquina e nunca liga.
    Write-Host 'AVISO: nenhum endereco Ekoa indicado (-Url). A usar o valor por omissao do CLI.'
    & $bridge pair
  }
  if ($LASTEXITCODE -ne 0) { throw 'O emparelhamento nao foi concluido.' }
}

# --- 4) ligar ----------------------------------------------------------------
Write-Host ''
Write-Host 'A ponte esta a funcionar. Deixe esta janela aberta.'
Write-Host 'Para desligar, feche a janela ou prima Ctrl+C.'
Write-Host ''
& $bridge serve
