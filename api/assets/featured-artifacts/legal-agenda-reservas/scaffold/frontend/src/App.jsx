import ReservarPage from './pages/ReservarPage.jsx';

/*
 * Face PÚBLICA da agenda — moldura própria, minimalista e autónoma (não usa o
 * Layout partilhado da suite, de propósito). Mesma linguagem visual: claro,
 * Inter, cantos arredondados, tracejados finos.
 */
export default function App() {
  return (
    <div className="rz-shell" data-testid="reservas-app">
      <header className="rz-header">
        <span className="rz-brand"><span className="rz-brand-mark" aria-hidden="true">A</span> Marcações</span>
      </header>
      <ReservarPage />
    </div>
  );
}
