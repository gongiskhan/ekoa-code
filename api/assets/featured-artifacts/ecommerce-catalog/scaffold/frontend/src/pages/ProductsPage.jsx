import { useEffect, useMemo, useState } from 'react';
import { useCollection, createItem, updateItem, deleteItem, formatCurrency } from '../components/data.js';
import { IconClose, IconEdit, IconPackage, IconPlus, IconSearch, IconTrash } from '../components/Icons.jsx';
import ProductImage from '../components/ProductImage.jsx';

const EMPTY_FORM = {
  sku: '',
  name: '',
  category: '',
  price: '',
  stock: '',
  description: '',
  tone: '#0F766E',
};

export default function ProductsPage() {
  const { items: products, loading, refresh } = useCollection('products');
  const { items: categories } = useCollection('categories');

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (!term) return true;
      return (
        (p.name || '').toLowerCase().includes(term) ||
        (p.sku || '').toLowerCase().includes(term) ||
        (p.description || '').toLowerCase().includes(term)
      );
    });
  }, [products, activeCategory, query]);

  const categoryLabel = (key) => categories.find((c) => c.key === key)?.name || key || 'Sem categoria';

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Produtos</h1>
          <p className="page-subtitle">Faça a gestão do catálogo, dos preços e do stock disponível.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY_FORM }); setFormError(null); }}>
          <IconPlus /> Novo produto
        </button>
      </div>

      <div className="filters">
        <label className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise por nome, referência ou descrição."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="chip-row">
          <button
            type="button"
            className={`chip as-button${activeCategory === 'all' ? ' is-active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            Todas
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id || cat.key}
              type="button"
              className={`chip as-button${activeCategory === cat.key ? ' is-active' : ''}`}
              onClick={() => setActiveCategory(cat.key)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar produtos.</span></div>
      ) : filtered.length === 0 ? (
        <EmptyProducts onCreate={() => setEditing({ ...EMPTY_FORM })} hasQuery={query.trim().length > 0 || activeCategory !== 'all'} />
      ) : (
        <div className="product-grid">
          {filtered.map((product) => (
            <article key={product.id} className="product-card">
              <ProductImage name={product.name} tone={product.tone} category={categoryLabel(product.category)} />
              <div className="product-body">
                <h3 className="product-name">{product.name || 'Sem nome'}</h3>
                <p className="text-xs text-subtle" style={{ margin: 0 }}>{categoryLabel(product.category)} · {product.sku || '—'}</p>
                <p className="text-small text-muted" style={{ margin: 0 }}>{product.description || 'Sem descrição.'}</p>
                <div className="product-meta" style={{ marginTop: 'var(--space-2, 0.5rem)' }}>
                  <StockBadge stock={Number(product.stock) || 0} />
                  <span className="product-price">{formatCurrency(product.price)}</span>
                </div>
                <div className="product-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => { setEditing(toFormState(product)); setFormError(null); }}>
                    <IconEdit /> Editar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-icon"
                    aria-label={`Remover ${product.name}`}
                    onClick={async () => {
                      if (typeof window === 'undefined' || window.confirm(`Remover "${product.name}" do catálogo?`)) {
                        await deleteItem('products', product.id);
                        await refresh();
                      }
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <ProductForm
          state={editing}
          categories={categories}
          submitting={submitting}
          error={formError}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            setSubmitting(true);
            setFormError(null);
            try {
              const payload = {
                sku: form.sku.trim() || null,
                name: form.name.trim(),
                category: form.category || null,
                price: parseFloat(form.price) || 0,
                stock: parseInt(form.stock, 10) || 0,
                description: form.description.trim() || null,
                tone: form.tone || null,
              };
              if (!payload.name) throw new Error('O nome do produto é obrigatório.');
              if (form.id) {
                await updateItem('products', form.id, payload);
              } else {
                await createItem('products', payload);
              }
              await refresh();
              setEditing(null);
            } catch (err) {
              setFormError(err.message || 'Não foi possível guardar o produto.');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function StockBadge({ stock }) {
  if (stock <= 0) return <span className="badge is-danger"><span className="badge-dot" aria-hidden="true" /> Sem stock</span>;
  if (stock <= 15) return <span className="badge is-warning"><span className="badge-dot" aria-hidden="true" /> Stock baixo · {stock}</span>;
  return <span className="badge is-success"><span className="badge-dot" aria-hidden="true" /> {stock} em stock</span>;
}

function EmptyProducts({ hasQuery, onCreate }) {
  if (hasQuery) {
    return (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true"><IconSearch /></span>
        <p className="empty-title">Sem resultados</p>
        <p className="empty-text">Não foram encontrados produtos com esses critérios. Ajuste a pesquisa ou os filtros.</p>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true"><IconPackage /></span>
      <p className="empty-title">Sem produtos no catálogo</p>
      <p className="empty-text">Adicione o primeiro produto para começar a vender.</p>
      <button type="button" className="btn btn-primary" onClick={onCreate}>
        <IconPlus /> Adicionar produto
      </button>
    </div>
  );
}

function toFormState(product) {
  return {
    id: product.id,
    sku: product.sku || '',
    name: product.name || '',
    category: product.category || '',
    price: product.price === null || product.price === undefined ? '' : String(product.price),
    stock: product.stock === null || product.stock === undefined ? '' : String(product.stock),
    description: product.description || '',
    tone: product.tone || '#0F766E',
  };
}

function ProductForm({ state, categories, onClose, onSubmit, submitting, error }) {
  const [form, setForm] = useState(state);
  useEffect(() => setForm(state), [state]);

  const isEditing = Boolean(state.id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
      <div className="modal">
        <header className="modal-header row row-space-between">
          <h2 id="product-form-title" className="modal-title">{isEditing ? 'Editar produto' : 'Novo produto'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}><IconClose /></button>
        </header>
        <form
          className="modal-body form"
          onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
        >
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Nome</span>
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="Ex.: Caderno A5 capa dura"
              />
            </label>
            <label className="field">
              <span className="field-label">Referência (SKU)</span>
              <input
                className="field-input"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="Ex.: PAP-001"
              />
            </label>
            <label className="field">
              <span className="field-label">Categoria</span>
              <select
                className="field-select"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id || c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Preço (EUR)</span>
              <input
                className="field-input numeric"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Stock</span>
              <input
                className="field-input numeric"
                type="number"
                min="0"
                step="1"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Cor de destaque</span>
              <input
                className="field-input"
                type="color"
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
              />
              <span className="field-hint">Aplicada apenas na imagem do catálogo.</span>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Descrição</span>
            <textarea
              className="field-textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Descreva o produto para a sua equipa."
            />
          </label>
          {error ? <p className="text-small" style={{ color: 'var(--color-danger, #DC2626)', margin: 0 }}>{error}</p> : null}
          <footer className="modal-footer" style={{ marginLeft: 'calc(-1 * var(--space-6, 1.5rem))', marginRight: 'calc(-1 * var(--space-6, 1.5rem))', marginBottom: 'calc(-1 * var(--space-6, 1.5rem))', marginTop: 'var(--space-6, 1.5rem)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'A guardar.' : isEditing ? 'Guardar alterações' : 'Adicionar produto'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
