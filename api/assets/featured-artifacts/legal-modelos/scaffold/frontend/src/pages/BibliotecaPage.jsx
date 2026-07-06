import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSharedCollection,
  createShared,
  deleteShared,
  appHref,
} from '../shared.js';
import { isDemoActive } from '../demo.js';
import {
  Button,
  Badge,
  SearchInput,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconLibrary, IconExternalLink, IconCheck } from '../components/Icons.jsx';
import { BIBLIOTECA, CATEGORIAS } from '../data/biblioteca.js';
import { foldText, nomeUnico } from './modelos-util.js';

/*
 * Biblioteca de minutas de fonte oficial. Grelha pesquisável/filtrável da
 * BIBLIOTECA estática; cada item importa-se para a colecção partilhada
 * `modelos` (com os campos aditivos categoria/fonte/licenca/versao), passando a
 * ser consumido pelo app de Contratos. A página NUNCA semeia a espinha - só
 * cria linhas de modelo a pedido do utilizador.
 */
export default function BibliotecaPage() {
  const navigate = useNavigate();
  const { items: modelos, refresh } = useSharedCollection('modelos');

  const [query, setQuery] = useState('');
  const [categoria, setCategoria] = useState('');
  const [importandoId, setImportandoId] = useState(null);
  const [sucesso, setSucesso] = useState(null); // { nome, modeloId }

  // REPETIBILIDADE da demonstração: o passo "importar" da demonstração cria um
  // modelo novo em cada execução (nomes "(2)", "(3)", ...). Quando uma
  // demonstração está activa, os modelos demo-marcados de execuções anteriores
  // são removidos, para que cada execução importe sobre um estado limpo. Só
  // toca registos demo-marcados. O handshake da ponte completa DEPOIS do
  // mount - sondar brevemente.
  const demoReposto = useRef(false);
  useEffect(() => {
    let tentativas = 0;
    const timer = setInterval(async () => {
      tentativas += 1;
      if (demoReposto.current || tentativas > 12) { clearInterval(timer); return; }
      if (!isDemoActive()) return;
      demoReposto.current = true;
      clearInterval(timer);
      try {
        const { listShared } = await import('../shared.js');
        const rows = await listShared('modelos');
        const alvo = rows.filter((m) => m && m.demo === true && m.demoSet === 'fonseca');
        await Promise.all(alvo.map((m) => deleteShared('modelos', m.id)));
        if (alvo.length > 0) await refresh();
      } catch { /* não fatal - a demonstração continua sobre o estado existente */ }
    }, 350);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const folded = foldText(query.trim());
  const filtrados = useMemo(() => (
    BIBLIOTECA
      .filter((m) => (categoria ? m.categoria === categoria : true))
      .filter((m) => {
        if (!folded) return true;
        return foldText(`${m.nome} ${m.categoria} ${m.fonte} ${m.descricao}`).includes(folded);
      })
  ), [categoria, folded]);

  async function onImportar(item) {
    if (importandoId) return;
    setImportandoId(item.id);
    try {
      const nome = nomeUnico(item.nome, modelos);
      // Importações feitas durante uma demonstração ficam demo-marcadas: a
      // remoção da espinha e o reinício da demonstração limpam-nas, sem nunca
      // tocar modelos importados pelo utilizador.
      const marcaDemo = isDemoActive() ? { demo: true, demoSet: 'fonseca' } : null;
      const created = await createShared('modelos', {
        nome,
        area: item.categoria,
        descricao: `Importado da biblioteca (${item.fonte})`,
        corpo: item.corpo,
        variaveis: Array.isArray(item.variaveis) ? item.variaveis.map((v) => ({ ...v })) : [],
        categoria: item.categoria,
        fonte: 'importado',
        fonteOriginal: item.fonte,
        licenca: item.licenca,
        versao: 1,
        ...(marcaDemo || {}),
      });
      await refresh();
      if (created && created.id) {
        setSucesso({ nome, modeloId: created.id });
        toast(`"${nome}" importado para os seus modelos.`, { tone: 'ok' });
      } else {
        toast('Não foi possível importar o modelo.', { tone: 'error' });
      }
    } catch {
      toast('Não foi possível importar o modelo.', { tone: 'error' });
    } finally {
      setImportandoId(null);
    }
  }

  return (
    <div data-testid="biblioteca-page" data-demo-page="modelos/biblioteca">
      <div className="page-header">
        <div>
          <h1 className="page-title">Biblioteca de modelos</h1>
          <p className="page-subtitle">
            Minutas redigidas a partir da estrutura de documentos de fonte oficial (DRE, IRN, DGAEP,
            Segurança Social). Cada minuta regista a fonte e a licença; importe-a para começar a
            usá-la nos seus modelos e nos Contratos.
          </p>
        </div>
      </div>

      {sucesso && (
        <div
          className="card"
          data-testid="biblioteca-sucesso"
          data-demo-target="modelos-sucesso"
          style={{ borderColor: 'var(--ok, #16a34a)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)' }}
        >
          <div className="row" style={{ gap: 'var(--space-2, 0.5rem)', alignItems: 'center' }}>
            <span className="badge badge-ok"><IconCheck size={14} /> Importado</span>
            <strong>{sucesso.nome}</strong>
          </div>
          <p className="card-subtitle" style={{ margin: 0 }}>
            O modelo está agora nos seus modelos, pronto a editar ou a usar para gerar um documento
            no app de Contratos.
          </p>
          <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
            <a
              className="btn btn-primary btn-sm"
              href={appHref('legal-contratos')}
              data-testid="sucesso-contratos"
            >
              Abrir em Contratos <IconExternalLink size={14} />
            </a>
            <Button size="sm" variant="secondary" data-testid="sucesso-modelos" onClick={() => navigate('/modelos')}>
              Ver nos meus modelos
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSucesso(null)}>
              Continuar na biblioteca
            </Button>
          </div>
        </div>
      )}

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por nome, categoria ou fonte…"
          data-testid="biblioteca-pesquisa"
          data-demo-target="modelos-pesquisa"
        />
        <div className="chip-row">
          <button
            type="button"
            className={`chip as-button${categoria === '' ? ' is-active' : ''}`}
            data-testid="bib-cat-todas"
            onClick={() => setCategoria('')}
          >
            Todas
          </button>
          {CATEGORIAS.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip as-button${categoria === c ? ' is-active' : ''}`}
              data-testid={`bib-cat-${c}`}
              onClick={() => setCategoria((prev) => (prev === c ? '' : c))}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState
          icon={<IconLibrary />}
          title="Sem resultados"
          hint="Nenhuma minuta corresponde à pesquisa. Ajuste os filtros."
        />
      ) : (
        <div className="launcher-grid">
          {filtrados.map((item, idx) => {
            const nVars = Array.isArray(item.variaveis) ? item.variaveis.length : 0;
            const first = idx === 0;
            return (
              <article
                key={item.id}
                className="card"
                data-testid={`bib-card-${item.id}`}
                {...(first ? { 'data-demo-target': 'modelos-item' } : {})}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)' }}
              >
                <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--space-3, 0.75rem)' }}>
                  <span className="launcher-title">{item.nome}</span>
                  <Badge tone="info">{item.categoria}</Badge>
                </div>
                {item.descricao ? <p className="card-subtitle" style={{ margin: 0 }}>{item.descricao}</p> : null}
                <div className="stack" style={{ gap: '2px', marginTop: 'auto' }}>
                  <span className="text-small text-subtle">
                    Fonte: <span data-testid={`bib-fonte-${item.id}`}>{item.fonte}</span>
                  </span>
                  <span className="text-small text-subtle">
                    Licença: <span data-testid={`bib-licenca-${item.id}`}>{item.licenca}</span>
                  </span>
                  <span className="text-small text-subtle">
                    {nVars} {nVars === 1 ? 'variável' : 'variáveis'}
                  </span>
                </div>
                <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
                  <Button
                    size="sm"
                    data-testid={`bib-importar-${item.id}`}
                    {...(first ? { 'data-demo-target': 'modelos-importar' } : {})}
                    onClick={() => onImportar(item)}
                    disabled={importandoId === item.id}
                  >
                    {importandoId === item.id ? 'A importar…' : 'Importar para os meus modelos'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
