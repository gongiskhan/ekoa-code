/*
 * Biblioteca ESTÁTICA de minutas jurídicas - fonte oficial, licença livre.
 *
 * REGRA REGULATÓRIA (§3.2.2): só conteúdo de fonte oficial/governamental pode
 * ser reproduzido de forma literal. Todas as minutas aqui são REDIGIDAS DE RAIZ
 * a partir da ESTRUTURA de tipos de documento públicos (DRE, IRN, DGAEP,
 * Segurança Social) - nenhuma é copiada de fontes proprietárias (a Ordem dos
 * Advogados e o PortalForense estão expressamente proibidos e não são
 * referenciados). Cada item regista a `fonte` (o TIPO de fonte oficial) e a
 * `licenca` ('domínio público / uso livre'), que acompanham o modelo até à
 * colecção partilhada quando o utilizador o importa.
 *
 * Os placeholders {{cliente_nome}} / {{cliente_nif}} / {{cliente_morada}} /
 * {{processo_numero}} mapeiam para origens da espinha (cliente/processo) através
 * das `variaveis` de cada item; os restantes são `manual` (preenchidos na
 * geração, no app de Contratos). Ficheiro PURO: sem `window`, sem `new Date()`.
 */

const LICENCA_LIVRE = 'domínio público / uso livre';

/* Chaves da espinha reutilizadas por várias minutas (evita repetição). */
const VAR_CLIENTE_NOME = { chave: 'cliente_nome', rotulo: 'Nome do cliente', origem: 'cliente.nome', obrigatoria: true };
const VAR_CLIENTE_NIF = { chave: 'cliente_nif', rotulo: 'NIF do cliente', origem: 'cliente.nif', obrigatoria: true };
const VAR_CLIENTE_MORADA = { chave: 'cliente_morada', rotulo: 'Morada do cliente', origem: 'cliente.morada', obrigatoria: false };
const VAR_PROCESSO_NUMERO = { chave: 'processo_numero', rotulo: 'Número do processo', origem: 'processo.numero', obrigatoria: false };

