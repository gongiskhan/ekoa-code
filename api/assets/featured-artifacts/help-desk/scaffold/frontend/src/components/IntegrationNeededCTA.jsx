import { Icon } from './Icon.jsx';

const CATEGORY_LABEL = {
  email: 'correio electrónico',
  calendar: 'calendário',
  'files-storage': 'armazenamento',
  payments: 'pagamentos',
  'external-api': 'API externa',
  spreadsheets: 'folhas de cálculo',
  crm: 'CRM',
  sms: 'SMS',
  maps: 'mapas',
};

const PROVIDER_LABEL = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  'google-workspace': 'Google Workspace',
  'microsoft-365': 'Microsoft 365',
  'google-calendar': 'Google Calendar',
  'outlook-calendar': 'Outlook Calendar',
  drive: 'Google Drive',
  onedrive: 'OneDrive',
  slack: 'Slack',
  stripe: 'Stripe',
};

export function IntegrationNeededCTA({ category, options = [], message, onClose }) {
  const friendly = CATEGORY_LABEL[category] || category;
  const providers = options.length > 0 ? options : [category];

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlay-scrim" onClick={onClose} aria-hidden="true" />
      <div className="overlay-card">
        <header className="overlay-header">
          <div className="cta-head">
            <div className="cta-icon">
              <Icon name="plug" size={20} />
            </div>
            <div>
              <h2 className="overlay-title">Ligue o seu {friendly}</h2>
              <p className="overlay-subtitle">
                Para enviar e receber pedidos, ligue uma conta de {friendly}.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="overlay-body">
          <div className="cta-body">
            <p className="cta-message">
              {message ||
                `O Helpdesk precisa de uma integração de ${friendly} para esta acção. Após a ligação, os pedidos passam a chegar automaticamente.`}
            </p>
            <div className="cta-providers">
              {providers.map((p) => (
                <a
                  key={p}
                  className="primary-button"
                  href={`/integrations?category=${encodeURIComponent(
                    category,
                  )}&provider=${encodeURIComponent(p)}`}
                >
                  <Icon name="plug" />
                  <span>Ligar {PROVIDER_LABEL[p] || p}</span>
                </a>
              ))}
            </div>
            <a className="cta-link" href="/integrations">
              Ver todas as integrações
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
