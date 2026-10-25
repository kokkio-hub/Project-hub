import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { useDocumentTitle } from '../auth/session';
import { EmptyState } from '../components/Feedback';
import { t } from '../i18n';

export function NotFoundPage() {
  useDocumentTitle(t('Not found'));
  return (
    <div className="page">
      <div className="card">
        <EmptyState
          icon={<Compass size={22} />}
          title={t('Page not found')}
          action={
            <Link to="/" className="btn btn-primary">
              {t('Go to the dashboard')}
            </Link>
          }
        >
          {t('The page you were looking for doesn’t exist or has moved.')}
        </EmptyState>
      </div>
    </div>
  );
}
