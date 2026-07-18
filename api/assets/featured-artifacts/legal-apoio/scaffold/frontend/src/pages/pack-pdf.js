/*
 * Pack do pedido de apoio judiciário - documento HTML autónomo para
 * window.__ekoa.exportPdf. Reúne, a partir dos dados da espinha partilhada,
 * tudo o que o advogado precisa para submeter no SinOA: identificação do
 * pedido, prazos gerados (com as fontes legais), fase e despesas com o
 * comprovativo de correio registado.
 *
 * Puro e determinístico (sem I/O, sem Date.now): o mesmo pedido produz sempre
 * o mesmo HTML. Importa apenas apoio-logic.js (que só depende do motor de
 * prazos), pelo que é verificável em node puro.
 */

import { TIPO_PEDIDO_LABEL, ESTADO_LABEL, FASE_LABEL, somaDespesas } from './apoio-logic.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 'YYYY-MM-DD' -> 'DD/MM/YYYY'; devolve o valor original se não for ISO. */
function dataPt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/* Formato monetário determinístico, sem depender do locale do renderer. */
function eur(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  const [int, dec] = n.toFixed(2).split('.');
  const milhares = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${milhares},${dec} EUR`;
}

function contagemLabel(contagem, dias) {
  return contagem === 'uteis' ? `${dias} dias úteis` : `${dias} dias corridos`;
}

/*
 * Constrói o pack. `prazos` é a saída de gerarPrazosPedido (pode ser []),
 * `despesas` a lista de honorários (pode ser []). Devolve { html, filename }.
 */
export function packPedidoHtml({ pedido, cliente, processo, prazos, despesas, fase }) {
  if (!pedido || !pedido.id) throw new Error('Pedido em falta - não é possível gerar o pack.');
  const listaPrazos = Array.isArray(prazos) ? prazos : [];
  const listaDespesas = Array.isArray(despesas) ? despesas : [];
  const total = somaDespesas(listaDespesas);
  const tipo = TIPO_PEDIDO_LABEL[pedido.tipoPedido] || pedido.tipoPedido || '-';
  const estado = ESTADO_LABEL[pedido.estado] || pedido.estado || '-';
  const datas = pedido.datas || {};

  const linhasPrazos = listaPrazos.map((p) => `
      <tr>
        <td>${esc(p.descricao)}</td>
        <td>${esc(contagemLabel(p.contagem, p.dias))}</td>
        <td class="num">${esc(p.resultado && p.resultado.dataLimite ? dataPt(p.resultado.dataLimite) : '-')}</td>
        <td>${esc(p.fonte || 'Baliza SinOA (prática registada; sem norma única citável)')}</td>
      </tr>`).join('');

  const linhasDespesas = listaDespesas.map((d) => `
      <tr>
        <td>${esc(d.descricao || '-')}</td>
        <td>${esc(d.registoRef ? `Correio registado ${d.registoRef}` : 'Sem comprovativo de correio')}</td>
        <td class="num">${esc(eur(d.valor))}</td>
      </tr>`).join('');

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<title>Pack do pedido de apoio judiciário</title>
<style>
  body { font: 12px/1.55 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 32px; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #45506b; border-bottom: 1px solid #d7dce8; padding-bottom: 4px; }
  .sub { color: #5a6480; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d7dce8; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f2f4f9; font-weight: 600; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .meta td:first-child { width: 32%; background: #f8f9fc; font-weight: 600; }
  .total td { font-weight: 700; background: #f8f9fc; }
  .aviso { margin-top: 20px; padding: 10px 12px; border: 1px solid #e3c98f; background: #fdf6e5; border-radius: 4px; }
  .fontes { margin-top: 6px; padding-left: 18px; }
  .fontes li { margin-bottom: 3px; }
</style>
</head>
<body>
  <h1>Pack do pedido de apoio judiciário</h1>
  <p class="sub">${esc(tipo)} - estado: ${esc(estado)}. Gerado pela aplicação Apoio Judiciário a partir dos dados da espinha partilhada.</p>

  <h2>Identificação</h2>
  <table class="meta">
    <tr><td>Requerente</td><td>${esc(cliente && cliente.nome ? cliente.nome : '(cliente removido)')}</td></tr>
    <tr><td>Tipo de pedido</td><td>${esc(tipo)}</td></tr>
    <tr><td>Processo</td><td>${esc(processo && processo.numeroProcesso ? processo.numeroProcesso : 'Sem processo associado')}</td></tr>
    <tr><td>Data do pedido</td><td>${esc(datas.pedido ? dataPt(datas.pedido) : '-')}</td></tr>
    <tr><td>Notificação da decisão</td><td>${esc(datas.notificacao ? dataPt(datas.notificacao) : 'Ainda não registada')}</td></tr>
    <tr><td>Decisão</td><td>${esc(datas.decisao ? dataPt(datas.decisao) : '-')}</td></tr>
  </table>

  <h2>Prazos gerados</h2>
  ${listaPrazos.length > 0 ? `<table>
    <thead><tr><th>Prazo</th><th>Contagem</th><th>Data-limite</th><th>Fonte</th></tr></thead>
    <tbody>${linhasPrazos}
    </tbody>
  </table>
  <p>A contagem completa (dia a dia, com férias judiciais e feriados) fica na memória de cálculo de cada prazo, na aplicação Prazos.</p>` : '<p>Ainda sem prazos gerados - registe a notificação da decisão para o motor os calcular.</p>'}

  <h2>Honorários - fase e despesas</h2>
  <p>Fase processual: <strong>${esc(FASE_LABEL[fase] || fase || '-')}</strong></p>
  ${listaDespesas.length > 0 ? `<table>
    <thead><tr><th>Despesa</th><th>Comprovativo</th><th>Valor</th></tr></thead>
    <tbody>${linhasDespesas}
      <tr class="total"><td colspan="2">Total</td><td class="num">${esc(eur(total))}</td></tr>
    </tbody>
  </table>` : '<p>Sem despesas registadas.</p>'}

  <h2>Fontes legais</h2>
  <ul class="fontes">
    <li>Lei n.º 34/2004, de 29 de julho (acesso ao direito e aos tribunais) - regime do apoio judiciário.</li>
    <li>Lei n.º 34/2004, art. 33.º - o patrono nomeado deve intentar a ação nos 30 dias seguintes à notificação da nomeação.</li>
    <li>Lei n.º 34/2004, art. 34.º - o pedido de escusa interrompe o prazo; a Ordem dos Advogados decide em 15 dias.</li>
  </ul>

  <div class="aviso">
    A submissão é feita pelo advogado no SinOA - este pack apenas organiza os elementos do pedido e não
    substitui nenhum passo oficial. Confirme sempre os prazos na notificação original.
  </div>
</body>
</html>`;

  return { html, filename: `pack-apoio-${pedido.id}` };
}
