import { Button } from '@cupmemo/ui';
import { CollectionView } from '../../components/collection-view';

export default function BeansPage() {
  return (
    <>
      <h1>Your coffee shelf</h1>
      <p className="auth-intro">Good beans. Better brews.</p>
      <a className="cm-button cm-button--primary primary-button" href="/app/coffees/new">
        Add coffee
      </a>
      <Button disabled className="primary-button" aria-describedby="brew-availability">
        Record a brew
      </Button>
      <p id="brew-availability" className="collection-note">
        Brew recording will be available in the next delivery.
      </p>
      <CollectionView kind="coffees" />
    </>
  );
}
