import { brewIdSchema } from '@cupmemo/contracts';
import { BrewDetail } from '../../../../components/brew-detail';

export default async function BrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!brewIdSchema.safeParse(id).success)
    return (
      <div className="brew-entry">
        <h1>Your brew</h1>
        <p role="alert">This brew is unavailable.</p>
        <a className="cm-button cm-button--secondary" href="/app/journal">
          Return to journal
        </a>
      </div>
    );
  return <BrewDetail key={id} id={id} />;
}
