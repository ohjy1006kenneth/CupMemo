export default function GearPage() {
  return (
    <>
      <h1>Your daily setup</h1>
      <p className="auth-intro">A place for your everyday equipment.</p>
      <section className="collection" aria-labelledby="gear-availability">
        <h2 id="gear-availability">Saved equipment isn’t available yet</h2>
        <p className="collection-note">
          Equipment defaults haven’t been implemented. There are no saved settings to choose or
          change yet.
        </p>
      </section>
    </>
  );
}
