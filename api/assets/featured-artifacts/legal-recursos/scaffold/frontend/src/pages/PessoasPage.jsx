import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSharedCollection, useDebounced, formatDate } from '../shared.js';
import { Badge, Field, Select, SearchInput, Skeleton, EmptyState } from '../components/ui.jsx';
import { IconIdCard, IconMail, IconChevronRight } from '../components/Icons.jsx';
import { papelLabel, papelTone } from './recursos-logic.js';

/*
 * Lista de fichas da equipa. Lê a colecção partilhada `pessoas` (semeada pelo
 * Núcleo - este app nunca semeia). Filtra por papel e por texto (nome/email).
 * Ordem por omissão: antiguidade (data de admissão ascendente), pelo que a
 * pessoa mais antiga fica em primeiro - também a âncora da demonstração.
 */
export default function PessoasPage() {
  const { items: pessoas, loading } = useSharedCollection('pessoas');
  const [query, setQuery] = useState('');
  const [papelFiltro, setPapelFiltro] = useState('');
  const debouncedQuery = useDebounced(query, 200);

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const rows = pessoas.filter((p) => {
      if (papelFiltro && p.papel !== papelFiltro) return false;
      if (q) {
        const hay = `${p.nome || ''} ${p.nomeCompleto || ''} ${p.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return rows.slice().sort((a, b) => String(a.dataAdmissao || '').localeCompare(String(b.dataAdmissao || '')));
  }, [pessoas, papelFiltro, debouncedQuery]);

  return (
    <div data-testid="pessoas-page" data-demo-page="recursos/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pessoas</h1>
          <p className="page-subtitle">
            As fichas da equipa do escritório, sobre a espinha partilhada. Abra uma ficha para ver
            o direito e o saldo de férias e as ausências.
          </p>
        </div>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por nome ou email…"
          data-testid="pessoas-search"
        />
        <Field label="Papel">
          <Select value={papelFiltro} onChange={(e) => setPapelFiltro(e.target.value)} data-testid="filtro-papel">
            <option value="">Todos os papéis</option>
            <option value="advogado">Advogado/a</option>
            <option value="estagiario">Advogado/a estagiário/a</option>
            <option value="administrativo">Administrativo/a</option>
          </Select>
        </Field>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconIdCard />}
          title="Sem pessoas para os filtros"
          hint="Ajuste a pesquisa ou o filtro de papel. As pessoas vêm do Núcleo partilhado."
        />
      ) : (
        <ul className="ficha-list stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="pessoas-lista">
          {filtered.map((p, idx) => (
            <li key={p.id}>
              <Link
                to={`/pessoa/${p.id}`}
                className="row row-space-between"
                data-testid="pessoa-row"
                data-pessoa-nome={p.nome}
                {...(idx === 0 ? { 'data-demo-target': 'recursos-pessoa' } : {})}
                style={{
                  padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--r-2, 0.5rem)',
                  gap: 'var(--sp-4, 1rem)',
                  textDecoration: 'none',
                  color: 'inherit',
                  background: 'var(--surface-1, transparent)',
                }}
              >
                <span className="row row-3" style={{ gap: 'var(--sp-3, 0.75rem)', minWidth: 0, alignItems: 'center' }}>
                  <span className="row-icon" aria-hidden="true"><IconIdCard size={20} /></span>
                  <span className="stack stack-1" style={{ minWidth: 0 }}>
                    <span className="text-strong">{p.nome}</span>
                    <span className="text-xs text-subtle row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', alignItems: 'center' }}>
                      <IconMail size={13} /> {p.email || '—'}
                    </span>
                  </span>
                </span>
                <span className="row row-3" style={{ gap: 'var(--sp-3, 0.75rem)', alignItems: 'center' }}>
                  <Badge tone={papelTone(p.papel)}>{papelLabel(p.papel)}</Badge>
                  <span className="text-xs text-subtle numeric" title="Data de admissão">
                    desde {formatDate(p.dataAdmissao)}
                  </span>
                  {p.ativo === false ? <Badge tone="neutral">Inativo</Badge> : null}
                  <IconChevronRight />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
