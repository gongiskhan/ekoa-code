/*
 * Nova dívida - registo MANUAL ou por leitura de FATURA (visão do Cortex).
 * Nada é gravado antes da confirmação explícita do utilizador (brief); a
 * criação regista sempre o evento imutável na linha do tempo.
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tr, useLang, currentLang } from '../i18n.js';
import { useClientes, useColecao } from '../hooks.js';
import {
  criar, registarEvento, extrairDocumento, ficheiroParaBase64, disponivel,
} from '../ekoa.js';
import {
  Button, Field, Input, Select, Textarea, Tabs, Skeleton, toast, EmptyState, Badge,
} from '../components/ui.jsx';
import { eur, formatData, indexarOverlay } from '../components/dominio.jsx';
import {
  IconUpload, IconCamera, IconAviso, IconCerto, IconMais, IconClientes,
} from '../components/Icons.jsx';
import { parseMontante } from '../engine/dinheiro.mjs';
import { parseDia, addDias, parseDataFlex } from '../engine/datas.mjs';
import { semelhancaNomes } from '../engine/normalizacao.mjs';

const TIPOS_FICHEIRO = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

function nifLimpo(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Monta o texto de um montante já validado no idioma atual. */
function textoMontante(v) {
  const s = Number(v).toFixed(2);
  return currentLang() === 'en' ? s : s.replace('.', ',');
}

const FORM_VAZIO = {
  clienteId: '',
  descricao: '',
  numeroFatura: '',
  valorTexto: '',
  dataVencimento: '',
  notas: '',
};

