import { CollectionView } from '../../../components/collection-view';

export default function JournalPage() {
  return (
    <>
      <h1>Brew, learn, repeat</h1>
      <p className="auth-intro">A quiet look back at your saved brews.</p>
      <CollectionView kind="brews" />
    </>
  );
}
