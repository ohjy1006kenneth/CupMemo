import { brewIdSchema } from '@cupmemo/contracts';
import { SavedTastingEntry } from '../../../../../components/saved-tasting-entry';

export default async function TastingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!brewIdSchema.safeParse(id).success)
    return (
      <div className="brew-entry">
        <h1>Edit your tasting</h1>
        <p role="alert">This tasting is unavailable.</p>
        <a className="cm-button cm-button--secondary" href="/app/journal">
          Return to journal
        </a>
      </div>
    );
  return <SavedTastingEntry key={id} id={id} />;
}