const PROCURACAO_FORENSE = [
  'PROCURAÇÃO FORENSE',
  '',
  '{{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, constitui seu bastante procurador o(a) mandatário(a) signatário(a), a quem confere os poderes forenses gerais em direito permitidos, para o(a) representar em juízo e fora dele, incluindo os poderes especiais para confessar, desistir e transigir, bem como o de substabelecer.',
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

const PROCURACAO_ESPECIAL = [
  'PROCURAÇÃO COM PODERES ESPECIAIS',
  '',
  '{{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, constitui seu bastante procurador o(a) mandatário(a) signatário(a), a quem confere, além dos poderes forenses gerais, os seguintes poderes especiais: {{poderes_especiais}}.',
  '',
  'Os poderes ora conferidos podem ser substabelecidos, no todo ou em parte, e mantêm-se válidos até revogação expressa.',
  '',
  '__________________________, ___ de ____________ de ______',
  '',
  'O(A) Mandante,',
  '____________________________________',
].join('\n');

const REQUERIMENTO_GENERICO = [
  'EXMO. SENHOR DOUTOR JUIZ DE DIREITO',
  '',
  '{{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, no âmbito do processo n.º {{processo_numero}}, vem, respeitosamente, expor e requerer a Vossa Excelência o seguinte:',
  '',
  '{{exposicao}}',
  '',
  'Nestes termos, requer-se a Vossa Excelência que se digne deferir o presente pedido, por ser de inteira justiça.',
  '',
  'Pede deferimento.',
  '',
  '__________________________, ___ de ____________ de ______',
].join('\n');

const REQUERIMENTO_CERTIDAO = [
  'EXMO. SENHOR',
  '',
  '{{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, vem requerer a passagem de certidão, com indicação do fim a que se destina, relativa a {{objeto_certidao}}, no âmbito do processo n.º {{processo_numero}}.',
  '',
  'Mais requer que a certidão seja emitida com a maior brevidade possível, colocando-se desde já à disposição para o pagamento dos encargos legalmente devidos.',
  '',
  'Pede deferimento.',
  '',
  '__________________________, ___ de ____________ de ______',
].join('\n');

const DECLARACAO_HONRA = [
  'DECLARAÇÃO SOB COMPROMISSO DE HONRA',
  '',
  '{{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, declara, sob compromisso de honra e ciente de que a prestação de falsas declarações a faz incorrer nas sanções previstas na lei, que {{facto_declarado}}.',
  '',
  'Por ser verdade, e para que produza os devidos efeitos legais, vai a presente declaração por si assinada.',
  '',
  '__________________________, ___ de ____________ de ______',
  '',
  'O(A) Declarante,',
  '____________________________________',
].join('\n');

const ARRENDAMENTO_HABITACIONAL = [
  'CONTRATO DE ARRENDAMENTO PARA FIM HABITACIONAL',
  '',
  'PRIMEIRO OUTORGANTE (Senhorio): _________________________________________',
  '',
  'SEGUNDO OUTORGANTE (Arrendatário): {{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}.',
  '',
  'CLÁUSULA PRIMEIRA (Objeto)',
  'O PRIMEIRO OUTORGANTE dá de arrendamento ao SEGUNDO OUTORGANTE, que aceita, o imóvel sito em {{imovel_morada}}, destinado exclusivamente a habitação.',
  '',
  'CLÁUSULA SEGUNDA (Prazo)',
  'O arrendamento tem o prazo de {{prazo}}, com início em ___ de ____________ de ______, renovável nos termos da lei.',
  '',
  'CLÁUSULA TERCEIRA (Renda)',
  'A renda mensal é de {{renda}}, a pagar até ao dia oito do mês anterior àquele a que respeitar, por meio a acordar entre as partes.',
  '',
  'CLÁUSULA QUARTA (Regime aplicável)',
  'Em tudo o que não estiver expressamente previsto, aplica-se o disposto no Código Civil e no Regime do Arrendamento Urbano.',
  '',
  '__________________________, ___ de ____________ de ______',
  '',
  'O PRIMEIRO OUTORGANTE, ____________________    O SEGUNDO OUTORGANTE, ____________________',
].join('\n');

const APOIO_JUDICIARIO = [
  'REQUERIMENTO DE PROTEÇÃO JURÍDICA',
  '',
  'Ao abrigo do regime de acesso ao direito e aos tribunais (Lei n.º 34/2004, de 29 de julho), {{cliente_nome}}, contribuinte fiscal n.º {{cliente_nif}}, com morada em {{cliente_morada}}, vem requerer a concessão de proteção jurídica, na modalidade de {{modalidade}}.',
  '',
  'Para o efeito, declara encontrar-se em situação de insuficiência económica, comprometendo-se a juntar os documentos comprovativos exigidos pelos serviços da Segurança Social.',
  '',
  'O pedido destina-se a fazer valer os seus direitos no âmbito do processo n.º {{processo_numero}}.',
  '',
  'Pede deferimento.',
  '',
  '__________________________, ___ de ____________ de ______',
].join('\n');

/*
 * BIBLIOTECA - a lista canónica de minutas. Cada item: id estável, nome,
 * categoria (uma das cinco), fonte (o TIPO de fonte oficial), licenca, corpo
 * com {{placeholders}} e o mapa de `variaveis`. NUNCA referenciar OA/PortalForense.
 */
export const BIBLIOTECA = [
  {
    id: 'bib-procuracao-forense',
    nome: 'Procuração forense simples',
    categoria: 'Procurações',
    fonte: 'Estrutura conforme minutas notariais públicas (IRN)',
    licenca: LICENCA_LIVRE,
    descricao: 'Mandato judicial com os poderes forenses gerais, para representação em juízo e fora dele.',
    corpo: PROCURACAO_FORENSE,
    variaveis: [VAR_CLIENTE_NOME, VAR_CLIENTE_NIF, VAR_CLIENTE_MORADA, VAR_PROCESSO_NUMERO],
  },
  {
    id: 'bib-procuracao-especial',
    nome: 'Procuração com poderes especiais',
    categoria: 'Procurações',
    fonte: 'Estrutura conforme minutas notariais públicas (IRN)',
    licenca: LICENCA_LIVRE,
    descricao: 'Mandato com poderes especiais discriminados, além dos poderes forenses gerais.',
    corpo: PROCURACAO_ESPECIAL,
    variaveis: [
      VAR_CLIENTE_NOME,
      VAR_CLIENTE_NIF,
      VAR_CLIENTE_MORADA,
      { chave: 'poderes_especiais', rotulo: 'Poderes especiais conferidos', origem: 'manual', obrigatoria: true },
    ],
  },
  {
    id: 'bib-requerimento-generico',
    nome: 'Requerimento genérico ao tribunal',
    categoria: 'Requerimentos',
    fonte: 'Estrutura conforme modelos genéricos de requerimento da Administração Pública (DGAEP)',
    licenca: LICENCA_LIVRE,
    descricao: 'Requerimento avulso ao juiz do processo, com corpo de exposição livre.',
    corpo: REQUERIMENTO_GENERICO,
    variaveis: [
      VAR_CLIENTE_NOME,
      VAR_CLIENTE_NIF,
      VAR_CLIENTE_MORADA,
      VAR_PROCESSO_NUMERO,
      { chave: 'exposicao', rotulo: 'Exposição e pedido', origem: 'manual', obrigatoria: true },
    ],
  },
  {
    id: 'bib-requerimento-certidao',
    nome: 'Requerimento de certidão',
    categoria: 'Requerimentos',
    fonte: 'Estrutura conforme formulários públicos (IRN)',
    licenca: LICENCA_LIVRE,
    descricao: 'Pedido de passagem de certidão, com indicação do objeto e do fim a que se destina.',
    corpo: REQUERIMENTO_CERTIDAO,
    variaveis: [
      VAR_CLIENTE_NOME,
      VAR_CLIENTE_NIF,
      VAR_CLIENTE_MORADA,
      VAR_PROCESSO_NUMERO,
      { chave: 'objeto_certidao', rotulo: 'Objeto da certidão', origem: 'manual', obrigatoria: true },
    ],
  },
  {
    id: 'bib-declaracao-honra',
    nome: 'Declaração sob compromisso de honra',
    categoria: 'Declarações',
    fonte: 'Estrutura conforme declarações públicas (Código do Procedimento Administrativo, DRE)',
    licenca: LICENCA_LIVRE,
    descricao: 'Declaração de facto sob compromisso de honra, com advertência quanto a falsas declarações.',
    corpo: DECLARACAO_HONRA,
    variaveis: [
      VAR_CLIENTE_NOME,
      VAR_CLIENTE_NIF,
      VAR_CLIENTE_MORADA,
      { chave: 'facto_declarado', rotulo: 'Facto declarado', origem: 'manual', obrigatoria: true },
    ],
  },
  {
    id: 'bib-arrendamento-habitacional',
    nome: 'Contrato de arrendamento habitacional (estrutura-base)',
    categoria: 'Contratos',
    fonte: 'Estrutura conforme o Regime do Arrendamento Urbano e o Código Civil (DRE)',
    licenca: LICENCA_LIVRE,
    descricao: 'Estrutura-base de arrendamento para habitação: objeto, prazo, renda e regime aplicável.',
    corpo: ARRENDAMENTO_HABITACIONAL,
    variaveis: [
      VAR_CLIENTE_NOME,
      VAR_CLIENTE_NIF,
      VAR_CLIENTE_MORADA,
      { chave: 'imovel_morada', rotulo: 'Morada do imóvel', origem: 'manual', obrigatoria: true },
      { chave: 'prazo', rotulo: 'Prazo do arrendamento', origem: 'manual', obrigatoria: true },
      { chave: 'renda', rotulo: 'Renda mensal', origem: 'manual', obrigatoria: true },
    ],
  },
  {
    id: 'bib-apoio-judiciario',
    nome: 'Requerimento de apoio judiciário (proteção jurídica)',
    categoria: 'Apoio judiciário',
    fonte: 'Estrutura conforme o regime de proteção jurídica (Lei n.º 34/2004) - modelo público da Segurança Social',
    licenca: LICENCA_LIVRE,
    descricao: 'Pedido de proteção jurídica por insuficiência económica, com indicação da modalidade.',
    corpo: APOIO_JUDICIARIO,
    variaveis: [
      VAR_CLIENTE_NOME,
      VAR_CLIENTE_NIF,
      VAR_CLIENTE_MORADA,
      VAR_PROCESSO_NUMERO,
      { chave: 'modalidade', rotulo: 'Modalidade de proteção jurídica', origem: 'manual', obrigatoria: true },
    ],
  },
];

/* Categorias distintas presentes na biblioteca, pela ordem canónica. */
export const CATEGORIAS = ['Procurações', 'Requerimentos', 'Declarações', 'Contratos', 'Apoio judiciário'];
