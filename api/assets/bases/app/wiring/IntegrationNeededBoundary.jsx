import React from 'react';

/**
 * IntegrationNeededBoundary
 *
 * Renders the "connect a provider" CTA when an integration is missing.
 * Consumes the props from a callIntegration { ok: false; status: 'needs_integration' } result.
 */
export function IntegrationNeededBoundary({ category, options = [], message }) {
  const friendlyCategory = {
    email: 'email',
    calendar: 'calendário',
    'files-storage': 'armazenamento de ficheiros',
    payments: 'pagamentos',
    'external-api': 'API externa',
    spreadsheets: 'folhas de cálculo',
    crm: 'CRM',
    sms: 'SMS',
    maps: 'mapas',
  }[category] || category;

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '2rem auto',
        padding: 'var(--space-6, 1.5rem)',
        border: '1px solid var(--color-border, #E2E8F0)',
        borderRadius: 'var(--radius-md, 0.5rem)',
        background: 'var(--color-surface, #F8FAFC)',
        textAlign: 'center',
      }}
    >
      <h3
        style={{
          fontSize: 'var(--text-xl, 1.25rem)',
          fontWeight: 600,
          margin: 0,
          color: 'var(--color-text, #0F172A)',
        }}
      >
        Para continuar, ligue uma integração
      </h3>
      <p
        style={{
          marginTop: 'var(--space-2, 0.5rem)',
          color: 'var(--color-text-muted, #475569)',
          fontSize: 'var(--text-base, 0.9375rem)',
          lineHeight: 1.5,
        }}
      >
        {message || `Precisa de ligar uma integração de ${friendlyCategory} para esta acção.`}
      </p>
      <div style={{ marginTop: 'var(--space-4, 1rem)', display: 'flex', gap: 'var(--space-2, 0.5rem)', justifyContent: 'center', flexWrap: 'wrap' }}>
        {(options.length > 0 ? options : [friendlyCategory]).map((opt) => (
          <a
            key={opt}
            href={`/integrations?category=${encodeURIComponent(category)}&provider=${encodeURIComponent(opt)}`}
            style={{
              display: 'inline-block',
              padding: 'var(--space-2, 0.5rem) var(--space-4, 1rem)',
              background: 'var(--color-primary, #0F766E)',
              color: 'var(--color-bg, #FFFFFF)',
              borderRadius: 'var(--radius-md, 0.5rem)',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: 'var(--text-base, 0.9375rem)',
            }}
          >
            Ligar à {labelFor(opt)}
          </a>
        ))}
      </div>
      <p style={{ marginTop: 'var(--space-3, 0.75rem)', fontSize: 'var(--text-sm, 0.8125rem)' }}>
        <a
          href="/integrations"
          style={{ color: 'var(--color-text-muted, #475569)', textDecoration: 'underline' }}
        >
          Gerir integrações
        </a>
      </p>
    </div>
  );
}

function labelFor(option) {
  const map = {
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
  return map[option] || option;
}
