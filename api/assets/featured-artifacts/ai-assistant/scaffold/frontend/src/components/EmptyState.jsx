import { Icon } from './Icon.jsx';

export function EmptyState({ onStart }) {
  return (
    <div className="empty-pane">
      <div className="empty-card">
        <div className="empty-icon">
          <Icon name="message" size={32} />
        </div>
        <h2 className="empty-title">Comece uma conversa</h2>
        <p className="empty-text">
          Crie uma nova conversa para colocar uma questão ao assistente. As
          respostas baseiam-se nos documentos guardados na base de
          conhecimento.
        </p>
        <button type="button" className="primary-button" onClick={onStart}>
          <Icon name="plus" />
          <span>Nova conversa</span>
        </button>
      </div>
    </div>
  );
}