export default function NovaDividaPage() {
  useLang();
  const navigate = useNavigate();
  const clientes = useClientes();
  const overlays = useColecao('clientes_cobranca');
  const overlayPorCliente = useMemo(() => indexarOverlay(overlays.items), [overlays.items]);

  const [tab, setTab] = useState('manual');
  const [aGuardar, setAGuardar] = useState(false);

  // ---- manual ----
  const [form, setForm] = useState(FORM_VAZIO);

  // ---- fatura ----
  const [fase, setFase] = useState('inicial'); // 'inicial' | 'aLer' | 'confirmar'
  const [erroExtracao, setErroExtracao] = useState(null); // {mensagem, code}
  const [extraido, setExtraido] = useState(null); // dados brutos devolvidos pela visão
  const [formFatura, setFormFatura] = useState(FORM_VAZIO);
  const [sugestao, setSugestao] = useState(null); // {clienteId, pontuacao}
  const inputCamaraRef = useRef(null);

  const clientesOrdenados = useMemo(
    () => [...(clientes.items || [])].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt')),
    [clientes.items],
  );

  function rotuloCliente(c) {
    const overlay = overlayPorCliente.get(c.id);
    return overlay && overlay.naoContactar
      ? `${c.nome} ${tr('(não contactar)', '(do not contact)')}`
      : c.nome;
  }

  function opcoesClientes() {
    return (
      <>
        <option value="">{tr('Selecione o cliente…', 'Select the customer…')}</option>
        {clientesOrdenados.map((c) => (
          <option key={c.id} value={c.id}>{rotuloCliente(c)}</option>
        ))}
      </>
    );
  }

  /** Validação comum aos dois fluxos; devolve os dados prontos ou null. */
  function validar(f) {
    if (!f.clienteId) {
      toast(tr('Selecione o cliente da dívida.', 'Select the customer for this debt.'), { tone: 'error' });
      return null;
    }
    if (!f.descricao.trim()) {
      toast(tr('A descrição é obrigatória.', 'The description is required.'), { tone: 'error' });
      return null;
    }
    const valor = parseMontante(f.valorTexto);
    if (valor == null || valor <= 0) {
      toast(tr('Indique um valor válido superior a zero.', 'Enter a valid amount greater than zero.'), { tone: 'error' });
      return null;
    }
    if (!f.dataVencimento || !parseDia(f.dataVencimento)) {
      toast(tr('Indique uma data de vencimento válida.', 'Enter a valid due date.'), { tone: 'error' });
      return null;
    }
    return {
      clienteId: f.clienteId,
      descricao: f.descricao.trim(),
      numeroFatura: f.numeroFatura.trim() || null,
      valor,
      dataVencimento: f.dataVencimento,
      notas: f.notas.trim() || null,
    };
  }

  async function criarDivida(dados, extra, detalheEvento, meta) {
    setAGuardar(true);
    try {
      const nova = await criar('dividas', { ...dados, estado: 'aberta', ...extra });
      await registarEvento({
        clienteId: dados.clienteId,
        dividaId: nova && nova.id ? nova.id : null,
        tipo: 'estado',
        titulo: tr('Dívida registada', 'Debt created'),
        detalhe: detalheEvento,
        meta: meta || null,
      });
      toast(tr('Dívida registada com sucesso.', 'Debt created successfully.'), { tone: 'ok' });
      navigate(nova && nova.id ? `/dividas/${nova.id}` : '/dividas');
    } catch (err) {
      toast(
        tr('Falha ao gravar a dívida: ', 'Failed to save the debt: ')
          + (err instanceof Error ? err.message : String(err)),
        { tone: 'error' },
      );
    } finally {
      setAGuardar(false);
    }
  }

  function submeterManual() {
    const dados = validar(form);
    if (!dados) return;
    criarDivida(
      dados,
      { origem: 'manual' },
      tr(
        `Registo manual. Valor ${eur(dados.valor)}, vencimento a ${formatData(dados.dataVencimento)}.`,
        `Manual entry. Amount ${eur(dados.valor)}, due ${formatData(dados.dataVencimento)}.`,
      ),
      { origem: 'manual' },
    );
  }

  function submeterFatura() {
    const dados = validar(formFatura);
    if (!dados) return;
    criarDivida(
      dados,
      { origem: 'fatura', origemSnapshot: extraido || null },
      tr(
        `Criada a partir de fatura digitalizada (extração automática). Valor ${eur(dados.valor)}, vencimento a ${formatData(dados.dataVencimento)}.`,
        `Created from a scanned invoice (automatic extraction). Amount ${eur(dados.valor)}, due ${formatData(dados.dataVencimento)}.`,
      ),
      { origem: 'fatura', numeroFatura: dados.numeroFatura },
    );
  }

  /** Classifica os clientes face ao nome/NIF extraídos e devolve o melhor. */
  function melhorCorrespondencia(dados) {
    const nif = nifLimpo(dados.clienteNif);
    let melhor = null;
    for (const c of clientesOrdenados) {
      const porNif = nif && nifLimpo(c.nif) && nifLimpo(c.nif) === nif ? 1 : 0;
      const pontuacao = Math.max(semelhancaNomes(dados.clienteNome, c.nome), porNif);
      if (!melhor || pontuacao > melhor.pontuacao) melhor = { clienteId: c.id, pontuacao };
    }
    return melhor && melhor.pontuacao > 0.5 ? melhor : null;
  }

  async function processarFicheiro(file) {
    if (!file) return;
    if (!TIPOS_FICHEIRO.includes(file.type)) {
      toast(tr('Formato não suportado. Use PNG, JPEG, WebP ou PDF.', 'Unsupported format. Use PNG, JPEG, WebP or PDF.'), { tone: 'error' });
      return;
    }
    setErroExtracao(null);
    setFase('aLer');
    try {
      const base64 = await ficheiroParaBase64(file);
      const pedido = file.type === 'application/pdf'
        ? { kind: 'invoice', pdfBase64: base64, language: currentLang() }
        : { kind: 'invoice', imageBase64: base64, mediaType: file.type, language: currentLang() };
      const r = await extrairDocumento(pedido);
      if (!r.success) {
        setErroExtracao({ mensagem: r.error || tr('Falha na extração.', 'Extraction failed.'), code: r.code || null });
        setFase('inicial');
        return;
      }
      const dados = r.data || {};
      const valor = parseMontante(dados.valorTotal);
      const emissaoISO = parseDataFlex(dados.dataEmissao);
      const vencimentoISO = parseDataFlex(dados.dataVencimento)
        || (emissaoISO ? addDias(emissaoISO, 30) : null);
      const melhor = melhorCorrespondencia(dados);
      setExtraido(dados);
      setSugestao(melhor);
      setFormFatura({
        clienteId: melhor ? melhor.clienteId : '',
        descricao: String(dados.descricao || '').trim()
          || (dados.numeroFatura ? tr(`Fatura ${dados.numeroFatura}`, `Invoice ${dados.numeroFatura}`) : ''),
        numeroFatura: String(dados.numeroFatura || ''),
        valorTexto: valor != null ? textoMontante(valor) : '',
        dataVencimento: vencimentoISO || '',
        notas: '',
      });
      setFase('confirmar');
    } catch (err) {
      setErroExtracao({
        mensagem: err instanceof Error ? err.message : String(err),
        code: null,
      });
      setFase('inicial');
    }
  }

  function aoEscolherFicheiro(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    processarFicheiro(file);
    input.value = '';
  }

  function reporFatura() {
    setFase('inicial');
    setErroExtracao(null);
    setExtraido(null);
    setSugestao(null);
    setFormFatura(FORM_VAZIO);
  }

  function normalizarValorAoSair(f, setF) {
    const v = parseMontante(f.valorTexto);
    if (v != null) setF({ ...f, valorTexto: textoMontante(v) });
  }

  /* --------------------------- blocos de render --------------------------- */

  function camposComuns(f, setF, prefixo) {
    return (
      <>
        <Field label={tr('Descrição', 'Description')} required htmlFor={`${prefixo}-descricao`}>
          <Input
            id={`${prefixo}-descricao`}
            data-testid={`${prefixo}-descricao`}
            value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
            placeholder={tr('Ex.: Honorários processo n.º 123/2026', 'E.g. Fees for case no. 123/2026')}
          />
        </Field>
        <Field label={tr('N.º de fatura', 'Invoice no.')} htmlFor={`${prefixo}-fatura`}>
          <Input
            id={`${prefixo}-fatura`}
            data-testid={`${prefixo}-numero-fatura`}
            value={f.numeroFatura}
            onChange={(e) => setF({ ...f, numeroFatura: e.target.value })}
            placeholder={tr('Opcional', 'Optional')}
          />
        </Field>
        <Field label={tr('Valor (EUR)', 'Amount (EUR)')} required htmlFor={`${prefixo}-valor`}>
          <Input
            id={`${prefixo}-valor`}
            data-testid={`${prefixo}-valor`}
            inputMode="decimal"
            value={f.valorTexto}
            onChange={(e) => setF({ ...f, valorTexto: e.target.value })}
            onBlur={() => normalizarValorAoSair(f, setF)}
            placeholder={tr('0,00', '0.00')}
          />
        </Field>
        <Field label={tr('Data de vencimento', 'Due date')} required htmlFor={`${prefixo}-vencimento`}>
          <Input
            id={`${prefixo}-vencimento`}
            data-testid={`${prefixo}-data-vencimento`}
            type="date"
            value={f.dataVencimento}
            onChange={(e) => setF({ ...f, dataVencimento: e.target.value })}
          />
        </Field>
      </>
    );
  }

  function seletorCliente(f, setF, prefixo, extraAposLabel) {
    return (
      <Field
        label={tr('Cliente', 'Customer')}
        required
        htmlFor={`${prefixo}-cliente`}
        hint={extraAposLabel || undefined}
      >
        <Select
          id={`${prefixo}-cliente`}
          data-testid={`${prefixo}-cliente`}
          value={f.clienteId}
          onChange={(e) => setF({ ...f, clienteId: e.target.value })}
        >
          {opcoesClientes()}
        </Select>
      </Field>
    );
  }

  const semClientes = !clientes.loading && clientesOrdenados.length === 0;

  function conteudoManual() {
    if (clientes.loading) return <div className="cartao"><Skeleton lines={5} /></div>;
    if (semClientes) {
      return (
        <EmptyState
          icon={<IconClientes size={28} />}
          title={tr('Sem clientes na base do espaço de trabalho', 'No customers in the workspace base')}
          hint={tr(
            'As dívidas ligam-se sempre a um cliente da base comum. Crie primeiro o cliente na plataforma.',
            'Debts always link to a customer from the shared base. Create the customer on the platform first.',
          )}
        />
      );
    }
    return (
      <div className="cartao">
        <p className="cartao__titulo">{tr('Registo manual', 'Manual entry')}</p>
        <div className="form-grelha">
          {seletorCliente(form, setForm, 'manual')}
          {camposComuns(form, setForm, 'manual')}
        </div>
        <Field label={tr('Notas', 'Notes')} htmlFor="manual-notas">
          <Textarea
            id="manual-notas"
            data-testid="manual-notas"
            rows={3}
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
            placeholder={tr('Contexto interno (opcional).', 'Internal context (optional).')}
          />
        </Field>
        <div className="linha-acoes" style={{ marginTop: '1rem' }}>
          <span className="espacador" />
          <Button variant="ghost" onClick={() => navigate('/dividas')} disabled={aGuardar}>
            {tr('Cancelar', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            data-testid="btn-criar-divida"
            data-demo-target="criar-divida"
            onClick={submeterManual}
            disabled={aGuardar}
          >
            <IconMais size={16} /> {aGuardar ? tr('A gravar…', 'Saving…') : tr('Registar dívida', 'Create debt')}
          </Button>
        </div>
      </div>
    );
  }

  function conteudoFatura() {
    if (fase === 'aLer') {
      return (
        <div className="cartao" data-testid="fatura-a-ler">
          <p className="cartao__titulo">{tr('A ler a fatura…', 'Reading the invoice…')}</p>
          <Skeleton lines={5} />
          <p style={{ marginTop: '0.75rem', opacity: 0.75 }}>
            {tr('A extração automática pode demorar alguns segundos.', 'Automatic extraction can take a few seconds.')}
          </p>
        </div>
      );
    }

    if (fase === 'confirmar') {
      const clienteSugerido = sugestao && formFatura.clienteId === sugestao.clienteId;
      return (
        <div className="cartao" data-demo-target="dados-extraidos" data-testid="fatura-confirmacao">
          <p className="cartao__titulo">{tr('Confirme os dados extraídos', 'Confirm the extracted data')}</p>
          <p style={{ marginBottom: '1rem', opacity: 0.8 }}>
            {tr(
              'Nada é gravado antes de confirmar. Reveja e corrija o que for necessário.',
              'Nothing is saved before you confirm. Review and correct anything needed.',
            )}
          </p>
          {extraido ? (
            <p style={{ marginBottom: '1rem', fontSize: '0.85rem', opacity: 0.75 }}>
              {tr('Extraído da fatura: ', 'Extracted from the invoice: ')}
              {[
                extraido.clienteNome || null,
                extraido.clienteNif ? `NIF ${extraido.clienteNif}` : null,
                extraido.dataEmissao ? tr(`emitida a ${formatData(parseDataFlex(extraido.dataEmissao) || extraido.dataEmissao)}`, `issued ${formatData(parseDataFlex(extraido.dataEmissao) || extraido.dataEmissao)}`) : null,
                extraido.iban ? `IBAN ${extraido.iban}` : null,
              ].filter(Boolean).join(' · ') || tr('sem cabeçalho identificável', 'no identifiable header')}
            </p>
          ) : null}
          <div className="form-grelha">
            {seletorCliente(
              formFatura,
              setFormFatura,
              'fatura',
              clienteSugerido ? (
                <span data-testid="fatura-correspondencia">
                  <Badge tone="info">
                    {tr('Correspondência sugerida', 'Suggested match')} · {Math.round(sugestao.pontuacao * 100)}%
                  </Badge>
                </span>
              ) : null,
            )}
            {camposComuns(formFatura, setFormFatura, 'fatura')}
          </div>
          <div className="linha-acoes" style={{ marginTop: '1rem' }}>
            <Button variant="ghost" onClick={reporFatura} disabled={aGuardar} data-testid="btn-outra-fatura">
              {tr('Ler outra fatura', 'Read another invoice')}
            </Button>
            <span className="espacador" />
            <Button
              variant="primary"
              data-testid="btn-confirmar-fatura"
              data-demo-target="confirmar-fatura"
              onClick={submeterFatura}
              disabled={aGuardar}
            >
              <IconCerto size={16} /> {aGuardar ? tr('A gravar…', 'Saving…') : tr('Confirmar e registar dívida', 'Confirm and create debt')}
            </Button>
          </div>
        </div>
      );
    }

    // fase 'inicial'
    return (
      <>
        {erroExtracao ? (
          <div className="cartao cartao--aviso" data-testid="erro-extracao" style={{ marginBottom: '1rem' }}>
            <p className="cartao__titulo" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <IconAviso size={18} /> {tr('Não foi possível ler a fatura', 'Could not read the invoice')}
            </p>
            <p>{erroExtracao.mensagem}</p>
            {erroExtracao.code === 'no_text_layer' ? (
              <p style={{ marginTop: '0.5rem' }}>
                {tr(
                  'O PDF não tem camada de texto pesquisável. Fotografe a fatura (ou digitalize-a como imagem PNG/JPEG) e tente novamente.',
                  'The PDF has no searchable text layer. Photograph the invoice (or scan it as a PNG/JPEG image) and try again.',
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          className="cartao"
          data-demo-target="dropzone-fatura"
          style={{ borderStyle: 'dashed', textAlign: 'center', padding: '2.25rem 1.5rem' }}
        >
          <div style={{ opacity: 0.7, marginBottom: '0.5rem' }}><IconUpload size={30} /></div>
          <p className="cartao__titulo" style={{ marginBottom: '0.25rem' }}>
            {tr('Carregue a fatura', 'Upload the invoice')}
          </p>
          <p style={{ marginBottom: '1rem', opacity: 0.75 }}>
            {tr(
              'PNG, JPEG, WebP ou PDF. Os dados são extraídos automaticamente para confirmação.',
              'PNG, JPEG, WebP or PDF. The data is extracted automatically for your confirmation.',
            )}
          </p>
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            data-testid="input-fatura"
            onChange={aoEscolherFicheiro}
            style={{ maxWidth: '24rem', margin: '0 auto' }}
          />
          <div className="linha-acoes" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <Button
              variant="secondary"
              data-testid="btn-fotografar-fatura"
              onClick={() => inputCamaraRef.current && inputCamaraRef.current.click()}
            >
              <IconCamera size={16} /> {tr('Fotografar a fatura', 'Photograph the invoice')}
            </Button>
          </div>
          <input
            ref={inputCamaraRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="environment"
            data-testid="input-fatura-camera"
            style={{ display: 'none' }}
            onChange={aoEscolherFicheiro}
          />
        </div>
        {semClientes ? (
          <p style={{ marginTop: '0.75rem', opacity: 0.75 }}>
            {tr(
              'Nota: sem clientes na base do espaço de trabalho não é possível concluir o registo.',
              'Note: without customers in the workspace base the debt cannot be completed.',
            )}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div data-testid="pagina-nova-divida">
      {!disponivel() ? (
        <div className="cartao cartao--aviso" style={{ marginBottom: '1rem' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <IconAviso size={16} />
            {tr(
              'Plataforma indisponível nesta pré-visualização: o registo de dívidas está desativado.',
              'Platform unavailable in this preview: debt creation is disabled.',
            )}
          </p>
        </div>
      ) : null}
      <Tabs
        tabs={[
          { id: 'manual', label: tr('Registo manual', 'Manual entry'), demoTarget: 'tab-manual' },
          { id: 'fatura', label: tr('Ler fatura', 'Scan invoice'), demoTarget: 'tab-fatura' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ marginTop: '1rem' }}>
        {tab === 'manual' ? conteudoManual() : conteudoFatura()}
      </div>
    </div>
  );
}
