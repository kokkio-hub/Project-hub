import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { useDocumentTitle } from '../auth/session';
import { EmptyState } from '../components/Feedback';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <div className="page">
      <div className="card">
        <EmptyState
          icon={<Compass size={22} />}
          title="Page not found"
          action={
            <Link to="/" className="btn btn-primary">
              Go to the dashboard
            </Link>
          }
        >
          The page you were looking for doesn't exist or has moved.
        </EmptyState>
      </div>
    </div>
  );
}
