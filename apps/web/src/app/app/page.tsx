import { CollectionView } from '../../components/collection-view';

export default function BeansPage() {
  return (
    <>
      <h1>Your coffee shelf</h1>
      <p className="auth-intro">Good beans. Better brews.</p>
      <a className="cm-button cm-button--primary primary-button" href="/app/brews/new">
        Record a brew
      </a>
      <a className="cm-button cm-button--secondary primary-button" href="/app/coffees/new">
        Add coffee
      </a>
      <CollectionView kind="coffees" />
    </>
  );
}
