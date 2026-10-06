import { ApiStatus } from '../components/api-status';

export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="eyebrow">Development scaffold</div>
      <h1>CupMemo</h1>
      <p className="intro">Your personal coffee brewing journal.</p>
      <p className="notice">
        This diagnostic page verifies local web-to-API connectivity. Product features are not
        included yet.
      </p>
      <ApiStatus />
      <footer>Local development only · No account or brew data is stored</footer>
    </main>
  );
}
