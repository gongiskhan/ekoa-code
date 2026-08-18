#!/usr/bin/env bash
# =============================================================================
#  Ponte Ekoa - instalador para macOS e Linux.
#
#  Uso (copie a linha que a Ekoa lhe mostra, ja com o endereco correto):
#    curl -fsSL https://github.com/gongiskhan/ekoa-bridge/releases/latest/download/install.sh | bash -s -- --url https://app.ekoa.pt
#
#  Porque e um SCRIPT e nao um ficheiro para duplo-clique: no macOS, um .command
#  descarregado fica em quarentena (Gatekeeper) e so corre depois de o utilizador
#  ir as Definicoes > Privacidade e Seguranca e autorizar - um passo que nao se
#  pode pedir a um utilizador nao tecnico. Um comando colado no Terminal nao passa
#  pela quarentena, porque nao ha ficheiro descarregado para bloquear.
# =============================================================================
set -euo pipefail

TARBALL="${EKOA_BRIDGE_TARBALL:-https://github.com/gongiskhan/ekoa-bridge/releases/latest/download/ekoa-bridge-latest.tgz}"
CORTEX_URL="${EKOA_CORTEX_URL:-}"
NEED_MAJOR=20
AUTO_START=1

while [ $# -gt 0 ]; do
  case "$1" in
    --url) CORTEX_URL="${2:-}"; shift 2 ;;
    --url=*) CORTEX_URL="${1#--url=}"; shift ;;
    --no-start) AUTO_START=0; shift ;;
    *) shift ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux)  OS=linux ;;
  *)      die "Sistema nao suportado ($(uname -s)). A Ponte Ekoa corre em macOS, Linux e Windows." ;;
esac

say ""
say "==================================================="
say "  Ponte Ekoa"
say "==================================================="
say ""

# --- 1) Node.js 20+ ----------------------------------------------------------
# A instalacao do Node NAO e automatizada de proposito: instalar um runtime a
# revelia, com privilegios, numa maquina que nao e nossa e uma decisao do dono da
# maquina. Damos a instrucao exata para o sistema em causa e paramos.
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
else
  MAJOR=0
fi
if [ "${MAJOR:-0}" -lt "$NEED_MAJOR" ]; then
  say "A Ponte Ekoa precisa do Node.js ${NEED_MAJOR} ou superior (gratuito)."
  if [ "${MAJOR:-0}" -gt 0 ]; then say "Encontrado: Node.js ${MAJOR}."; else say "Node.js nao encontrado."; fi
  say ""
  if [ "$OS" = mac ]; then
    say "Instale com um destes:"
    say "  brew install node          (se tiver Homebrew)"
    say "  ou descarregue de https://nodejs.org/en/download/prebuilt-installer"
  else
    say "Instale com o gestor de pacotes da sua distribuicao, por exemplo:"
    say "  sudo apt install nodejs npm          (Debian / Ubuntu)"
    say "  sudo dnf install nodejs              (Fedora)"
    say "  sudo pacman -S nodejs npm            (Arch)"
    say "  ou descarregue de https://nodejs.org"
  fi
  say ""
  die "Instale o Node.js e volte a colar o mesmo comando."
fi
command -v npm >/dev/null 2>&1 || die "npm nao encontrado (vem com o Node.js). Reinstale o Node.js ${NEED_MAJOR}+."

# --- 2) instalar / atualizar -------------------------------------------------
say "A instalar a Ponte Ekoa (pode demorar um minuto)..."
# O navegador da automacao (Chromium, ~150 MB) NAO e descarregado aqui: so faz
# falta a quem usar captura de sessao, e e obtido na primeira vez que for preciso.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if ! npm install -g "$TARBALL" >/dev/null 2>&1; then
  # Em instalacoes oficiais do Node, os pacotes globais vivem numa pasta protegida
  # e o npm falha com EACCES. Pedimos a elevacao explicitamente, uma vez, dizendo
  # porque - em vez de sugerir que o utilizador volte a correr tudo com sudo.
  say "A instalacao precisa de permissao de administrador para esta pasta."
  if ! sudo -p "Palavra-passe de %u: " env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g "$TARBALL"; then
    die "Nao foi possivel instalar a Ponte Ekoa. Verifique a ligacao a Internet e tente de novo."
  fi
fi

BRIDGE="$(command -v ekoa-bridge || true)"
[ -n "$BRIDGE" ] || die "A ponte foi instalada mas o comando 'ekoa-bridge' nao esta no PATH. Abra um Terminal novo e tente de novo."

say "Ponte Ekoa instalada."

if [ "$AUTO_START" -eq 0 ]; then
  say ""
  say "Proximos passos:"
  say "  ekoa-bridge pair${CORTEX_URL:+ --url $CORTEX_URL}"
  say "  ekoa-bridge serve"
  exit 0
fi

# --- 3) emparelhar (so na primeira vez) --------------------------------------
# Testamos o FICHEIRO de configuracao, nao o texto do `status`. O instalador antigo
# procurava a frase "nao emparelhado" na saida em portugues, o que depende de
# acentos, da locale do terminal e de a mensagem nunca mudar - tres formas de o
# passo de emparelhamento ser silenciosamente saltado numa maquina por emparelhar.
CONFIG="${EKOA_BRIDGE_HOME:-$HOME/.ekoa-bridge}/config.json"
if [ ! -f "$CONFIG" ]; then
  say ""
  say "A ligar a sua conta Ekoa..."
  if [ -n "$CORTEX_URL" ]; then
    "$BRIDGE" pair --url "$CORTEX_URL"
  else
    # Sem --url o CLI usa o seu proprio valor por omissao. Um endereco errado aqui
    # e a falha mais comum: o instalador antigo assumia http://localhost:4111, que
    # numa maquina de utilizador aponta para a propria maquina e nunca liga.
    say "AVISO: nenhum endereco Ekoa indicado (--url). A usar o valor por omissao do CLI."
    "$BRIDGE" pair
  fi
fi

# --- 4) ligar ----------------------------------------------------------------
# Preferimos o arranque automatico (launchd no macOS, systemd --user no Linux): a
# ponte sobrevive a reinicios e a janela pode fechar-se. So se o registo falhar
# (plataforma sem suporte, systemd de utilizador indisponivel) e que caimos para
# o modo antigo de "deixe esta janela aberta".
# Num upgrade, um daemon antigo (arrancado a mao com nohup) ainda esta a correr o
# codigo anterior E segura o pidfile - o serve do launchd bateria nessa guarda e o
# utilizador ficaria com o daemon velho ate ele morrer sozinho. Paramos primeiro.
OLD_PID_FILE="${EKOA_BRIDGE_HOME:-$HOME/.ekoa-bridge}/daemon.pid"
if [ -f "$OLD_PID_FILE" ]; then
  OLD_PID="$(cat "$OLD_PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    say "A parar a ponte antiga (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

say ""
if "$BRIDGE" autostart on; then
  say ""
  say "A ponte esta ligada e liga-se sozinha ao iniciar o computador."
  say "Pode fechar esta janela. Para desativar:  ekoa-bridge autostart off"
else
  say ""
  say "Nao foi possivel ativar o arranque automatico; a ligar em primeiro plano."
  say "A ponte esta a funcionar. Deixe esta janela aberta."
  say "Para desligar, feche a janela ou prima Ctrl+C."
  say ""
  exec "$BRIDGE" serve
fi
