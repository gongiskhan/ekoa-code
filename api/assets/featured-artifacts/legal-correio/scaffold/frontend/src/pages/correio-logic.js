/*
 * Lógica pura do módulo de Correio - rótulos, tons de distintivo, custos-base
 * indicativos por tipo e a geração da referência de registo MANUAL. Sem estado,
 * sem I/O; testável isoladamente e partilhada pelas duas páginas.
 */

/* Tipos de objeto postal suportados. */
export const TIPO_LABEL = {
  registado: 'Registado',
  registado_ar: 'Registado com A/R',
  simples: 'Correio simples',
};

export const TIPO_TONE = {
  registado: 'info',
  registado_ar: 'info',
  simples: 'neutral',
};

/*
 * Custo-base INDICATIVO por tipo (EUR). É apenas uma sugestão editável para
 * prefill do formulário - o valor real é o cobrado ao balcão dos CTT. Não é um
 * tarifário oficial nem se pretende que o seja.
 */
export const TIPO_CUSTO = {
  registado: 3.05,
  registado_ar: 4.05,
  simples: 0.65,
};

/* Estados do ciclo de vida de uma carta (transições manuais, honestas). */
export const ESTADO_LABEL = {
  rascunho: 'Rascunho',
  expedido: 'Expedido',
  entregue: 'Entregue',
  devolvido: 'Devolvido',
};

/* Tom do distintivo por estado: rascunho neutro, expedido info, entregue ok,
 * devolvido a vermelho (o tom `alta` da suite). */
export const ESTADO_TONE = {
  rascunho: 'neutral',
  expedido: 'info',
  entregue: 'ok',
  devolvido: 'alta',
};

export function tipoLabel(t) {
  return TIPO_LABEL[t] || t || '—';
}
export function tipoTone(t) {
  return TIPO_TONE[t] || 'neutral';
}
export function estadoLabel(e) {
  return ESTADO_LABEL[e] || e || '—';
}
export function estadoTone(e) {
  return ESTADO_TONE[e] || 'neutral';
}
export function custoBase(t) {
  const v = TIPO_CUSTO[t];
  return v == null ? '' : String(v);
}

/* 'YYYY-MM-DD' local de hoje - calculado na chamada, nunca no topo do módulo. */
export function hojeISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/*
 * Gera uma referência de registo MANUAL no formato UPU (RR + 9 dígitos + PT).
 * NÃO é a referência real dos CTT - é substituída pela referência impressa no
 * comprovativo do balcão. O formato segue o padrão de rastreio (duas letras,
 * nove dígitos, duas letras de país) apenas para que a consulta o aceite.
 */
export function gerarRegistoRef() {
  let digits = '';
  for (let i = 0; i < 9; i += 1) digits += Math.floor(Math.random() * 10);
  return `RR${digits}PT`;
}

/*
 * Classificação mínima de um File/Blob do browser para `documentos.tipo`
 * (pdf | imagem | outro). Local ao Correio - o Dossiê tem a sua própria versão
 * mais rica; aqui só precisamos do suficiente para o comprovativo arquivado.
 */
export function tipoComprovativo(file) {
  const mime = String((file && file.type) || '').toLowerCase();
  const name = String((file && file.name) || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'imagem';
  return 'outro';
}

/* Rótulo PT-PT do estado de rastreio devolvido pela plataforma. */
export const TRACKING_STATUS_LABEL = {
  aceite: 'Aceite pelos CTT',
  em_transito: 'Em trânsito',
  entregue: 'Entregue',
  devolvido: 'Devolvido',
  desconhecido: 'Sem informação de rastreio',
};

export function trackingStatusLabel(s) {
  return TRACKING_STATUS_LABEL[s] || 'Sem informação de rastreio';
}
