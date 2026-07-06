import { Icon } from './Icon.jsx';

const PROVIDER_LABEL = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  'microsoft-365': 'Microsoft 365',
  'google-workspace': 'Google Workspace',
};

export function IntegrationStatus({ status, onConnect }) {
  if (!status || status.kind === 'idle' || status.kind === 'checking') {
    return (
      <div className="integration-pill integration-pill-muted">
        <Icon name="mail" size={14} />
        <span>A verificar correio electrónico...</span>
      </div>
    );
  }

  if (status.kind === 'connected') {
    const label =
      PROVIDER_LABEL[status.provider] || status.provider || 'Correio electrónico';
    return (
      <div className="integration-pill integration-pill-connected">
        <Icon name="mail-check" size={14} />
        <span>
          {label} ligado
          {typeof status.unread === 'number' ? ` · ${status.unread} por ler` : ''}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="integration-pill integration-pill-action"
      onClick={onConnect}
    >
      <Icon name="mail-x" size={14} />
      <span>Ligue o correio electrónico</span>
    </button>
  );
}
