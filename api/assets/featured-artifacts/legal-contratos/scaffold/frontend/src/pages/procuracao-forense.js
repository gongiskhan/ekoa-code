/*
 * Minuta app-local de PROCURAÇÃO FORENSE, para o botão de um clique da galeria de
 * Contratos - MÓDULO PURO (sem `window`, sem `new Date()`, sem efeitos colaterais).
 *
 * A procuração forense é o instrumento de mandato judicial. O corpo cita os
 * artigos do Código de Processo Civil que a enquadram:
 *   - art. 44.º CPC  - o mandato confere poderes para representar a parte em
 *                      todos os atos e termos do processo, incluindo o poder de
 *                      SUBSTABELECER (presumido salvo reserva);
 *   - art. 45.º CPC  - distingue os poderes gerais dos ESPECIAIS: confessar,
 *                      transigir e desistir só com autorização EXPRESSA na
 *                      procuração.
 * As {{chaves}} seguem a convenção da espinha (cliente_nome/nif/morada,
 * processo_numero) - as mesmas `variaveis` que o wizard de Contratos consome.
 *
 * As citações são verificáveis (CPC, Diário da República). O advogado revê
 * sempre antes de usar - o documento gerado é um rascunho editável.
 */

const CORPO = [
  'PROCURAÇÃO FORENSE',
  '',
  '{{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, constitui seu bastante procurador o(a) mandatário(a) signatário(a), a quem confere os poderes forenses gerais para o(a) representar em juízo e fora dele, nos termos do artigo 44.º do Código de Processo Civil, incluindo o poder de substabelecer, com ou sem reserva.',
  '',
  'Ao abrigo do artigo 45.º do Código de Processo Civil, confere ainda os poderes especiais para confessar, desistir e transigir.',
  '',
  'Os presentes poderes destinam-se, em especial, ao patrocínio no processo n.º {{processo_numero}} e a todos os atos e diligências com ele relacionados.',
  '',
  'Por ser esta a sua vontade, vai a presente procuração por si assinada.',
  '',
  '__________________________, ___ de ____________ de ______',
  '',
  'O(A) Mandante,',
  '____________________________________',
].join('\n');

/*
 * Esqueleto do modelo de procuração forense a criar na colecção partilhada
 * `modelos`. `fonte`/`fonteOriginal` registam a proveniência (o enquadramento
 * legal do CPC), tal como as linhas importadas da biblioteca.
 */
export const PROCURACAO_FORENSE_MODELO = {
  nome: 'Procuração forense',
  area: 'Procurações',
  categoria: 'Procurações',
  descricao: 'Mandato judicial com poderes forenses gerais e especiais (arts. 44.º e 45.º CPC).',
  fonte: 'importado',
  fonteOriginal: 'Enquadramento legal: arts. 44.º e 45.º do Código de Processo Civil (Diário da República)',
  licenca: 'domínio público / uso livre',
  versao: 1,
  corpo: CORPO,
  variaveis: [
    { chave: 'cliente_nome', rotulo: 'Nome do cliente', origem: 'cliente.nome', obrigatoria: true },
    { chave: 'cliente_nif', rotulo: 'NIF do cliente', origem: 'cliente.nif', obrigatoria: true },
    { chave: 'cliente_morada', rotulo: 'Morada do cliente', origem: 'cliente.morada', obrigatoria: false },
    { chave: 'processo_numero', rotulo: 'Número do processo', origem: 'processo.numero', obrigatoria: false },
  ],
};
