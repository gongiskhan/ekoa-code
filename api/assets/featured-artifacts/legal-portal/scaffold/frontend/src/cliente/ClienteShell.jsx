import { IconScale } from '../components/Icons.jsx';
import { Button } from '../components/ui.jsx';

/*
 * Casca mínima da FACE DO CLIENTE - deliberadamente FORA do Layout partilhado
 * (sem barra lateral, sem lançador, sem sino). Mantém a mesma linguagem visual
 * da suite (claro, Inter, cantos arredondados, linhas ténues) através dos tokens
 * partilhados, mas é uma superfície própria, focada e sem distrações.
 */
export default function ClienteShell({ user, onSignOut, children }) {
  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <div className="portal-brand">
          <span className="portal-brand-mark" aria-hidden="true"><IconScale /></span>
          <span className="portal-brand-lines">
            <span className="portal-brand-text">Portal do Cliente</span>
            <span className="portal-brand-sub">Acesso seguro ao seu processo</span>
          </span>
        </div>
        {user ? (
          <div className="portal-topbar-user">
            <span className="text-subtle text-xs">{user.nome || user.email}</span>
            <Button size="sm" variant="ghost" data-testid="portal-topbar-sair" onClick={onSignOut}>Sair</Button>
          </div>
        ) : null}
      </header>
      <main className="portal-content">{children}</main>
    </div>
  );
}
