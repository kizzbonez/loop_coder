import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/misc';

export function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <div className="mx-auto max-w-lg p-8">
      <EmptyState
        icon={Compass}
        title={`This ${what} does not exist`}
        description="It may have been deleted, or you may not have access to it."
        action={
          <Link to="/">
            <Button variant="primary">Go home</Button>
          </Link>
        }
      />
    </div>
  );
}
