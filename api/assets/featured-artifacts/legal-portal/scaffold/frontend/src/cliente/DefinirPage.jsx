import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../components/ui.jsx';
import { IconDoor, IconShieldCheck } from '../components/Icons.jsx';
import { listUtilizadores, definirPalavraPasse } from '../portal.js';
import ClienteShell from './ClienteShell.jsx';

/*
 * "Definir palavra-passe" - o passo de uso único aberto pelo link de convite
 * (token na query). Encontra a linha de `utilizadores` convidada com este token,
 * confirma o email, e (ao submeter) calcula o hash bcrypt do lado do cliente e
 * grava-o na linha. O servidor verifica-o depois no login. É o único caminho que
 * a plataforma suporta para a PRIMEIRA palavra-passe de um utilizador novo.
 */
export default function DefinirPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading'); // loading | invalid | form | done
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        if (alive) setStatus('invalid');
        return;
      }
      const users = await listUtilizadores();
      const user = users.find((u) => u.conviteToken && u.conviteToken === token && u.estado === 'convidado');
      if (!alive) return;
      if (!user) {
        setStatus('invalid');
        return;
      }
      setEmail(user.email);
      setStatus('form');
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setErro('');
    if (pw.length < 8) {
      setErro('A palavra-passe deve ter pelo menos 8 caracteres.');
      return;
    }
    if (pw !== pw2) {
      setErro('As palavras-passe não coincidem.');
      return;
    }
    setBusy(true);
    try {
      await definirPalavraPasse(token, pw);
      setStatus('done');
    } catch {
      setErro('Este convite já não é válido. Peça um novo ao escritório.');
      setStatus('invalid');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClienteShell>
      <div className="portal-center" data-testid="definir-page">
        <div className="card stack stack-4" style={{ padding: 'var(--sp-6)', width: '100%', maxWidth: 420 }}>
          {status === 'loading' && <p className="text-muted" style={{ margin: 0 }}>A validar o convite…</p>}

          {status === 'invalid' && (
            <div className="stack stack-3" data-testid="definir-invalido">
              <span className="portal-brand-icon" aria-hidden="true"><IconDoor /></span>
              <h1 className="portal-title">Convite inválido</h1>
              <p className="text-muted" style={{ margin: 0 }}>
                Este link de convite não é válido ou já foi utilizado. Peça um novo ao escritório.
              </p>
              <Button variant="secondary" data-testid="definir-ir-login" onClick={() => navigate('/cliente')}>
                Ir para o início de sessão
              </Button>
            </div>
          )}

          {status === 'form' && (
            <form className="stack stack-4" onSubmit={submit}>
              <div className="stack stack-1">
                <span className="portal-brand-icon" aria-hidden="true"><IconDoor /></span>
                <h1 className="portal-title">Definir palavra-passe</h1>
                <p className="text-muted" style={{ margin: 0 }}>
                  Bem-vindo ao Portal do Cliente. Defina a palavra-passe para o seu acesso.
                </p>
              </div>
              <Field label="Email">
                <Input type="email" value={email} readOnly data-testid="definir-email" />
              </Field>
              <Field label="Palavra-passe" hint="Pelo menos 8 caracteres.">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  data-testid="definir-password"
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Escolha uma palavra-passe"
                />
              </Field>
              <Field label="Confirmar palavra-passe">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={pw2}
                  data-testid="definir-password2"
                  onChange={(e) => setPw2(e.target.value)}
                  placeholder="Repita a palavra-passe"
                />
              </Field>
              {erro ? <p className="portal-erro" data-testid="definir-erro">{erro}</p> : null}
              <Button type="submit" variant="primary" data-testid="definir-submit" disabled={busy}>
                {busy ? 'A definir…' : 'Definir e continuar'}
              </Button>
            </form>
          )}

          {status === 'done' && (
            <div className="stack stack-3" data-testid="definir-done">
              <span className="portal-brand-icon" aria-hidden="true"><IconShieldCheck /></span>
              <h1 className="portal-title">Palavra-passe definida</h1>
              <p className="text-muted" style={{ margin: 0 }}>
                O seu acesso está ativo. Já pode iniciar sessão no portal com o seu email e a palavra-passe que definiu.
              </p>
              <Button variant="primary" data-testid="definir-entrar" onClick={() => navigate('/cliente')}>
                Entrar no portal
              </Button>
            </div>
          )}
        </div>
      </div>
    </ClienteShell>
  );
}
